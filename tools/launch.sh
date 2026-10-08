#!/bin/sh
# Launches Claude Code with pumpt, starting the MLX model server first
# if nothing answers on the port. The mod warms the model up on session start.
#
#   sh tools/launch.sh [claude arguments...]
#
# Env: PORT (8080), MODEL (~/models/torchcast-decision-12b-8bit), VENV (~/.pumpt-mlx).
# The server keeps running after Claude Code exits (about 11 GB resident);
# stop it with `pkill -f mlx_lm.server`. Its log is ~/.pumpt/server.log.
set -e
DIR=$(cd "$(dirname "$0")/.." && pwd)
PORT=${PORT:-8080}
MODEL=${MODEL:-$HOME/models/torchcast-decision-12b-8bit}
VENV=${VENV:-$HOME/.pumpt-mlx}
URL="http://127.0.0.1:$PORT/v1/models"

if ! curl -s -m 2 "$URL" >/dev/null 2>&1; then
  [ -x "$VENV/bin/mlx_lm.server" ] || { echo "no mlx_lm.server in $VENV; run sh tools/mlx-convert.sh first" >&2; exit 1; }
  [ -f "$MODEL/config.json" ] || { echo "no model at $MODEL; run sh tools/mlx-convert.sh first" >&2; exit 1; }
  mkdir -p "$HOME/.pumpt"
  echo "starting mlx_lm.server on :$PORT (log: ~/.pumpt/server.log)"
  nohup "$VENV/bin/mlx_lm.server" --model "$MODEL" --host 127.0.0.1 --port "$PORT" >"$HOME/.pumpt/server.log" 2>&1 &
  i=0
  until curl -s -m 2 "$URL" >/dev/null 2>&1; do
    i=$((i + 1))
    [ "$i" -gt 90 ] && { echo "the server did not come up; see ~/.pumpt/server.log" >&2; exit 1; }
    sleep 1
  done
  echo "model server up"
fi

exec claude --plugin-dir "$DIR" "$@"
