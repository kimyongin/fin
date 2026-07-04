# 14. Shared Viewer Access

## Goal

Allow a user to share a read-only view of their portfolio with another logged-in user by giving them:

- a public search name
- a viewer password

The viewer can inspect the owner's assets, accounts, and instruments, but must not be able to create, edit, or delete the owner's data.

## User Story

As a portfolio owner, I want to set a public name and a viewer password so that someone I trust can find me and inspect my portfolio without receiving edit permissions.

As a viewer, I want to enter an owner's public name and viewer password, then browse that owner's portfolio in read-only mode.

## Non-Goals

- No friend request workflow for the first version.
- No write permissions for viewers.
- No public unauthenticated access.
- No social feed, comments, or sharing links yet.
- No portfolio comparison feature yet.

## Current Context

- The app already requires Supabase auth.
- Existing portfolio data appears to be scoped by `user_id`.
- Current screens assume "current session user" as the owner.
- React/Vite app reads:
  - `accounts`
  - `holdings`
  - `portfolio_view`
  - `instruments`
  - `tags`
  - `instrument_tags`
  - `holding_prices_daily`
- Existing `insert/update/delete` flows must remain owner-only.

## Proposed Product Flow

### Owner Setup

Add a section in Settings:

- `공개 이름`
- `보기 비밀번호`
- `공유 켜기/끄기`
- Save button

Rules:

- Public name is unique.
- Public name should be case-insensitive.
- Viewer password is required when sharing is enabled.
- Viewer password is never shown after save.
- Changing the password invalidates old viewer sessions.

### Viewer Access

Add a new menu item:

- `공유 보기` or `친구 보기`

Flow:

1. Viewer enters public name.
2. Viewer enters viewer password.
3. If valid, app stores a viewer session in DB.
4. Viewer can browse the owner's `자산`, `계좌`, `종목` screens in read-only mode.

Read-only behavior:

- Hide `추가`, `편집`, `삭제`, and save actions.
- Keep filters and copy actions if they do not mutate owner data.
- Header should clearly show whose portfolio is being viewed.

## Database Design

### New Table: `public.profiles`

Stores public sharing metadata for each user.

Columns:

- `user_id uuid primary key references auth.users(id) on delete cascade`
- `public_name text unique`
- `public_name_normalized text unique`
- `viewer_password_hash text`
- `viewer_password_updated_at timestamptz`
- `sharing_enabled boolean not null default false`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Notes:

- Do not store viewer password in plaintext.
- Normalize public name using lower/trim.
- Consider allowed pattern: Korean, English letters, digits, dash, underscore.

### New Table: `public.viewer_sessions`

Records that one logged-in user has unlocked read-only access to another user's portfolio.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `viewer_user_id uuid not null references auth.users(id) on delete cascade`
- `owner_user_id uuid not null references auth.users(id) on delete cascade`
- `password_version timestamptz not null`
- `expires_at timestamptz not null`
- `created_at timestamptz not null default now()`

Constraints:

- `viewer_user_id <> owner_user_id`
- Unique active session is optional. Simpler v1 can allow multiple sessions.

Invalidation:

- When owner changes viewer password, `viewer_password_updated_at` changes.
- RLS checks `viewer_sessions.password_version = profiles.viewer_password_updated_at`.
- Old sessions automatically stop granting access.

## Password Verification

Do not compare password hashes in the browser.

Preferred implementation:

- Enable/use PostgreSQL `pgcrypto`.
- Store password hash via `crypt(password, gen_salt('bf'))`.
- Verify with `viewer_password_hash = crypt(input_password, viewer_password_hash)`.

RPC functions:

### `public.set_viewer_profile(public_name text, viewer_password text, sharing_enabled boolean)`

Security:

- `security definer`
- Only writes profile for `auth.uid()`.

Behavior:

- Validates public name.
- Normalizes public name.
- Hashes viewer password if provided.
- Updates `viewer_password_updated_at` when password changes.
- Sets sharing flag.

### `public.unlock_viewer_access(public_name text, viewer_password text)`

Security:

- `security definer`
- Requires `auth.uid()` not null.

Behavior:

- Finds enabled profile by normalized public name.
- Verifies password server-side.
- Inserts `viewer_sessions` row.
- Returns owner display/public info and session expiry.

### `public.revoke_viewer_sessions()`

Optional v1.5:

- Owner can invalidate all current viewer sessions by rotating password timestamp.

## RLS Strategy

