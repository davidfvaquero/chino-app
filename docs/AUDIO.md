# Audio — the app's own Mandarin voice

The app used to speak Chinese through the browser's `speechSynthesis`, so the
voice (and often the tone quality) changed on every phone. This folder documents
the fix: **the audio is pre-generated and shipped with the app**.

- Output: `public/audio/<sha1(text)[:16]>.mp3` + `public/audio/index.json`
- Generator: `scripts/build-audio.py`, driven by `scripts/audio/{setup,run}.sh`
- Voice: **Kokoro-82M v1.1-zh**, speaker `zf_001` — Apache-2.0, see
  [`CREDITS.md` §8](../CREDITS.md) for the licence and the provenance of the
  voices.

## What is shipped

| | |
| --- | --- |
| Unique texts | 1 104 |
| Audio files | 1 104 (one per text) |
| Total size | **4.13 MB** (4 335 096 bytes; 5.9 MB of disk blocks) |
| `index.json` | 37 KB, 1 104 entries |
| Audio length | 1 290 s (21.5 min); mean 1.17 s, min 0.53 s, max 2.88 s |
| Format | MP3, mono, 24 kbps, 24 kHz, peak-normalised to −1 dBFS |
| Budget | < 60 MB — used ~7 % |

Coverage: every word of HSK 1–3 (`public/data/hsk/{1,2,3}.json`), the example
sentence of every lesson vocabulary entry (`public/data/lessons/{hsk1,hsk2,practical}/lesson-*.json`)
and every word + phrase of the themes (`public/data/themes/theme-*.json`).

MP3 rather than Ogg/Opus on purpose: it is the only low-bitrate voice codec that
plays everywhere, including iOS Safari. A 1-second clip is ~4 KB, so a lesson
page costs a few tens of KB.

## `index.json` format

A **flat map from the exact text to a bare file name**:

```json
{"你好":"0e521a2bb52194a0.mp3","一":"d274eee8a175062a.mp3"}
```

- The key is the string the app passes to `speak()` (same punctuation, no
  trimming by the consumer).
- The value is a **file name only**, relative to `index.json`'s own directory —
  there is no path and no leading slash, so the same file works at `/` and under
  a sub-path such as `/chino-app/`. Resolve it against the index URL, never
  against the origin:

```js
const indexUrl = new URL('audio/index.json', document.baseURI);
const index = await (await fetch(indexUrl)).json();
const file = index[text];                       // 'abc123.mp3' | undefined
if (file) audio.src = new URL(file, indexUrl).href;   // -> .../audio/abc123.mp3
```

- A text that is **not** in the index has no file: the caller must fall back to
  `speechSynthesis` (see `src/audio.js`). The pipeline has no English voice, so
  the Latin part of a mixed string is not spoken — `wifi密码是什么？` is generated
  from `密码是什么？` while the index key stays the original string. A text whose
  Chinese is empty is left out of the index entirely, so the fallback path stays
  exercised.
- The file name is a hash of the text, so regenerating never changes names and
  the HTTP cache keeps working.

## Regenerating

Everything runs **outside the repo**: the venv is `~/.cache/chino-audio-venv`,
the model `~/.cache/chino-audio-hf` (HuggingFace cache, ~330 MB), and the
temporary WAVs `~/.cache/chino-audio-tmp`. Nothing to add to `.gitignore` — the
repository only ever gains `public/audio/*.mp3` and the index.

```sh
scripts/audio/setup.sh          # once: venv + torch CPU + kokoro + misaki zh frontend
scripts/audio/run.sh            # generate everything still missing
scripts/audio/run.sh --limit 100   # …in batches (resumable)
scripts/audio/run.sh --dry-run  # list what would be generated
scripts/audio/run.sh --force    # regenerate even existing files
scripts/audio/run.sh --audit    # print the phonemes of the tone-sandhi probes
npm run data:audio              # same as scripts/audio/run.sh
```

