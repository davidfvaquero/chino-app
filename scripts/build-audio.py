#!/usr/bin/env python3
"""Generate the app's own Mandarin audio files (Kokoro-82M v1.1-zh, Apache-2.0).

Why: the PWA used to fall back to the browser's `speechSynthesis`, whose Chinese
voice changes on every device. This script bakes one neural voice into small
files shipped with the app (see docs/AUDIO.md and CREDITS.md).

What it does
------------
1. Collects every Chinese text the app shows: HSK 1-3 words
   (`public/data/hsk/{1,2,3}.json`), lesson example sentences
   (`public/data/lessons/{hsk1,hsk2,practical}/*.json`), theme words + phrases
   (`public/data/themes/theme-*.json`) and the lines of every dialogue
   (`public/data/dialogues/dialogue-*.json`).
2. Synthesises each unique text with Kokoro and writes
   `public/audio/<sha1(text)[:16]>.mp3` (mono 24 kbps) — one file per text,
   named by a stable hash of the text.
3. Writes `public/audio/index.json`: a flat `{ "<key>": "<file>.mp3" }` map.
   The value is a bare file name **relative to index.json's own directory**, so
   the consumer resolves it with
   `new URL(index[key], new URL('audio/index.json', document.baseURI))` and it
   keeps working under a sub-path such as `/chino-app/`.

Voices
------
A dialogue is spoken by two people; to hear the difference, speaker A uses the
default voice `zf_001` and speaker B the second speaker `zm_010` (both Apache-2.0,
see CREDITS.md). The default voice keeps the **plain text** as its index key and
`sha1(text)` as its file name (unchanged, so existing names never move). A
non-default voice (variant `"b"`) uses `<voice>:<text>` as the key and
`sha1("<voice>\x00<text>")` as the file name, so the same line can ship two
voices without either clobbering the other. Collect the default texts with
`collect_texts()`, a variant's with `collect_variant_texts(voice)`.

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
# Two voices so a dialogue's two speakers sound different: speaker A uses the
# original zf_001, speaker B the second speaker zm_010. The variant name
# ("a"/"b") is the index-key prefix and the file-name seed for a non-default
# voice (the default voice keeps the bare text and sha1(text), unchanged).
DEFAULT_VOICE = "a"
VOICES = {"a": "zf_001", "b": "zm_010"}
SAMPLE_RATE = 24000
FORMAT = "mp3"
BITRATE = "24k"

CJK = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
# Chinese punctuation that the TTS frontend understands; anything else is dropped
# from the *spoken* text but kept as the index key (the key is the exact string
# the app passes to speak()).
KEEP_PUNCT = set("，。！？、；：（）《》「」…—～·,.;:!?()'\"\"")

# Texts used by `--audit` to show what the front-end feeds the model. They cover
# the tone-sandhi cases a learner notices: two/three third tones in a row
# (half-third-tone rule) and 一 / 不 before each tone class.
AUDIT_TEXTS = [
    "你好", "很好", "我很好", "洗手", "三个", "五个人", "你好吗",
    "一", "一个", "一起", "一百", "一二三",
    "不", "不是", "不对", "不客气", "不知道",
    "谢谢", "对不起", "没关系",
]


def _add(texts: dict[str, list[str]], value, source: str) -> None:
    """Record `value` (a speakable Chinese string) as coming from `source`."""
    if not isinstance(value, str):
        return
    value = value.strip()
    if value and CJK.search(value):
        texts.setdefault(value, [])
        if source not in texts[value]:
            texts[value].append(source)


def dialogue_lines() -> list[tuple[str, str, object]]:
    """(source, speaker, zh) for every line of every dialogue."""
    out: list[tuple[str, str, object]] = []
    for path in sorted((ROOT / "public" / "data" / "dialogues").glob("dialogue-*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        for line in data.get("lines", []):
            out.append((f"dialogues/{path.name}", str(line.get("speaker")), line.get("zh")))
    return out


def collect_texts() -> dict[str, list[str]]:
    """{text: [source file, ...]} for every default-voice Chinese text."""
    texts: dict[str, list[str]] = {}

    def add(value, source):
        _add(texts, value, source)

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

    # Dialogues: speaker A keeps the default voice; speaker B is collected
    # separately by collect_variant_texts().
    for source, speaker, zh in dialogue_lines():
        if speaker != "B":
            add(zh, source)

    return texts


def collect_variant_texts(voice: str) -> dict[str, list[str]]:
    """{text: [source, ...]} for the texts spoken with a non-default voice.

    Today the only variant is `"b"` — speaker B of every dialogue. An unknown or
    default variant collects nothing (its texts live in collect_texts()).
    """
    texts: dict[str, list[str]] = {}
    if voice == DEFAULT_VOICE:
        return texts
    for source, speaker, zh in dialogue_lines():
        if speaker == "B":
            _add(texts, zh, source)
    return texts


def voice_texts(voice: str) -> dict[str, list[str]]:
    """The text set generated for `voice` (default or variant)."""
    return collect_texts() if voice == DEFAULT_VOICE else collect_variant_texts(voice)


def index_key(text: str, voice: str = DEFAULT_VOICE) -> str:
    """Index key for `text`: the plain text for the default voice, else
    `<voice>:<text>` (so the same line can ship two voices)."""
    return text if voice == DEFAULT_VOICE else f"{voice}:{text}"


def file_name(text: str, voice: str = DEFAULT_VOICE) -> str:
    return hashlib.sha1(seed_name(text, voice).encode("utf-8")).hexdigest()[:16] + "." + FORMAT


def seed_name(text: str, voice: str = DEFAULT_VOICE) -> str:
    """The string the file name hashes: the bare text for the default voice,
    else '<voice>\x00<text>' (so a second voice never collides with the first)."""
    return text if voice == DEFAULT_VOICE else f"{voice}\x00{text}"


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


def load_engine(voice_id: str = VOICES[DEFAULT_VOICE]):
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


def build_index() -> dict[str, str]:
    """{key: file} for every text that has a non-empty file on disk, over the
    default voice and every variant — written from disk, so it stays correct
    after a partial or interrupted run."""
    index: dict[str, str] = {}
    for voice in VOICES:
        for text in voice_texts(voice):
            name = file_name(text, voice)
            target = OUT_DIR / name
            if target.exists() and target.stat().st_size > 0:
                index[index_key(text, voice)] = name
    return index


def main() -> int:
    ap = argparse.ArgumentParser(description="Generate the app's own Mandarin audio files (Kokoro-82M v1.1-zh, Apache-2.0).")
    ap.add_argument("--limit", type=int, default=0, help="stop after N new files (batching)")
    ap.add_argument("--force", action="store_true", help="regenerate files that already exist")
    ap.add_argument("--dry-run", action="store_true", help="list what would be generated")
    ap.add_argument("--voice", default=DEFAULT_VOICE, choices=sorted(VOICES),
                    help=f"voice variant to generate: {', '.join(f'{k}={v}' for k, v in sorted(VOICES.items()))} (default {DEFAULT_VOICE})")
    ap.add_argument("--audit", action="store_true", help="print the phonemes of the tone-sandhi probes and exit")
    args = ap.parse_args()

    if args.audit:
        return audit()

    voice = args.voice
    texts = voice_texts(voice)
    items = sorted(texts)
    print(f"voice {voice} ({VOICES[voice]}): {len(items)} unique texts")

    if args.dry_run:
        for text in items:
            print(f"{index_key(text, voice)}\t{file_name(text, voice)}")
        return 0

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tmp_dir = Path(os.path.expanduser("~/.cache/chino-audio-tmp"))
    tmp_dir.mkdir(parents=True, exist_ok=True)

    todo = []
    for text in items:
        target = OUT_DIR / file_name(text, voice)
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
        synth = load_engine(VOICES[voice])
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
    index = build_index()
    INDEX_PATH.write_text(
        json.dumps(index, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )

    sizes = [p.stat().st_size for p in OUT_DIR.glob("*." + FORMAT)]
    total = sum(sizes)
    print(
        f"done: {generated} generated, {len(sizes)} files, "
        f"{total / 1024 / 1024:.2f} MB, {time.time() - started:.0f}s "
        f"(voice {voice}={VOICES[voice]}, {MODEL_REPO}, {MODEL_LICENSE})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
