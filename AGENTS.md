# Session Entry and Product Context

- At the start of development or after context loss, read `docs/START-HERE.md`, then the PRD, accepted ADR, and relevant ticket it points to before implementation.
- Treat unresolved contracts as work to complete in their owning tickets, not permission to invent behavior. Record decisions, validation results, and next steps in persistent project documents before handing off.
- Historical prototypes and `tickets/20260718-*.md` are background, not the current implementation specification. Preserve unrelated dirty work and verify Git/GitHub state rather than trusting old session status.

# Engineering Guidance

- Apply `docs/engineering/SIMPLICITY.md` and ADR-0008 first when older guidance conflicts. Reduce user concepts, tables, state machines, history, and APIs together. Require a concrete current scenario for extra storage. Preserve data and access boundaries while retiring obsolete structures; existing implementation alone is not a reason to keep a feature.

- Apply `docs/adr/0004-domain-storage-and-minimal-mutation-contract.md`: keep domain storage and purpose-specific APIs, share mutation rules rather than a universal payload model/command engine, and add conflict versions or history only for their actual purpose. Preserve security, idempotent financial writes, atomicity, and reconciliation guarantees.

- Follow the minimal-foundation plus vertical-slice workflow in `docs/engineering/development.md`. Build only the shared pieces required by a named user scenario, then connect its DB, API/MCP, necessary UI, and tests. Do not finish all layers or build a generic framework before delivering the first slice. Record the consuming slice and exit criteria for foundation tasks; do not report a slice complete based only on isolated layer tests or mock UI.

Before code changes, read `docs/engineering/architecture.md` for placement and responsibilities and `docs/engineering/development.md` for environment/test/deployment safety. `npm run test:db` targets the ordinary local Supabase instance; `npm run test:e2e` owns and resets only the isolated `.e2e` instance. Neither command targets the linked remote database. Keep development-agent instructions separate from product MCP-agent instructions in `docs/design/contracts/agent/`.

# Text Encoding

- Treat every repository text file as UTF-8 without a BOM and use LF line endings.
- Use `apply_patch` for file edits. Do not write text files through PowerShell redirection, `Out-File`, or `Set-Content` unless their encoding is explicitly UTF-8 without a BOM.
- Run `npm run check:encoding` after edits that add or change text.
- Do not normalize or rewrite unrelated files solely to change their encoding.

# Database Context

- Start database work with `supabase/schema/OVERVIEW.md`. It is the compact schema index for agents.
- Do not read all files in `supabase/migrations/` unless the task requires migration history, exact SQL, an RPC body, RLS policy details, or schema verification.
- Treat `supabase/migrations/` as the applied deployment history; preserve it. For exact current DDL, inspect only the relevant migration files or obtain a targeted database dump.
- When a database change affects the facts in `supabase/schema/OVERVIEW.md`, update that index.

# UI Design

- Before introducing shared UI or backend helpers, read `docs/design/component-system.md` or `docs/engineering/backend-modules.md` respectively. Reuse existing components, keep transactional rules in the server, and do not introduce a generic framework ahead of concrete feature needs.

- Before changing UI code, screen specifications, or prototypes, read `docs/design/PRINCIPLES.md` and follow its mobile-first rules and acceptance checklist.
- For product or navigation changes, also read `docs/design/product-reorganization.md`. Preserve useful workflows and data, not every existing screen; use its explicit keep/restructure/new/relocate decisions.
- Keep category allocation, multi-account holdings, and desktop editing available. Simplify presentation, not capability.
- Treat the principles document as the design source of truth. Prototypes illustrate it; they do not silently replace it. Record intentional exceptions in the related ticket or ADR.
- For UI tickets and PRs, report the viewport sizes, states, and interactions verified against the checklist, and disclose anything not tested.