The script is **idempotent**: a text whose file already exists and is non-empty
is skipped, and the index is rewritten from what is actually on disk, so an
interrupted run resumes exactly where it stopped (re-running after a full
generation does nothing and takes 0.06 s).

### Keeping the machine quiet

The homelab also runs a Minecraft server, so `run.sh` starts the job with
`nice -n 19`, `ionice -c3` and `OMP_NUM_THREADS=2`; the script additionally calls
`torch.set_num_threads(2)`. On a 16-core box the sustained load stays around
0.2 cores, and a full 1 104-file run took **469 s** (≈0.4 s per clip, CPU-only).

## Quality check

`scripts/audio/run.sh --audit` prints the phoneme string the v1.1 front-end hands
to the vocoder — the fastest way to see that the tones are right, because a wrong
tone cannot be fixed later in the pipeline. Real output:

```
你好       ㄋㄧ2ㄏㄠ3            一        ㄧ1
很好       ㄏㄣ2ㄏㄠ3            一个       ㄧ2ㄍㄜ5
我很好     我3ㄏㄣ2ㄏㄠ3          一起       ㄧ4ㄑㄧ3
洗手       ㄒㄧ2ㄕㄡ3            一百       ㄧ4ㄅㄞ3
三个       ㄙㄢ1ㄍㄜ5            一二三      ㄧ1ㄦ4ㄙㄢ1
五个人      ㄨ3ㄍㄜ5/ㄖㄣ2         不        ㄅㄨ4
你好吗      ㄋㄧ2ㄏㄠ3/ㄇㄚ5        不是       ㄅㄨ2ㄕ十4
谢谢       ㄒㄝ4ㄒㄝ5            不对       ㄅㄨ2ㄉ为4
对不起      ㄉ为4ㄅㄨ5ㄑㄧ3         不客气      ㄅㄨ2ㄎㄜ4ㄑㄧ5
没关系      ㄇㄟ2ㄍ万1ㄒㄧ5         不知道      ㄅㄨ4ㄓ十1ㄉㄠ4
```

Reading of the sandhi cases (all correct):

- **Third-tone chains** use the half-third-tone rule: 你好 `ㄋㄧ2ㄏㄠ3`,
  很好 `ㄏㄣ2ㄏㄠ3`, 洗手 `ㄒㄧ2ㄕㄡ3`, and 我很好 keeps the full third tone on
  the utterance-initial 我 (`我3ㄏㄣ2ㄏㄠ3`). A 3rd tone before a non-3rd tone is
  untouched: 五个人 `ㄨ3ㄍㄜ5…`, 三个 `ㄙㄢ1ㄍㄜ5`.
- **一**: `ㄧ1` alone and in counting (一二三 `ㄧ1ㄦ4ㄙㄢ1`), `ㄧ2` before a 4th
  tone (一个 `ㄧ2ㄍㄜ5`), `ㄧ4` before a 3rd tone (一起 `ㄧ4ㄑㄧ3`, 一百 `ㄧ4ㄅㄞ3`).
- **不**: `ㄅㄨ4` alone and before a 1st tone (不知道 `ㄅㄨ4ㄓ十1ㄉㄠ4`), `ㄅㄨ2`
  before a 4th tone (不是, 不对, 不客气), and the neutral tone in 对不起
  (`ㄉ为4ㄅㄨ5ㄑㄧ3`) — which is how it is actually said.
- Neutral tones are marked `5` (谢谢 `ㄒㄝ4ㄒㄝ5`, 没关系 `ㄇㄟ2ㄍ万1ㄒㄧ5`).

Silence check: the 1 104 clips have no near-empty file (shortest 0.53 s, none
under 0.3 s) and a 10-file sample measures −17 to −22 dB mean / −0.5 to −1.2 dB
peak, i.e. real speech at a consistent level.

## Not used, on purpose

- **Piper** — the licence of the concrete Chinese voices is unclear.
- **Online services** (Edge TTS, Google, …) — the app must stay free, offline and
  redistributable.
- The model weights themselves are not committed: only the audio they generated.
