#!/usr/bin/env python3
"""Runs the contract's declaration validator over .contract-out/.

Needs any python3 with the contract's requirements installed
(`pip install -r .contract/requirements.txt`). The validator exits 0 whether
or not the declarations are valid, so this reads its `[valid, errors]` JSON.
"""
import json
import subprocess
import sys

EXPECTED = {"app-lychee-land", "blog-lychee-land", "old-lychee-land"}

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
try:
    parsed = json.loads(proc.stdout)
    if not (isinstance(parsed, list) and len(parsed) == 2):
        raise ValueError("not a 2-element [valid, errors] list")
    valid, errors = parsed
    names = {d["name"] for d in valid}
except (ValueError, KeyError, TypeError) as exc:
    print(proc.stdout, proc.stderr, file=sys.stderr)
    sys.exit(f"unexpected validator output: {exc}")
print(f"valid: {sorted(names)}")
print(f"errors: {errors}")
if errors:
    sys.exit("declaration validation failed")
if names != EXPECTED or len(valid) != len(EXPECTED):
    sys.exit(f"valid declarations {sorted(names)} != expected {sorted(EXPECTED)}")
