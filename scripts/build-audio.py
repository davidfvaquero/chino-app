#!/usr/bin/env python3
"""Generate the app's own Mandarin audio files (Kokoro-82M v1.1-zh, Apache-2.0).

Why: the PWA used to fall back to the browser's `speechSynthesis`, whose Chinese
voice changes on every device. This script bakes one neural voice into small
files shipped with the app (see docs/AUDIO.md and CREDITS.md).

What it does
------------
1. Collects every Chinese text the app shows: HSK 1-3 words
   (`public/data/hsk/{1,2,3}.json`), lesson example sentences
   (`public/data/lessons/{hsk1,hsk2,practical}/*.json`) and theme words +
   phrases (`public/data/themes/theme-*.json`).
2. Synthesises each unique text with Kokoro and writes
   `public/audio/<sha1(text)[:16]>.mp3` (mono 24 kbps) — one file per text,
   named by a stable hash of the text.
3. Writes `public/audio/index.json`: a flat `{ "<text>": "<file>.mp3" }` map.
   The value is a bare file name **relative to index.json's own directory**, so
   the consumer resolves it with
   `new URL(index[text], new URL('audio/index.json', document.baseURI))` and it
   keeps working under a sub-path such as `/chino-app/`.

Idempotent: a text whose file already exists and is non-empty is skipped, so
re-running (or interrupting) resumes where it stopped. Run it in batches with
`--limit` if you want to keep the machine quiet.

Nothing is installed inside the repo: the Python venv lives in
`~/.cache/chino-audio-venv` and the model in `~/.cache/chino-audio-hf`
(`scripts/audio/setup.sh` creates both). Use `scripts/audio/run.sh`, which also
runs the job at low priority (nice/ionice, 2 threads) — the homelab shares CPU
with a Minecraft server.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "public" / "audio"
INDEX_PATH = OUT_DIR / "index.json"

MODEL_REPO = "hexgrad/Kokoro-82M-v1.1-zh"
MODEL_LICENSE = "Apache-2.0"
VOICE = "zf_001"
SAMPLE_RATE = 24000
FORMAT = "mp3"
BITRATE = "24k"

CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
# Chinese punctuation that the TTS frontend understands; anything else is dropped
# from the *spoken* text but kept as the index key (the key is the exact string
# the app passes to speak()).
KEEP_PUNCT = set("，。！？、；：（）《》「」…—～·,.;:!?()'\"")

# Texts used by `--audit` to show what the front-end feeds the model. They cover
# the tone-sandhi cases a learner notices: two/three third tones in a row
# (half-third-tone rule) and 一 / 不 before each tone class.
AUDIT_TEXTS = [
    "你好", "很好", "我很好", "洗手", "三个", "五个人", "你好吗",
    "一", "一个", "一起", "一百", "一二三",
    "不", "不是", "不对", "不客气", "不知道",
    "谢谢", "对不起", "没关系",
]


def collect_texts() -> dict[str, list[str]]:
    """{text: [source file, ...]} for every Chinese text the app can speak."""
    texts: dict[str, list[str]] = {}

    def add(value, source):
        if not isinstance(value, str):
            return
        value = value.strip()
        if value and CJK.search(value):
            texts.setdefault(value, [])
            if source not in texts[value]:
                texts[value].append(source)

    for level in (1, 2, 3):
        path = ROOT / "public" / "data" / "hsk" / f"{level}.json"
        if not path.exists():
            continue
        for item in json.loads(path.read_text(encoding="utf-8")).get("items", []):
            add(item.get("hanzi"), f"hsk/{level}.json")

    for area in ("hsk1", "hsk2", "practical"):
        for path in sorted((ROOT / "public" / "data" / "lessons" / area).glob("lesson-*.json")):
            data = json.loads(path.read_text(encoding="utf-8"))
            for entry in data.get("vocabulary", []):
                add((entry.get("example") or {}).get("hanzi"), f"lessons/{area}/{path.name}")

    for path in sorted((ROOT / "public" / "data" / "themes").glob("theme-*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        for key in ("words", "phrases"):
            for entry in data.get(key, []):
                add(entry.get("hanzi"), f"themes/{path.name}")

    return texts


def file_name(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16] + "." + FORMAT


def spoken(text: str) -> str:
    """Text as fed to the TTS: keep CJK, digits and the punctuation the frontend knows.

    Latin words are dropped (there is no English voice in the pipeline, so a
    stray "wifi" would otherwise become an unknown token); the index key keeps
    the original string the app passes to speak().
    """
    return "".join(
        ch if (CJK.match(ch) or ch in KEEP_PUNCT or ch.isdigit()) else " " for ch in text
    ).strip()


def write_wav(path: Path, samples) -> None:
    import numpy as np

    peak = float(np.max(np.abs(samples))) if len(samples) else 0.0
    if peak > 0:
        samples = samples * (0.98 / peak)
    pcm = np.clip(samples * 32767.0, -32768, 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(pcm.tobytes())


def encode(wav_path: Path, mp3_path: Path) -> None:
    subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(wav_path),
            "-ac", "1", "-ar", str(SAMPLE_RATE), "-b:a", BITRATE,
            "-codec:a", "libmp3lame", str(mp3_path),
        ],
        check=True,
    )


def load_engine(voice_id: str = VOICE):
    """Load Kokoro (KModel) + the misaki v1.1 Chinese frontend, CPU only."""
    import warnings

    warnings.filterwarnings("ignore")
    os.environ.setdefault("OMP_NUM_THREADS", "2")
    os.environ.setdefault("HF_HOME", os.path.expanduser("~/.cache/chino-audio-hf"))
    try:
        import numpy as np
        import torch
        from huggingface_hub import hf_hub_download
        from kokoro.models import KModel
        from misaki.zh import ZHG2P
    except ModuleNotFoundError as exc:  # pragma: no cover - environment problem
        sys.exit(
            f"Missing Python dependency ({exc.name}). Run scripts/audio/setup.sh "
            "once, then re-run this script with ~/.cache/chino-audio-venv/bin/python "
            "(scripts/audio/run.sh does both)."
        )

    torch.set_num_threads(2)
    config = json.loads(Path(hf_hub_download(MODEL_REPO, "config.json")).read_text(encoding="utf-8"))
    model = KModel(config, hf_hub_download(MODEL_REPO, "kokoro-v1_1-zh.pth")).eval()
    voice = torch.load(hf_hub_download(MODEL_REPO, f"voices/{voice_id}.pt"), weights_only=True)
    vocab = config["vocab"]
    g2p = ZHG2P(version="1.1")
    g2p.unk = "❓"  # misaki 0.8.4 forgets this attribute; anything unknown is dropped by the vocab filter

    def synth(text: str):
        phonemes, _ = g2p(spoken(text))
        ids = [vocab[p] for p in phonemes if p in vocab]
        if not ids:
            return None, phonemes
        with torch.no_grad():
            audio = model(ids, voice[min(len(ids), 509) - 1], 1.0)
        return np.asarray(audio), phonemes

    return synth


def audit() -> int:
    """Print the phoneme string the v1.1 front-end produces (no audio, no model)."""
    os.environ.setdefault("HF_HOME", os.path.expanduser("~/.cache/chino-audio-hf"))
    try:
        from misaki.zh import ZHG2P
    except ModuleNotFoundError as exc:
        sys.exit(f"Missing Python dependency ({exc.name}). Run scripts/audio/setup.sh first.")

    g2p = ZHG2P(version="1.1")
    g2p.unk = "❓"
    for text in AUDIT_TEXTS:
        phonemes, _ = g2p(spoken(text))
        print(f"{text:<8} {phonemes}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate the app's own Mandarin audio files (Kokoro-82M v1.1-zh, Apache-2.0).")
    ap.add_argument("--limit", type=int, default=0, help="stop after N new files (batching)")
    ap.add_argument("--force", action="store_true", help="regenerate files that already exist")
    ap.add_argument("--dry-run", action="store_true", help="list what would be generated")
    ap.add_argument("--voice", default=VOICE, help=f"Kokoro voice id (default {VOICE})")
    ap.add_argument("--audit", action="store_true", help="print the phonemes of the tone-sandhi probes and exit")
    args = ap.parse_args()

    if args.audit:
        return audit()

    texts = collect_texts()
    items = sorted(texts)
    print(f"{len(items)} unique texts, {len(texts)} index entries")

    if args.dry_run:
        for text in items:
            print(file_name(text), text)
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tmp_dir = Path(os.path.expanduser("~/.cache/chino-audio-tmp"))
    tmp_dir.mkdir(parents=True, exist_ok=True)

    todo = []
    for text in items:
        target = OUT_DIR / file_name(text)
        if target.exists() and target.stat().st_size > 0 and not args.force:
            continue
        todo.append((text, target))
    print(f"{len(items) - len(todo)} already present, {len(todo)} to generate")
    total_todo = len(todo)
    if args.limit:
        todo = todo[: args.limit]

    generated = 0
    started = time.time()
    if todo:
        synth = load_engine(args.voice)
        wav_path = tmp_dir / "clip.wav"
        for text, target in todo:
            audio, phonemes = synth(text)
            if audio is None:
                print(f"  SKIP (no phonemes) {text!r} -> {phonemes!r}")
                continue
            write_wav(wav_path, audio)
            encode(wav_path, target)
            generated += 1
            if generated % 25 == 0 or generated == len(todo):
                done = len(items) - total_todo + generated
                print(f"  {done}/{len(items)}  {time.time() - started:.0f}s  {text}", flush=True)

    # The index covers every text we actually produced, so every entry points at
    # an existing non-empty file (texts with nothing speakable, e.g. a lone
    # English word, are left out and fall back to the browser TTS).
    index = {}
    for text in items:
        target = OUT_DIR / file_name(text)
        if target.exists() and target.stat().st_size > 0:
            index[text] = file_name(text)
    INDEX_PATH.write_text(
        json.dumps(index, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )

    sizes = [p.stat().st_size for p in OUT_DIR.glob("*." + FORMAT)]
    total = sum(sizes)
    print(
        f"done: {generated} generated, {len(sizes)} files, "
        f"{total / 1024 / 1024:.2f} MB, {time.time() - started:.0f}s "
        f"(voice {args.voice}, {MODEL_REPO}, {MODEL_LICENSE})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
