# Cycle data workflow — 1.2.0 candidate validation

Base commit: `20f1e7f`. Scope: Portfolio skill, monthly-series calculator, package, and calculator tests. No app, UI, database, Edge, access-scope, or default-prompt changes.

- Official source, fallback, direct calculation, bounded failure handling, and conditional assessments are documented in `cycle-data.md`.
- `python scripts/test-cycle-series.py`: 5 tests passed, including future-month exclusion, missing/duplicate/stale/short input rejection, finite positive prices, threshold boundaries, ties, direction guard, flat series, and metric mode.
- `npm test`: 30 files, 138 tests passed.
- `npm run check:encoding`: 682 files passed before adding this record. `git diff --check` and Skill Creator validation passed.
- Live public Shiller monthly data: completed August 2026 compared against 180 prior observations. Price displacement 32.7043%, percentile 91.1111, exploratory speed score 75. CAPE 41.1198 exceeded that comparison period; estimated CPI inputs were disclosed. Partial September data was excluded.
- AAII public survey and recent history were read. Qualitative sentiment classification used current data and published historical comparison, without claiming a computed full-history percentile.
- A separate hypothetical new ETF scenario retained missing scores while identifying a verified target-weight gap. No financial records were written.
- Package: `artifacts/portfolio-unified-1.2.0.zip`, SHA-256 `b377045cbc1636151a982bd41b41f7bb6547a8550f47773727b4ed85b0669b6c`. All 12 files matched source and ZIP integrity passed.
- Local source testing does not establish installed-plugin delivery. Browser upload, independent web conversation, and mobile verification remain separate release checks.
- Existing historical documents containing private conversation links are excluded from this publication. This record contains no private conversation URLs or portfolio amounts.
