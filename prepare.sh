#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
exec "${CORONARY_PYTHON:-.venv/bin/python}" -m backend.prepare_patients "$@"
