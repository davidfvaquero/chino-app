# Verification Index

This file is the index of all verification reports. Full reports have been moved to [`docs/verification-archive.md`](docs/verification-archive.md).

---

## Summary Table

| Block | Task ID | Verifier | Scope | Verdict |
|-------|---------|----------|-------|---------|
| 1 | t_0b05b382 | gratis | Dictionary engine, SRS, audio, Dictionary/Review screens, PWA shell, data pipeline | ✅ **VERIFIED** |
| 2 | t_6a4cb4e6 | gratis | Lesson engine (L1), Strokes (S), Reader (R), Strokematch (M) | ✅ **VERIFIED** |
| 3 | t_bc21fb50 | barato | LC1/LC2 (lessons 2-10), SE (sentences), RC1/RC2 (readings 2-6) | ✅ **VERIFIED** |
| 4+App | t_b6277815 | barato | Complete app + README, global checks | ✅ **VERIFIED** (3 minor fixes) |
| 5 | t_e06c00f0 | barato | NUM, THC1, THC2, G1 (games), G2 (timed quiz) | ✅ **VERIFIED** (3 minor fixes) |
| 6 | t_fea29e70 | barato | RADD/RADU, PASTE, SET | ✅ **VERIFIED** (1 minor data fallo) |
| 7 | t_cae73e1c | gratis | HARD, HOME, STROKES multi-char | ✅ **VERIFIED** |
| 8 | t_345a147d → t_59f346e3 → t_c3483c06 | barato → barato → fuerte | RD1/RD2, GRC1/GRC2, RBT, H2C1/H2C2 | ✅ **VERIFIED** (after 2 repair cycles) |
| 9 | t_420d754d | gratis | FIX (radicales), RD0, GR, MNEMO, H2D, H2I | ✅ **VERIFIED** (1 env fallo) |
| 10 | t_b507fa84 | gratis | DEPL (homelab) + GHP (GitHub Pages) | ✅ **VERIFIED** |
| 11 | t_5ade2d30 | barato | T1, T3, T5, T7, T9, T11 (Spanish content by gratis) | ✅ **VERIFIED** (1 external fallo) |
| 12 | t_35573b22 | gratis | COREA, COREB, T2, T4, T6, T8, T10, T12 (Spanish infra by barato) | ✅ **VERIFIED** (UI headless pending) |
| Mobile Layout | t_2d2d379e | gratis | Mobile card layout (English below pinyin) | ✅ **VERIFIED** |
| Spanish Interface | t_271f8b7f | gratis | Spanish UI translation by barato | ❌ **5 FALLOS** (blocked) |
| Exercises Mobile | t_6cd1b3ff | haiku | Touch exercises (MATCH, choose, order, listen) | ✅ **VERIFIED** (external fallos) |
| Block 14 | t_b6925301 | haiku | Audio, review, plan, exam | ❌ **FALLO** |

---

## Quick Links to Full Reports

All detailed reports are in [`docs/verification-archive.md`](docs/verification-archive.md):

- [Block 1](docs/verification-archive.md#verification-report-block-1-t_0b05b382)
- [Block 2](docs/verification-archive.md#verification-report-block-2-t_6a4cb4e6)
- [Bloque 3](docs/verification-archive.md#verificacion-bloque-3-t_bc21fb50)
- [Blocks 5-6 (fuerte)](docs/verification-archive.md#revision-fuerte-bloques-5-6-toneab-ton-pin-th-dict-backup-stats-t_5d7e04b5)
- [Bloque 6 (herramientas)](docs/verification-archive.md#verificacion-bloque-6-herramientas-raddradu-paste-set-t_fea29e70)
- [Bloque 5](docs/verification-archive.md#verificacion-bloque-5-num-thc1-thc2-g1-g2-t_e06c00f0)
- [Bloque 7](docs/verification-archive.md#verificacion-bloque-7-home-palabras-dificiles-y-menus-t_cae73e1c)
- [Block 4 + App](docs/verification-archive.md#verification-report-block-4-app-completa-y-readme-t_b6277815)
- [Block 10](docs/verification-archive.md#verification-report-block-10-homelab-deployment-github-pages-t_b507fa84)
- [Block 12](docs/verification-archive.md#verification-report-block-12-infraestructura-y-contenido-en-espanol-hechos-por-barato-t_35573b22)
- [Mobile Card Layout](docs/verification-archive.md#verification-report-mobile-card-layout-t_2d2d379e)
- [Spanish Interface](docs/verification-archive.md#verification-report-spanish-interface-t_271f8b7f)
- [Block 9](docs/verification-archive.md#verification-report-block-9-limpieza-radicales-etimologia-gramatica-motor-y-hsk-2-datos-indice-t_420d754d)
- [Bloque 8 (1er ciclo)](docs/verification-archive.md#verificacion-bloque-8-t_345a147d)
- [Bloque 11](docs/verification-archive.md#verificacion-bloque-11-contenido-en-espanol-hecho-por-gratis-t_5ade2d30)
- [Bloque 8 (2º ciclo)](docs/verification-archive.md#re-verificacion-bloque-8-2o-ciclo-t_59f346e3)
- [Bloque 8 (final)](docs/verification-archive.md#bloque-8-arreglo-final-t_c3483c06-fuerte)
- [Bloque 8 (re-verificación final)](docs/verification-archive.md#bloque-8-re-verificacion-final-t_59f346e3-ok)
- [Exercises Mobile](docs/verification-archive.md#verificacion-t_6cd1b3ff-ejercicios-en-movil-tactil-verificador-haiku)
- [Block 14](docs/verification-archive.md#bloque-14-verificacion-de-audio-repaso-plan-y-examen-t_b6925301-verificador-haiku-fallo)

---

## Open Issues (as of 2026-11-21)

| Issue | Location | Status |
|-------|----------|--------|
| Spanish Interface: 5 fallos (radicals English meanings, Paste "Pinyin" button, missing pinyinchart locale, cut-off text on Themes/Pinyin Chart, 404 console error) | `src/learn/radicals.js`, `src/locales/es.d/paste.json`, `src/locales/es.d/pinyinchart.json` (missing), CSS, missing resource | **Blocked** — needs implementer fix |
| Block 14: Audio, review, plan, exam verification failed | Various | **Failed** — needs re-verification after fixes |
| Grammar ES index sync (external to block 11) | `public/data/es/grammar/index.json` | **Reported** — 7 missing `file` entries |

---

## Verification Protocol

Each verification follows:
1. **Clean clone** with `OUT_DIR=/tmp/chino-<id> npm run build`
2. **Headless browser** (Chrome via CDP, 390×844, touch, ES/EN × light/dark)
3. **Automated checks**: `npm test`, `check-es-data`, `validate-dict-es`, `check-contrast`, `check-layout`, `check-strokes-dark`
4. **Manual reproduction steps** documented in each report
5. **Single repair cycle** — if verification fails again, task is blocked for human decision

---

*Index generated 2026-11-21. Full history in `docs/verification-archive.md`.*
