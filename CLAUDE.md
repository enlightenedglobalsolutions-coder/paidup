# PaidUp — living state doc

> **Update this file in the same commit as any change it describes.** A stale
> copy of this doc is worse than no doc — it reads as confident and is wrong.
> If you touch storage, structure, the platform layer, or tests below and
> don't update this file, the commit isn't finished.

This file is committed to this app's own public repo. It carries no
machine-specific paths — the platform root's `CLAUDE.md` and
`EGS-STANDARDS.md` (Tier 1 rules, the every-app checklist) live in the
private `egs-platform` repo, not in this tree. Read those before building
here; this file stays specific to PaidUp.

## What this app is

PaidUp is a private, on-device bill tracker: add each recurring bill once,
and it lays out every month — what's paid, what's not, what's coming —
across five cadences (weekly, biweekly, monthly, quarterly, annual). No
accounts, no sign-up, no analytics.

- Live: `https://enlightenedglobalsolutions-coder.github.io/paidup/`
  (no `CNAME` — default GitHub Pages subpath)

## Storage

- Single store, `localStorage['paidup.data']` (`K_DATA`). Backup copy at
  `localStorage['paidup.data__bak']` (`K_BAK`), written before every save
  (Tier 1). Two more app-prefixed keys: `paidup.installPromptDismissed`
  (`K_INSTALL_DISMISS`) and `paidup.backupNudgeSnoozeUntil`
  (`K_BACKUP_SNOOZE`).
