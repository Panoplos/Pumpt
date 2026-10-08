#!/bin/sh
# Builds an 8-bit MLX copy of torchcast-decision-12b and prints how to serve it.
#
#   sh tools/mlx-convert.sh [bits]      (default 8; 4 halves the size, loosens calibration)
#
# Needs Python 3.10+ and ~35 GB free (22 GB download, ~12.5 GB output at 8 bits).
# The checkpoint's config omits two Gemma 4 attention fields that mlx-lm needs
# (one global KV head of width 512 on the full-attention layers), so the files
# are staged with a patched config before converting.
set -e
BITS=${1:-8}
VENV=${VENV:-$HOME/.pumpt-mlx}
OUT=${OUT:-$HOME/models/torchcast-decision-12b-${BITS}bit}
SRC=$HOME/models/torchcast-decision-12b-src
REPO=torchcast-ai/torchcast-decision-12b
REV=49107b5589bf2dc4ec3f5acd54316971dd5978b1   # the pinned v1.0.0 artifact

[ -x "$VENV/bin/python" ] || python3 -m venv "$VENV"
"$VENV/bin/pip" install --quiet --upgrade pip mlx-lm huggingface_hub

echo "downloading $REPO@$REV (22 GB; resumes if interrupted)"
SNAP=$("$VENV/bin/python" - <<EOF
from huggingface_hub import snapshot_download
print(snapshot_download("$REPO", revision="$REV"))
EOF
)

rm -rf "$SRC" && mkdir -p "$SRC"
for f in "$SNAP"/*; do ln -s "$(readlink -f "$f")" "$SRC/$(basename "$f")"; done
rm "$SRC/config.json"
"$VENV/bin/python" - "$SNAP/config.json" "$SRC/config.json" <<'EOF'
import json, sys
d = json.load(open(sys.argv[1]))
d["text_config"]["num_global_key_value_heads"] = 1
d["text_config"]["global_head_dim"] = 512
json.dump(d, open(sys.argv[2], "w"), indent=1)
EOF

rm -rf "$OUT"
"$VENV/bin/mlx_lm.convert" --hf-path "$SRC" --mlx-path "$OUT" -q --q-bits "$BITS"
echo
echo "done: $OUT"
echo "serve it with:"
echo "  $VENV/bin/mlx_lm.server --model $OUT --port 8080"
