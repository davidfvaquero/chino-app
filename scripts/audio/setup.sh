#!/bin/sh
# One-time setup for scripts/build-audio.py. Everything lands OUTSIDE the repo:
#
#   ~/.cache/chino-audio-venv   python venv (torch CPU, kokoro, misaki zh, ffmpeg-free)
#   ~/.cache/chino-audio-hf     HuggingFace cache (Kokoro-82M-v1.1-zh, ~330 MB)
#
# Needs python3 (>=3.10) and ffmpeg on PATH. Re-running is safe.
set -e

VENV="${CHINO_AUDIO_VENV:-$HOME/.cache/chino-audio-venv}"
PY="${CHINO_AUDIO_PY:-python3}"

if [ ! -x "$VENV/bin/python" ]; then
  "$PY" -m venv "$VENV"
fi
PIP="$VENV/bin/python -m pip"

$PIP install --upgrade pip wheel >/dev/null

# 1. torch, CPU build only (the model is tiny; no CUDA download).
$PIP install --index-url https://download.pytorch.org/whl/cpu torch

# 2. Shared deps (spacy, thinc, curated-transformers...) via the zh extra of an
#    older misaki. jieba has no wheel, so this one step must stay binary-only:
#    pip then settles on a misaki whose `zh` extra needs nothing unbuildable.
$PIP install --only-binary=:all: "misaki[zh]"

# 3. kokoro + its deps. On Python 3.13 pip resolves kokoro 0.2.2, which predates
#    Chinese support in its KPipeline; we only use its KModel (the vocoder), so
#    that is fine.
$PIP install --only-binary=:all: kokoro soundfile espeakng-loader

# 4. misaki with the Chinese v1.1 frontend (Bopomofo phonemes + tone sandhi) that
#    Kokoro-82M-v1.1-zh expects. 0.8.5+ declares `python_requires <3.13`, but it
#    is pure Python and works on 3.13, hence --ignore-requires-python. jieba
#    comes from source here (pure Python, no compiler needed).
$PIP install --ignore-requires-python "misaki[zh]==0.8.4"

"$VENV/bin/python" -c "import kokoro.models, misaki.zh, torch; print('ok', torch.__version__)"
echo "Done. Now run: scripts/audio/run.sh"
