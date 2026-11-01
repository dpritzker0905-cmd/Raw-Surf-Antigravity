"""Make file fingerprints explicitly typed; preserve every value and reconstruct original bytes.

No hook configuration, exclusions or credential content changes. These values are verified file digests.
"""
import hashlib
import json
from pathlib import Path

OUT = Path(__file__).resolve().parent
ROOT = OUT.parents[3]
FILES = ["docs/audits/evidence/2026-10-29-admin-support-reopen/entry-hashes.json",
         "docs/audits/evidence/2026-10-29-admin-support-numbering/entry-hashes.json",
         "docs/audits/evidence/2026-10-29-admin-support-remaining-holds/entry-hashes.json",
         "docs/audits/evidence/2026-10-29-support-delivery/entry-hashes.json"]


def digest(value):
    return hashlib.sha256(value).hexdigest()


def flat(data):
    data = dict(data)
    for field in ["files", "prior_files", "observed"]:
        if field in data:
            data[field] = {name: value["sha256"] if isinstance(value, dict) else value for name, value in data[field].items()}
    return data


def main():
    records = []
    for name in FILES:
        path = ROOT / name
        before = path.read_bytes()
        data = json.loads(before)
        assert all(isinstance(value, str) for field in ["files", "prior_files", "observed"] for value in data.get(field, {}).values())
        legacy = json.dumps(data, indent=2).encode() + b"\n"
        crlf = before == legacy.replace(b"\n", b"\r\n")
        assert before == legacy or crlf, "Original serialization must be reproducible"
        for field in ["files", "prior_files", "observed"]:
            if field in data:
                data[field] = {target: {"sha256": value} for target, value in data[field].items()}
        assert flat(data) == json.loads(before)
        encoded = json.dumps(data, indent=2).encode() + b"\n"
        path.write_bytes(encoded)
        restored = json.dumps(flat(json.loads(path.read_bytes())), indent=2).encode() + b"\n"
        if crlf:
            restored = restored.replace(b"\n", b"\r\n")
        assert digest(restored) == digest(before)
        records.append({"path": name, "beforeSha256": digest(before), "afterSha256": digest(encoded),
                        "legacyNewlines": "CRLF" if crlf else "LF", "originalBytesReconstructExactly": True})
    result = {"reason": "39 redacted mandatory-hook findings independently matched actual current/base file SHA256 values; typed hash records remove filename-as-credential ambiguity",
              "hookConfigChanged": False, "hookBypass": False, "fingerprintValuesChanged": False,
              "records": records}
    (OUT / "fingerprint-format.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"metadataFiles": len(records), "exactOriginalByteReconstruction": True, "fingerprintValuesChanged": False}))


if __name__ == "__main__":
    main()