Existing owner policies should stay owner-only for all writes.

Read access should become:

- owner can select own rows
- viewer can select rows owned by a user for whom a valid viewer session exists

Use a helper function to avoid duplicating policy logic.

### Helper Function

`public.can_view_owner(owner_id uuid) returns boolean`

Returns true if:

- `owner_id = auth.uid()`
- or exists a `viewer_sessions` row where:
  - `viewer_user_id = auth.uid()`
  - `owner_user_id = owner_id`
  - `expires_at > now()`
  - matching profile is still enabled
  - `viewer_sessions.password_version = profiles.viewer_password_updated_at`

### Existing Tables Needing Read Policy Updates

- `accounts`
- `holdings`
- `instruments`
- `tags`
- `instrument_tags`
- `holding_prices_daily`

`portfolio_view` must also work for shared owners.

Options:

1. Update underlying table RLS and keep using `portfolio_view`.
2. Create read-only RPCs for owner/viewer portfolio data.

Recommended v1:

- Prefer explicit read-only RPCs if current RLS/view behavior is hard to safely adjust.
- Otherwise update table `select` policies using `can_view_owner(user_id)`.

## Frontend Plan

### Shared App State

Introduce a viewing context:

- `viewMode: 'owner' | 'shared'`
- `viewOwnerId`
- `viewOwnerName`
- `canEdit = viewMode === 'owner'`

Current data fetch should accept an owner filter when in shared mode.

### Settings

Add section:

- Public name input
- Viewer password input
- Sharing enabled toggle
- Save button

Also show:

- current public name
- whether sharing is enabled
- warning that password grants read-only access

### Shared View Screen

Add menu item:

- `공유 보기`

States:

- Public name/password form
- Loading
- Invalid password/error
- Active shared portfolio

### Read-Only UI

When `canEdit` is false:

- Hide account/instrument/holding/tag create buttons.
- Hide edit buttons.
- Disable settings edit sections for the shared owner.
- Keep navigation and tag filters.

## Migration Tickets

### 14-A. Profile and Viewer Session Schema

- Add `profiles`.
- Add `viewer_sessions`.
- Add indexes and constraints.
- Add updated timestamp trigger if local pattern exists.

Acceptance:

- Migration applies cleanly.
- Existing owner data remains unchanged.

### 14-B. Password RPCs

- Add `set_viewer_profile`.
- Add `unlock_viewer_access`.
- Hash password server-side.

Acceptance:

- Password is not stored plaintext.
- Wrong password does not create a session.
- Correct password creates a viewer session.

### 14-C. Read-Only Access RLS

- Add `can_view_owner(owner_id)`.
- Update select policies or create read-only data RPCs.
- Keep write policies owner-only.

Acceptance:

- Viewer can select shared owner rows after unlock.
- Viewer cannot insert/update/delete shared owner rows.
- Viewer cannot read without valid session.

### 14-D. Settings UI

- Add public name and viewer password form.
- Save via RPC.
- Show sharing state.

Acceptance:

- Owner can set or update public name/password.
- Duplicate public name shows a clear error.

### 14-E. Shared View UI

- Add menu item and unlock form.
- Load selected owner's read-only data.
- Show owner label in header.

Acceptance:

- Valid public name/password enters shared view.
- Invalid credentials show a clear error.

### 14-F. Read-Only Guards

- Add `canEdit` checks to all create/edit/delete UI.
- Confirm write handlers cannot run in shared mode.

Acceptance:

- No edit/add/delete controls appear in shared mode.
- Direct handler calls are guarded.

## Verification Plan

Use at least two Supabase users:

- Owner user
- Viewer user

Test cases:

- Owner sets public name/password.
- Viewer cannot unlock with wrong password.
- Viewer can unlock with correct password.
- Viewer sees owner's assets/accounts/instruments.
- Viewer cannot edit owner data.
- Owner can still edit own data.
- Password rotation invalidates old viewer access.
- Sharing disabled blocks new and existing viewer sessions.

Frontend checks:

- `npm run build`
- Local owner mode still works.
- Shared mode works on mobile and desktop.
- No console errors.

## Open Questions

- Should viewer sessions expire after 24 hours, 7 days, or never until password rotation?
- Should sharing expose all accounts or allow hiding specific accounts later?
- Should shared view include exact money amounts, or should there be an optional percentage-only mode?
- Should public name be editable after other people know it?
- Should owner be able to see active viewers/session history?
