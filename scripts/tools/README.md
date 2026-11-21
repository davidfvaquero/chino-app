# Reference Scripts (Dict ES Quality Sampling)

These scripts were used for the Spanish dictionary quality audit (see `docs/DICT-ES-QUALITY.md`).

## Scripts

- `sample_quality.mjs` — Generates a stratified random sample of 320 entries from `data-work/dict-es/priority.json` (100 T1, 100 T2 common, 100 T2 rare, 20 template). Output: `data-work/dict-es/quality_sample.json`.

- `extract_sample.mjs` — Enriches the sample IDs with full English and Spanish dictionary entries from `public/data/dict/shards/` and `public/data/es/dict/shards/`. Output: `data-work/dict-es/quality_sample_full.json`.

## Usage

```bash
# 1. Generate the sample
node scripts/tools/sample_quality.mjs

# 2. Extract full entry data for manual evaluation
node scripts/tools/extract_sample.mjs
```

These are reference tools — not part of the regular data pipeline (`npm run data`).