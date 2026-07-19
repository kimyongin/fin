# Local Supabase bootstrap

The earliest remote migration files are historical placeholders. The
`202605150000_local_reset_compatibility_base.sql` migration supplies the
legacy portfolio tables required by the first substantive migration.

This keeps the normal local workflow reproducible:

```bash
supabase start
supabase db reset
```

Do not remove or reorder that compatibility migration. It is idempotent and
is also recorded in the remote migration history, so a new checkout can replay
the complete migration sequence without relying on a pre-existing database.
