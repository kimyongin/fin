# Session Entry and Product Context

- Follow the task-level guidance in `docs/engineering/development.md`: use 심층형 (deep reasoning), 균형형 (balanced), and 경량형 (lightweight) to describe the recommended capability for the work. Do not assign specific model names to these levels; the user chooses the model. Recommend a level based on ambiguity, impact, and verification needs, not the filename alone.
- When model selection needs clarification, state the concrete next task, recommended capability level and reason, and what the user should select. Never ask only which model is selected or require the user to report its name. A statement such as “selected” or “continue with this model” is sufficient; respect that choice until a switch or a material change in task demands is indicated. Do not infer or claim to have changed the selected model. If clarification is needed before substantive work, finish useful read-only inspection and prepare the handoff first.
- Committing or pushing already-finalized changes does not itself start a new design or implementation phase. Do not require a model switch solely for those actions. If proceeding requires new design decisions or substantive implementation fixes, apply the phase policy to that specific work; ordinary Git operations still require the applicable validation and authorization.
- Design/ticket requests end with reviewable documents and implementation handoff, not application code changes. A generic "continue" during design does not authorize implementation. Start coding only after an explicit implementation request. Recommend the capability level needed for that work and leave model selection to the user; do not automatically delegate or switch models to bypass the user's choice.

- At the start of development or after context loss, read `docs/START-HERE.md`, then the PRD, accepted ADR, and relevant ticket it points to before implementation.
- Treat unresolved contracts as work to complete in their owning tickets, not permission to invent behavior. Record decisions, validation results, and next steps in persistent project documents before handing off.
- Historical prototypes and `tickets/20260718-*.md` are background, not the current implementation specification. Preserve unrelated dirty work and verify Git/GitHub state rather than trusting old session status.

# Engineering Guidance

- Apply `docs/engineering/SIMPLICITY.md` and ADR-0008 first when older guidance conflicts. Reduce user concepts, tables, state machines, history, and APIs together. Require a concrete current scenario for extra storage. Preserve data and access boundaries while retiring obsolete structures; existing implementation alone is not a reason to keep a feature.

- Apply `docs/adr/0004-domain-storage-and-minimal-mutation-contract.md`: keep domain storage and purpose-specific APIs, share mutation rules rather than a universal payload model/command engine, and add conflict versions or history only for their actual purpose. Preserve security, idempotent financial writes, atomicity, and reconciliation guarantees.

- Follow the minimal-foundation plus vertical-slice workflow in `docs/engineering/development.md`. Build only the shared pieces required by a named user scenario, then connect its DB, API/MCP, necessary UI, and tests. Do not finish all layers or build a generic framework before delivering the first slice. Record the consuming slice and exit criteria for foundation tasks; do not report a slice complete based only on isolated layer tests or mock UI.

Before code changes, read `docs/engineering/architecture.md` for placement and responsibilities and `docs/engineering/development.md` for environment/test/deployment safety. `npm run test:db` targets the ordinary local Supabase instance; `npm run test:e2e` owns and resets only the isolated `.e2e` instance. Neither command targets the linked remote database. Keep development-agent instructions separate from product MCP-agent instructions in `docs/design/contracts/agent/`.

Support both Work Cloud and Local development. At session entry or an environment change, verify the checkout/base commit, available runtimes, Docker daemon, browser, network, and connected tools needed for the task. Treat plugin access and shell/CLI credentials as separate capabilities; do not assume a cloud session inherits local files or authentication. Use the environment and verification rules in `docs/engineering/development.md`.

Before publishing changes, run the relevant checks available in the current environment. When environment constraints prevent required checks, record the reason and use a non-deploying work branch/PR to run them in CI or hand off the exact commit to a capable isolated environment. CI may be the first execution of checks unavailable in the authoring environment; inspect its results and fix failures before merge or deployment. UI changes require affected browser E2E, and cross-screen or release-wide changes require the full E2E suite, regardless of where they run. Verify the tested revision and rerun affected checks after changes. If the current `.e2e` instance contains data or untracked files to preserve, use a clean isolated checkout instead of resetting it. Never substitute the connected production database for isolated tests. Record commands, results, CI links/revisions, and remaining manual or real-client checks; implementation, verification, and deployment completion are separate claims.

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

- Before changing page-top cards, toolbars, summaries, or filters, read `docs/design/page-panel-guidelines.md`. Keep related controls in one top panel, preserve feature-specific filter scope, and record responsive and filter-to-detail verification in the ticket.

- Before changing UI text presentation, read `docs/design/typography-guidelines.md`. Use its semantic text roles and shared styles for size, weight, line height, and numeric alignment. Verify actual computed styles and responsive readability; do not add page-specific font sizes or inherit button typography into nested content. Track full-screen coverage and intentional exceptions in the implementation ticket.

- Before adding or modifying tag display, selection, filters, or management, read `docs/design/tag-guidelines.md`. Reuse the shared chip presentation, preserve single/multiple selection semantics, and record coverage or intentional exceptions in the ticket.

- Before adding or modifying any modal, read `docs/design/modal-guidelines.md`. Follow its shared form, spacing, actions, responsive layout, and accessibility rules; record intentional exceptions and actual verification in the relevant ticket.

- Before introducing shared UI or backend helpers, read `docs/design/component-system.md` or `docs/engineering/backend-modules.md` respectively. Reuse existing components, keep transactional rules in the server, and do not introduce a generic framework ahead of concrete feature needs.

- Before changing UI code, screen specifications, or prototypes, read `docs/design/PRINCIPLES.md` and follow its mobile-first rules and acceptance checklist.
- For product or navigation changes, also read `docs/design/product-reorganization.md`. Preserve useful workflows and data, not every existing screen; use its explicit keep/restructure/new/relocate decisions.
- Keep category allocation, multi-account holdings, and desktop editing available. Simplify presentation, not capability.
- Treat the principles document as the design source of truth. Prototypes illustrate it; they do not silently replace it. Record intentional exceptions in the related ticket or ADR.
- For UI tickets and PRs, report the viewport sizes, states, and interactions verified against the checklist, and disclose anything not tested.
