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
