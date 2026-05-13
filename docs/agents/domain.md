# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT-MAP.md`** at the repo root — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** at the repo root for system-wide architectural decisions.
- Per-context `docs/adr/` inside each subsystem folder for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## File structure

Multi-context repo (`CONTEXT-MAP.md` at root):

```
/
├── CONTEXT-MAP.md
├── docs/adr/                        ← system-wide decisions
├── portfolio-app/
│   ├── CONTEXT.md
│   └── docs/adr/                    ← Portfolio App decisions
├── market-analysis-skill/
│   ├── CONTEXT.md
│   └── docs/adr/                    ← Market Analysis Skill decisions
└── rebalancing-skill/
    ├── CONTEXT.md
    └── docs/adr/                    ← Rebalancing Skill decisions
```

`CONTEXT.md` files and `docs/adr/` directories are created lazily by `/grill-with-docs` as terms and decisions are resolved. Don't create them proactively.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/grill-with-docs`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 — but worth reopening because…_