- `SCHEMA_CURRENT = 2`. `migrate(obj)` branches on `obj.schema` and is
  applied on every load:
  - missing schema → treated as legacy shape, stamped `schema:1`.
  - `1 → 2`: adds the payment-source axis — each bill gets `source:'bank'`
    if it doesn't already have one (commit `0bdfa3b`). Also defensively
    backfills `settings`/`categories`/`bills`/`payments` if absent.
  - `2`: current — same defensive backfill, no-op otherwise.
  - anything higher than `SCHEMA_CURRENT` throws ("saved by a newer
    version") rather than silently mangling data.
- `safeLoad()`: try `K_DATA` → try `K_BAK` → fall back to `emptyDb()`.
- `safeSave(opts)`: backs up current `K_DATA` to `K_BAK`, then writes.
  Refuses to overwrite a store that `hasRealData()` with an empty one unless
  `opts.allowShrinkToEmpty` is passed — the ONLY caller of that escape hatch
  is restore-from-backup (`doImport`). Don't reuse it elsewhere without
  re-reading why it's gated.
- Export: downloads `{app:'paidup', schema:SCHEMA_CURRENT, exportedAt, data:db}`
  as `paidup-backup-<date>.json`. Import validates `obj.app==='paidup'`,
  runs the incoming data through `migrate()`, and requires a `confirm()`
  before replacing the on-device store (Tier 1: delete/replace confirms).

## Structure

- Single file, `index.html`, ~1140 lines. No build step, no framework.
- Screens, switched via the `screen` var inside `render()`: `home`, `bills`,
  `detail` (one bill), `history` (portfolio Spend History — added
  `e5012b2`), `settings`, `support`, `privacy`.
- Data model: `db.categories[]`, `db.bills[]`, `db.payments[]`. Payments are
  NOT hand-entered up front — `ensureCurrentPeriodPayments()` generates the
  current month's payment records from each active bill's cadence, and it
  runs on **every** `render()` call, not just on load. That makes `render()`
  side-effecting: opening the app (or just navigating) can trigger a
  `localStorage` write when a new period comes due.
- Event handling: pure delegation on `document`'s `click`/`change`, keyed on
  `data-action` — zero inline `onclick` (test-enforced, see Tests).
- Pure/tested block, lines 262–325, marked `EGS PURE CADENCE LOGIC`:
  `occurrencesInMonth()`, `statusFor()`, `periodDisplay()`, and date helpers,
  covering all five cadences. **The in-code comment claims this is
  "behavior-tested (test_paidup.js) against real dates for all five
  cadences" — verified 2026-09-12 that this is false.** `test_paidup.js` has
  zero references to `occurrencesInMonth` or the word "cadence." Only
  `migrate()` gets the extract-and-eval-against-fixtures treatment (see
  Tests). Don't trust the comment; see Gotchas.
- Spend History (`e5012b2`, `historyByMonth()`): rolls up every **paid**
  payment across every bill (archived included, deleted excluded — a
  deleted bill's payments are removed at delete time) by the month its
  `dueDate` falls in, newest first.
- Backfill (`93a0fa4`, newest commit as of this doc): a bill's detail screen
  can add a missing past-period payment, deduped against existing periods
  for that bill.

## Platform layer

- `service-worker.js` / `sw_logic.js` are a **documented, sanctioned fork**
  of `platform/service-worker.js` / `platform/sw_logic.js`, not a straight
  copy — confirmed by diff and by commit `29ee192` ("document sw_logic.js as
  a sanctioned platform-skeleton variant"). Re-diff against `platform/` if
  you're relying on this list — it may drift.
- Divergences from the skeleton:
  - `function(){}` throughout instead of arrow functions.
  - Network-first-with-timeout is `EGS_SW_LOGIC.raceAbort()` — a real
    `AbortController` cancel of the losing fetch, tested in
    `test_sw_logic.js` — rather than the skeleton's `EGS_SW.raceTimeout()`.
  - Stale-cache cleanup via `isOwnOldCache(k, APP_NAME, CACHE)` rather than
    the skeleton's `staleCaches(keys, APP_NAME, CACHE_VERSION)`.
  - The version constant is `VERSION` here (skeleton calls it
    `CACHE_VERSION`).
- Version stamping: `egs-deploy.sh` stamps `window.EGS_VERSION` in
  `index.html` as `'DATE (shortsha)'` and `VERSION` in `service-worker.js`
  as a bare date. `test_paidup.js` only compares the **date portion** of the
  two — a stamp mismatch beyond the date wouldn't fail the suite.
- `manifest.webmanifest`: standard EGS shape — relative `id`/`start_url`/
  `scope`, `display:'standalone'`, 192/512/maskable icons — all
  test-enforced.

## Tests

Run from `apps/paidup/`:
```
node test_paidup.js     # 72/72 passing as of 2026-09-12
node test_sw_logic.js   # 26/26 passing as of 2026-09-12
```
- `test_paidup.js` (no deps, reads `index.html`/`service-worker.js`/
  `manifest.webmanifest` off disk):
  - **Referential integrity** — every `href`/`src` in `index.html` and every
    entry in the service worker's `CORE` precache list actually resolves on
    disk. This exists because of a real incident (`v2026.08.05-0001`
    shipped with `sw_logic.js` on disk as `sw_logic-2.js` and no manifest —
    nothing failed loudly, the install prompt just silently never fired).
  - Manifest install-criteria checks (id, name, display, relative
    start_url/scope, required icon sizes).
  - `migrate()` is extracted from `index.html` by regex and actually
    **eval'd and run** against v1 and v2 fixture stores — this is real
    behavioral testing, not a string match.
  - Install-banner and backup-nudge logic (`installBannerWanted`,
    `backupNudgeWanted`, `renderBanners`) are extracted the same way but
    only **pattern-matched** against their source — not run.
  - Version-stamp cross-check (date portion only — see Platform layer).
  - Standing rules: zero inline `onclick`, no secrets committed, every
    `.splice(` call is `confirm()`-guarded (Tier 1 delete-confirmation,
    enforced structurally across the whole file).
- `test_sw_logic.js`: 26 tests over the extracted `sw_logic.js` pure
  functions (`cacheName`, `isOwnOldCache`, `raceAbort`, `shouldHandle`,
  `isNavigationRequest`, `NETWORK_TIMEOUT_MS`).
- **Not covered by anything:**
  - The cadence/date-math block (`occurrencesInMonth`, `statusFor`,
    `periodDisplay`) — see Structure and Gotchas.
  - `historyByMonth()` / `renderHistory()` (Spend History).
  - The backfill flow (`backfillModal`, `save-backfill` action).

## Gotchas

- The `EGS PURE CADENCE LOGIC` header comment (index.html:262) overclaims
  test coverage for the cadence math — see Structure/Tests. If you change
  `occurrencesInMonth()` or the other date helpers, there is currently
  **no regression test** that would catch a mistake; verify by hand against
  real dates for all five cadences before shipping, and consider adding the
  eval-and-run test the comment already claims exists.
- `render()` has a side effect (`ensureCurrentPeriodPayments()` can write to
  `localStorage`) — it's not a pure view function, so don't assume calling
  it repeatedly is free.
- `EGS_APPS` (the "More EGS apps" list in Support) is hand-maintained here,
  seeded from `EGS-STANDARDS.md` §3a per its own comment ("sync at deploy,
  don't hand-drift") — nothing actually enforces that sync. Check it's
  current when the portfolio changes.
- `PAYMENT_CONFIG` has several empty placeholder fields (`btc`,
  `stripeUrl`, `paypalUrl`, `wiseUrl`) — only Interac is live; the others
  render a "coming soon" state by design, not a bug.
