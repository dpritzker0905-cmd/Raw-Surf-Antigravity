from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import patch

import main_release_floors as policy


class MainReleaseFloorsTest(unittest.TestCase):
    def test_frontend_companions_only_with_both_manifests(self):
        event = {"before": "a" * 40, "ref": "refs/heads/main"}
        paths = policy.MANIFESTS | policy.FRONTEND_COMPANIONS
        ordinary = b"100644 " + b"b" * 40
        pinned = f"100644 {policy.DEV_SERVER_TEST_BLOB}".encode()

        def classify(changed, entries):
            def read(*args):
                if args[0] == "diff":
                    self.assertIn("--no-renames", args)
                    return "\0".join(sorted(changed)).encode()
                self.assertEqual(args[0], "ls-tree")
                key = (args[2], args[-1])
                return entries.get(key, ordinary)

            with patch.object(policy, "git", side_effect=read):
                return policy.scoped_base("push", event, "candidate")

        base = event["before"]
        entries = {(base, policy.DEV_SERVER_TEST): b"", ("candidate", policy.DEV_SERVER_TEST): pinned}
        self.assertEqual(classify(paths, entries), base)
        self.assertEqual(classify(policy.MANIFESTS | {"frontend/craco.config.js"}, {}), base)
        for path in [*policy.MANIFESTS, *policy.FRONTEND_COMPANIONS]:
            with self.subTest(deleted=path):
                self.assertIsNone(classify(paths, {**entries, ("candidate", path): b""}))
        for path in policy.MANIFESTS:
            self.assertIsNone(classify(paths - {path}, entries))
        for extra in ["backend/file", policy.WORKFLOW, policy.PAIR_TABLE,
                      ".github/scripts/main_release_floors.py", "frontend/renamed.js"]:
            self.assertIsNone(classify(paths | {extra}, entries))
        for key, value in [((base, policy.DEV_SERVER_TEST), pinned),
                           (("candidate", policy.DEV_SERVER_TEST), ordinary),
                           (("candidate", "frontend/craco.config.js"), b"120000 " + b"b" * 40),
                           ((base, "frontend/README.md"), b"")]:
            self.assertIsNone(classify(paths, {**entries, key: value}))

    def test_only_known_paths_on_exact_base(self):
        base = "a" * 40
        event = {"pull_request": {"base": {"ref": "main", "sha": base}, "head": {"ref": "release"}}}
        for path, expected in [(b"frontend/package-lock.json", base), (b"backend/other", None),
                               (b"frontend/package.json\0backend/other", None)]:
            with self.subTest(path=path), patch.object(policy, "git", side_effect=[base.encode(), path]):
                self.assertEqual(policy.scoped_base("pull_request", event, "candidate"), expected)
        with patch.object(policy, "git", return_value=b"other"), self.assertRaises(policy.floors.Refusal):
            policy.scoped_base("pull_request", event, "candidate")
        event["pull_request"]["head"]["ref"] = "dev"
        self.assertIsNone(policy.scoped_base("pull_request", event, "candidate"))

    def test_workflow_changes_cannot_reclassify_measured_jobs(self):
        base = "a" * 40
        event = {"before": base, "ref": "refs/heads/main"}
        marker = b"\n  backend-floor-staleness:\n"
        workflow = b"jobs:\n  other: old" + marker
        for changed, expected in [(workflow + b"    timeout-minutes: 10", base),
                                  (workflow.replace(b"old", b"new"), None)]:
            with patch.object(policy, "git", side_effect=[policy.WORKFLOW.encode(), workflow, changed]):
                self.assertEqual(policy.scoped_base("push", event, "candidate"), expected)

    def test_every_lane_must_have_a_unique_fresh_success(self):
        now = datetime.now(timezone.utc)
        jobs = [dict(name=spec["job"], id=i, completed_at=now.isoformat(),
                     started_at=now.isoformat(), status="completed", conclusion="success")
                for i, spec in enumerate(policy.floors.LANES.values(), 1)]
        self.assertEqual(len(policy.fresh_jobs(jobs, now)), len(jobs))
        for invalid in [jobs[:-1], jobs + jobs[:1],
                        [dict(jobs[0], conclusion="skipped"), *jobs[1:]],
                        [dict(jobs[0], started_at=(now - timedelta(days=15)).isoformat()), *jobs[1:]],
                        [dict(jobs[0], completed_at=(now + timedelta(days=1)).isoformat()), *jobs[1:]]]:
            with self.assertRaises(policy.floors.Refusal):
                policy.fresh_jobs(invalid, now)

    def test_recovery_is_bound_to_one_base_backend_tree_and_ci_only_change(self):
        event = {"before": policy.RECOVERY_BASE, "ref": "refs/heads/main"}
        diff = (policy.PAIR_TABLE + "\0.github/scripts/main_release_floors.py").encode()
        for paths, tree, expected in [(diff, policy.REPAIR_BACKEND_TREE, policy.RECOVERY_BASE),
                                      (diff, "wrong", None),
                                      (diff + b"\0frontend/package.json", "", None),
                                      (diff + b"\0another-file", policy.REPAIR_BACKEND_TREE, None)]:
            with patch.object(policy, "git", side_effect=[paths, tree.encode()]):
                self.assertEqual(policy.scoped_base("push", event, "candidate"), expected)
        with patch.object(policy, "git", return_value=diff):
            self.assertIsNone(policy.scoped_base("push", dict(event, before="b" * 40), "candidate"))
