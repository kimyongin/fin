# Local Supabase bootstrap

The earliest remote migration files are historical placeholders. The
`202605150000_local_reset_compatibility_base.sql` migration supplies the
legacy portfolio tables required by the first substantive migration.

For ordinary local startup:

```bash
supabase start
```

Do not remove or reorder that compatibility migration. It is idempotent and
is also recorded in the remote migration history, so a new checkout can replay
the complete migration sequence without relying on a pre-existing database.

`supabase db reset` rebuilds the local database and deletes its current data.
Use it only for an explicitly disposable environment or after confirming data
preservation and reset intent; it is not required for every development session.
Migration replay does not prove parity with the linked remote schema. See
[the schema audit](../docs/design/schema-audit-20260921.md).

`npm run test:db` currently uses `--linked` and targets the remote project.
For environment boundaries and verification requirements, read
[development](../docs/engineering/development.md). The isolated E2E runner resets
only its dedicated `.e2e` project; see [E2E documentation](../e2e/README.md).
