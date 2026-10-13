#!/usr/bin/env python3
"""Runs the contract's declaration validator over .contract-out/.

Needs any python3 with the contract's requirements installed
(`pip install -r .contract/requirements.txt`). The validator exits 0 whether
or not the declarations are valid, so this reads its `[valid, errors]` JSON.
"""
import json
import subprocess
import sys

MIN_VALID = 3

proc = subprocess.run(
    [
        sys.executable,
        ".contract/declarations/validate_declarations.py",
        "--site-suffix",
        "-lychee-land",
        ".contract-out",
        ".contract/declarations/vocabulary.yml",
    ],
    capture_output=True,
    text=True,
)
if proc.returncode != 0:
    print(proc.stdout, proc.stderr, file=sys.stderr)
    sys.exit(f"validator crashed (exit {proc.returncode})")
valid, errors = json.loads(proc.stdout)
print(f"valid: {valid}")
print(f"errors: {errors}")
if errors:
    sys.exit("declaration validation failed")
if len(valid) < MIN_VALID:
    sys.exit(f"expected at least {MIN_VALID} valid declarations, got {len(valid)}")
