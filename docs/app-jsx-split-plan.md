# App.jsx Split Plan

## Goal

Split `src/App.jsx` into smaller files without changing behavior.

The first pass should be a mechanical refactor: move functions and components to
new files, wire imports/exports, then verify with `npm run build`. Feature
changes, UI copy changes, and data model changes should be avoided during this
pass.

## Current Problem

`src/App.jsx` currently contains:

- Supabase auth/session bootstrap
- data loading and mutation handlers
- portfolio calculations
- formatting and utility functions
- top-level app layout
- assets overview pages
- account, instrument, holding, and tag editor modals
- auth and shared-view screens
- modal shell/actions and inline icons

This makes small UX changes risky because unrelated concerns live in the same
large file.

## Proposed Target Structure

```text
src/
  App.jsx
  constants/
    portfolio.js
  lib/
    clipboard.js
    format.js
    portfolioMath.js
    viewerAccess.js
  components/
    CenteredMessage.jsx
    MetricSummary.jsx
    ModalActions.jsx
    ModalShell.jsx
    icons.jsx
  features/
    assets/
      AssetsPage.jsx
      Overview.jsx
      AccountsPage.jsx
      InstrumentsPage.jsx
      TagActionToolbar.jsx
    auth/
      LoginScreen.jsx
      GuestUnlockScreen.jsx
      GuestUnlockForm.jsx
    settings/
      SettingsPage.jsx
    accounts/
      AccountEditorModal.jsx
    instruments/
      InstrumentEditorModal.jsx
    holdings/
      HoldingEditorModal.jsx
    tags/
      TagEditorModal.jsx
```

## Split Boundaries

### `constants/portfolio.js`

Move static app constants:

- `allTabs`
- `assetViewOptions`
- `chartPalette`
- `tagColorOptions`
- `tagColorMap`
- `comparablePriceMetricTickers`

Keep `tabIds` local to `App.jsx` or export it only if hash parsing moves too.

### `lib/format.js`

Move display helpers:

- `formatKrw`
- `formatMoney`
- `formatUnitPrice`
- `formatPercent`
- `formatSignedPercent`
- `formatNumber`
- `formattedValueWithConversion`
- `returnToneClass`

This makes currency display changes safer.

### `lib/portfolioMath.js`

Move portfolio calculation helpers:

- `resolveTagColor`
- `latestPrices`
- `fxTickerForCurrency`
- `nativeToKrw`
- `effectiveKrwValue`
- `matchesTagFilter`
- `hasComparablePriceMetrics`
- `normalizeTickerInput`
- `today`

These are pure or near-pure functions and are good candidates for later unit
tests.

### `lib/viewerAccess.js`

Move shared-view helpers:

- `createViewerProfileDraft`
- `createGuestUnlockDraft`
- `sha256Hex`
- `isViewerSchemaMissingError`
- `formatSupabaseError`
- `formatFunctionInvokeError`

These stay separate from portfolio display and editor UI.

### `lib/clipboard.js`

Move:

- `writeClipboard`

### `components/`

Move reusable presentational components:

- `ModalShell`
- `ModalActions`
- `MetricSummary`
- `MetricInline`
- `CardSectionLabel`
- `CenteredMessage`
- `CopyIcon`
- `PencilIcon`

`MetricInline` can either live in `MetricSummary.jsx` as a private component or
be exported if reused elsewhere.

### `features/assets/`

Move the portfolio browsing surfaces:

- `AssetsPage`
- `Overview`
- `AccountsPage`
- `InstrumentsPage`
- `TagActionToolbar`

These components should continue to receive data and callbacks from `App.jsx`.
No Supabase calls should move into them in the first pass.

### `features/*EditorModal.jsx`

Move editor modals:

- `AccountEditorModal`
- `InstrumentEditorModal`
- `HoldingEditorModal`
- `TagEditorModal`

These should remain controlled components: receive `draft`, error/saving flags,
and callbacks from `App.jsx`.

### `features/auth/` and `features/settings/`

Move:

- `LoginScreen`
- `GuestUnlockScreen`
- `GuestUnlockForm`
- `SettingsPage`

These are mostly presentational and can be moved after shared components are in
place.

## Migration Order

1. Move pure constants and utility functions.
2. Move common components.
3. Move editor modals.
4. Move asset pages.
5. Move auth/settings screens.
6. Run `npm run build` after each step.

This order keeps each diff small and makes failures easy to trace.

## Guardrails

- Do not change runtime behavior during the split.
- Do not rename props unless needed to avoid import conflicts.
- Do not modify Supabase queries or mutation order.
- Keep `App.jsx` as the owner of state, effects, and mutation handlers for the
  first pass.
- Avoid copy changes except where moving code requires import/export cleanup.
- After each extraction, run `npm run build`.

## Expected Final Role of `App.jsx`

After the first pass, `App.jsx` should mainly contain:

- auth/session effects
- data loading functions
- mutation handlers
- memoized portfolio derivations
- route/tab state
- composition of screens and modals

That still leaves `App.jsx` as the container, but the file should become much
smaller and safer to edit.

## Follow-up Refactors

After the no-behavior-change split is complete, later work can consider:

- extracting Supabase data access into `lib/portfolioRepository.js`
- extracting portfolio derivations into a custom hook such as `usePortfolioView`
- adding tests for `portfolioMath.js` and `format.js`
- replacing remaining mojibake text with clean Korean copy in a separate pass

