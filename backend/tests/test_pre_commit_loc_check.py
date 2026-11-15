"""Offline staged-blob guard regressions using only disposable synthetic Git data."""
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(os.environ.get(
    'LOC_GUARD_SCRIPT', Path(__file__).parents[1] / 'scripts/pre_commit_loc_check.py'
)).resolve()


class TestStagedLocGuard(unittest.TestCase):
    def setUp(self):
        self.fixture_root = Path(os.environ.get(
            'LOC_GUARD_TEST_ROOT', tempfile.gettempdir()
        )).resolve()
        self.fixture_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='loc-guard-', dir=self.fixture_root)
        self.repo = Path(self.temp.name).resolve()
        self.assertTrue(self.repo.is_relative_to(self.fixture_root))
        self.backend = self.repo / 'backend'
        self.backend.mkdir()
        template = self.repo / 'empty-template'
        template.mkdir()
        empty_config = self.repo / 'empty-config'
        empty_config.write_bytes(b'')
        self.env = {}
        for key in ('PATH', 'SystemRoot', 'windir', 'SystemDrive', 'ComSpec', 'PATHEXT'):
            if os.environ.get(key) is not None:
                self.env[key] = os.environ[key]
        self.env.update(
            GIT_DIR=str(self.repo / '.git'), GIT_WORK_TREE=str(self.repo),
            GIT_INDEX_FILE=str(self.repo / '.git/index'),
            GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=str(empty_config),
            GIT_CONFIG_SYSTEM=str(empty_config),
            GIT_AUTHOR_NAME='Synthetic fixture', GIT_AUTHOR_EMAIL='fixture@example.invalid',
            GIT_COMMITTER_NAME='Synthetic fixture', GIT_COMMITTER_EMAIL='fixture@example.invalid',
            GIT_AUTHOR_DATE='2000-01-01T00:00:00Z',
            GIT_COMMITTER_DATE='2000-01-01T00:00:00Z',
            PYTHONIOENCODING='utf-8',
        )
        self.git('init', '--quiet', '--template=' + str(template))

    def tearDown(self):
        # Only this test's freshly allocated directory is disposable.
        self.assertTrue(self.repo.is_relative_to(self.fixture_root))
        self.temp.cleanup()

    def git(self, *args):
        result = subprocess.run(
            ['git', *args], cwd=self.repo, env=self.env,
            capture_output=True, timeout=15,
        )
        self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8', errors='replace'))
        return result.stdout

    def write(self, name, lines, ending=b'\n', final_newline=True):
        target = self.repo / name
        self.assertTrue(target.resolve().is_relative_to(self.repo))
        target.parent.mkdir(parents=True, exist_ok=True)
        data = ending.join([b'SYNTHETIC_BODY = 1'] * lines)
        if final_newline:
            data += ending
        target.write_bytes(data)

    def stage(self, name, lines, **options):
        self.write(name, lines, **options)
        self.git('add', '--', name)

    def guard(self, location='root', extra_env=None):
        env = {**self.env, **(extra_env or {})}
        return subprocess.run(
            [sys.executable, '-B', str(SCRIPT)],
            cwd=self.backend if location == 'backend' else self.repo,
            env=env, capture_output=True, timeout=20,
        )

    def assert_status(self, expected, location='root', extra_env=None):
        result = self.guard(location, extra_env)
        self.assertEqual(result.returncode, expected,
                         (result.stdout + result.stderr).decode('utf-8', errors='replace'))
        self.assertNotIn(b'SYNTHETIC_BODY', result.stdout + result.stderr)
        return result

    def baseline_tree(self):
        # Fixture object construction does not invoke an installed commit hook.
        tree = self.git('write-tree').strip().decode('ascii')
        commit = self.git('commit-tree', tree, '-m', 'Synthetic fixture baseline').strip().decode('ascii')
        self.git('update-ref', 'HEAD', commit)

    def test_empty_index_passes(self):
        self.assert_status(0)

    def test_threshold_and_exclusions_are_unchanged(self):
        spec = importlib.util.spec_from_file_location('loc_guard_constants', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(module.MAX_LINES, 800)
        self.assertEqual(module.EXCLUDE_DIRS, {
            'venv', '.venv', 'node_modules', '__pycache__', '.git', 'migrations_archive'
        })

    def test_non_python_file_is_not_selected(self):
        self.stage('backend/notes.txt', 801)
        self.assert_status(0, 'backend')

    def test_existing_directory_exclusions_are_preserved(self):
        for folder in ('venv', '.venv', 'node_modules', '__pycache__', 'migrations_archive'):
            self.stage('backend/' + folder + '/ignored.py', 801)
        self.assert_status(0, 'backend')

    def test_pure_rename_retains_existing_ACM_filter_policy(self):
        self.stage('backend/before.py', 801)
        self.baseline_tree()
        self.git('rm', '--cached', '--', 'backend/before.py')
        self.stage('backend/after.py', 801)
        self.assertTrue(self.git('diff', '--cached', '--name-status').startswith(b'R100'))
        self.assert_status(0, 'backend')

    def test_deleted_file_is_not_selected(self):
        self.stage('backend/deleted.py', 801)
        self.baseline_tree()
        self.git('rm', '--cached', '--', 'backend/deleted.py')
        self.assert_status(0, 'backend')

    def test_diff_lookup_failure_blocks_instead_of_empty_success(self):
        result = self.assert_status(1, extra_env={'GIT_DIR': str(self.repo / 'missing-git-dir')})
        self.assertIn(b'commit blocked', result.stderr.lower())

    def test_missing_staged_blob_blocks_instead_of_zero_lines(self):
        self.git('update-index', '--add', '--cacheinfo',
                 '100644,' + '1' * 40 + ',backend/missing.py')
        self.assertIn(b'backend/missing.py', self.git('diff', '--cached', '--name-only'))
        result = self.assert_status(1, 'backend')
        self.assertIn(b'commit blocked', result.stderr.lower())


def threshold_case(location, lines):
    def test(self):
        self.stage('backend/threshold.py', lines)
        self.assert_status(1 if lines > 800 else 0, location)
    return test


def partial_case(location, staged, working):
    def test(self):
        self.stage('backend/partial.py', staged)
        self.write('backend/partial.py', working)
        self.assert_status(1 if staged > 800 else 0, location)
    return test


def filename_case(location, name):
    def test(self):
        self.stage(name, 801)
        self.assert_status(1, location)
    return test


def line_ending_case(location, ending, final_newline):
    def test(self):
        self.stage('backend/line_endings.py', 801, ending=ending, final_newline=final_newline)
        self.assert_status(1, location)
    return test


for _location in ('root', 'backend'):
    for _lines in (800, 801):
        setattr(TestStagedLocGuard, f'test_threshold_{_location}_{_lines}',
                threshold_case(_location, _lines))
    for _staged, _working in ((801, 100), (100, 801)):
        setattr(TestStagedLocGuard, f'test_partial_{_location}_{_staged}_{_working}',
                partial_case(_location, _staged, _working))
    for _label, _name in (('space', 'backend/space name.py'),
                          ('unicode', 'backend/caf\u00e9.py'), ('leading_space', ' leading.py')):
        setattr(TestStagedLocGuard, f'test_filename_{_location}_{_label}',
                filename_case(_location, _name))
    for _label, _ending, _final in (('crlf', b'\r\n', True), ('cr', b'\r', True),
                                   ('no_final_newline', b'\n', False)):
        setattr(TestStagedLocGuard, f'test_line_ending_{_location}_{_label}',
                line_ending_case(_location, _ending, _final))


if __name__ == '__main__':
    unittest.main()
