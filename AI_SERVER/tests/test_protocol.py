"""Checks for the documented firmware source snapshot and JSON examples.

These checks do not validate a robot wire contract or claim hardware
compatibility. Those require Dev 3 confirmation first.
"""

import hashlib
import json
from pathlib import Path
import re


SERVER_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = SERVER_ROOT.parent
SNAPSHOT = SERVER_ROOT / "docs" / "firmware-snapshot-d2-s2-05-fix.json"
HISTORICAL_SNAPSHOT = SERVER_ROOT / "docs" / "firmware-snapshot-d2-s1-05.json"
PROTOCOL = SERVER_ROOT / "docs" / "protocol.md"


def test_firmware_snapshot_hashes_match_workspace_sources():
    snapshot = json.loads(SNAPSHOT.read_text(encoding="utf-8"))
    assert snapshot["dev3_protocol_confirmation"] == "PENDING"
    assert snapshot["board_and_build_configuration"] == "PENDING"
    assert snapshot["files"]

    assert snapshot["baseline_status"] == "SOURCE_HASHES_ONLY_NOT_BUILD_OR_HARDWARE_APPROVAL"
    assert hashlib.sha256(HISTORICAL_SNAPSHOT.read_bytes()).hexdigest() == snapshot["previous_snapshot"]["sha256"]
    problems = []
    for source in snapshot["files"]:
        path = (SERVER_ROOT / source["path"]).resolve()
        assert path.is_relative_to(WORKSPACE_ROOT.resolve())
        if not path.is_file():
            problems.append(f"MISSING: {source['path']}")
            continue
        canonical = path.read_bytes().replace(b"\r\n", b"\n")
        if hashlib.sha256(canonical).hexdigest() != source["sha256"]:
            problems.append(f"CHANGED: {source['path']}")
    assert not problems, "\n".join(problems)


def test_documented_json_examples_are_valid_json():
    protocol = PROTOCOL.read_text(encoding="utf-8")
    examples = re.findall(r"```json\s*\n(.*?)\n```", protocol, flags=re.DOTALL)
    assert examples, "protocol document must include examples"
    for example in examples:
        json.loads(example)


def test_runtime_schema_remains_pending_until_contract_confirmation():
    protocol = PROTOCOL.read_text(encoding="utf-8")
    assert "Schema runtime robot: PENDING" in protocol
    assert "messages.py" in protocol
    assert "validator.py" in protocol
