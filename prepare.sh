#!/bin/sh
set -eu
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
VIEWER_PYTHON=${CORONARY_PYTHON:-"$APP_DIR/.venv/bin/python"}
if [ ! -x "$VIEWER_PYTHON" ]; then
  echo "Viewer Python not found: $VIEWER_PYTHON" >&2
  echo "Use the existing viewer environment or set CORONARY_PYTHON to its Python executable." >&2
  exit 1
fi
cd "$APP_DIR"
exec "$VIEWER_PYTHON" -m backend.prepare_cases "$@"
