#!/bin/sh
# Run the audio generator with the repo-external venv, at low priority.
# The homelab also serves Minecraft and friends, so: nice 19, idle IO class,
# and 2 threads max (the script itself calls torch.set_num_threads(2)).
#
#   scripts/audio/run.sh              # generate everything still missing
#   scripts/audio/run.sh --limit 100  # resume in small batches
#   scripts/audio/run.sh --dry-run    # list what would be generated
set -e

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
VENV="${CHINO_AUDIO_VENV:-$HOME/.cache/chino-audio-venv}"

if [ ! -x "$VENV/bin/python" ]; then
  echo "No venv at $VENV — run scripts/audio/setup.sh once first." >&2
  exit 1
fi

IONICE=""
if command -v ionice >/dev/null 2>&1; then
  IONICE="ionice -c3"
fi

exec nice -n 19 $IONICE env OMP_NUM_THREADS=2 \
  "$VENV/bin/python" "$HERE/../build-audio.py" "$@"
