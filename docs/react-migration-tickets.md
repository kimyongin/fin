# React Migration Tickets

This document is the local handoff map for the Vite + React + Tailwind migration.
GitHub Issues are the source of truth; this file exists so a future agent can recover
context quickly after a context-window reset.

## Branch

- `codex/vite-react-migration`

## Current migration commits

- `bd5b478 feat: add Vite React app foundation`
- `1131ca4 feat: add React portfolio read views`

## Tickets

- #25: Migrate app to Vite React Tailwind build pipeline
- #26: Port Supabase auth flow to React
- #27: Rebuild Assets overview in React
- #28: Port account management to React
- #29: Port instrument and holding management to React
- #30: Port settings and import workflows to React
- #31: Cut over React build to GitHub Pages

## Working Rules

- Keep `master` stable until #31.
- Use GitHub Pages with CSR only.
- Deploy built `dist/` output, not source files.
- Keep Supabase as the backend.
- Do not stage `.claude/settings.local.json`; it is an unrelated local change.
- Prefer small commits that close or advance one ticket at a time.

## Verification Baseline

- `npm run build`
- `git diff --check`
- Local dev URL: `http://localhost:5173/fin/`
- Production URL after cutover: `https://kimyongin.github.io/fin/`
