#!/bin/sh
set -eu
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
VIEWER_PYTHON=${CORONARY_PYTHON:-"$APP_DIR/.venv/bin/python"}
cd "$APP_DIR"
exec "$VIEWER_PYTHON" -m backend.launch "$@"
