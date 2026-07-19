# E2E Test Coverage

These tests run against a dedicated local Supabase instance and seeded virtual users. They do not require Google accounts or production data.

Run the suite with:

```bash
npm run test:e2e
```

The suite starts and resets `.e2e/supabase`; it never uses the regular local
development database or remote Supabase project. GitHub Actions runs this same
command for every pull request and push to `master`.

## Baseline maintenance

`.e2e/supabase/migrations/202607190000_e2e_baseline.sql` is the dedicated E2E
schema baseline. When an application migration changes the public schema, apply
the migration to the E2E project too (or regenerate the baseline deliberately),
then run `npm run test:e2e`. Do not copy production data into the E2E seed.

## Test users

| User | Purpose |
| --- | --- |
| `e2e-owner@example.com` | Portfolio owner |
| `e2e-friend@example.com` | Authorized friend |
| `e2e-outsider@example.com` | User with no access |
| Anonymous user | Password-protected shared viewer |

## Coverage

| Area | Scenario | Status |
| --- | --- | --- |
| Authentication | Virtual owner session is injected into the browser and loads its portfolio. | Complete |
| Authentication | Google OAuth redirect initiation. | Complete (authorization redirect mocked; no Google account used) |
| Sharing | Anonymous viewer unlocks a portfolio with a valid public name and password. | Complete |
| Sharing | Invalid public name or password is rejected. | Complete |
| Friends | A friend adds an owner's shared portfolio and reads it. | Complete |
| Friends | An unauthorized user cannot read an owner's portfolio. | Complete |
| Friends | Removing a friend immediately revokes access. | Complete |
| Accounts | Create an account. | Complete |
| Accounts | Edit an account. | Complete |
| Accounts | Delete an empty account. | Complete |
| Accounts | Block deletion of an account containing holdings. | Complete |
| Tags | Create a tag. | Complete |
| Tags | Edit a tag. | Complete |
| Tags | Delete a tag and unlink associated instruments. | Complete |
| Instruments | Create a market instrument and associate a tag. | Complete |
| Instruments | Edit an instrument. | Complete |
| Instruments | Delete an unheld instrument. | Complete |
| Instruments | Block deletion of an instrument with holdings. | Complete |
| Holdings | Create a market holding. | Complete |
| Holdings | Edit and delete a holding. | Complete |
| Holdings | Create valuation and cash holdings. | Complete |
| Holdings | Ticker lookup Edge Function success and failure. | Complete (browser-mocked Edge Function) |
| Portfolio views | Strategy, activity, and settings pages render through browser menu navigation. | Complete |
| Portfolio views | Tag, account, instrument, and spreadsheet views render the saved data. | Complete |
| Portfolio views | Spreadsheet bulk save persists all submitted rows atomically. | Complete (RPC integration) |
| Portfolio views | CSV copy exports the visible portfolio. | Complete |
| Activity | Account, tag, instrument, and holding creation writes activity events. | Complete |
| Activity | Updates and deletions write the expected activity events. | Complete |
| Strategy | Create and read a tag-based strategy. | Complete |
| Strategy | Display contribution allocation and rebalancing suggestions. | Complete |
| Agent access | Create and revoke an agent token. | Complete |
| Agent access | A revoked token is denied access. | Complete |
| Price sync | Price sync Edge Function success and failure responses are handled. | Complete (browser-mocked Edge Function) |

## Current automated tests

The executable scenarios are in [app.spec.js](./app.spec.js):

1. Owner portfolio loading with a virtual Supabase session.
2. Google OAuth authorization redirect initiation without a Google account.
3. Account, tag, instrument, and holding creation with activity recording.
4. Account, tag, instrument, and holding lifecycle plus dependency checks.
5. Tag unlinking, friend access, denial, and access revocation.
6. Strategy save/read/display, agent-token create/revoke/denial.
7. Valuation/cash holdings, spreadsheet bulk save, and asset-view rendering.
8. Mocked ticker lookup and price-sync Edge Function success/failure paths.
9. CSV clipboard export.
10. Password-protected anonymous shared view, including invalid-password rejection.
