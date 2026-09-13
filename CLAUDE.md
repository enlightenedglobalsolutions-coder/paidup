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
  covering all five cadences. The in-code comment claims this is
  "behavior-tested (test_paidup.js) against real dates for all five
  cadences" — false as of 2026-09-12, true again as of the same day: the
  whole block now gets the same extract-and-eval treatment `migrate()` gets
  (see Tests), so the comment no longer needed correcting.
- Spend History (`e5012b2`, `historyByMonth()`): rolls up every **paid**
  payment across every bill (archived included, deleted excluded — a
  deleted bill's payments are removed at delete time) by the month its
  `dueDate` falls in, newest first.
- Backfill (`93a0fa4`): a bill's detail screen can add a missing past-period
  payment, deduped against existing periods for that bill. The validation
  and record-construction (`buildBackfillPayment(bill,y,m,period,amountRaw)`)
  was split out of the `save-backfill` click handler so it's callable
  without a DOM — same reason `migrate()`/`raceAbort()` were extracted — the
  handler itself is now just DOM reads + this call + `alert`/`closeModal`/
  `render`. See Tests.
- Editing a payment's paid date (thread 2026-09-13, real case: a payment got
  marked paid with the wrong date and there was no way to fix it): the
  "Paid <date>" text on a paid payment row (Home and bill detail) is now a
  button, `data-action="edit-paid-date"`, opening `paidDateModal()` — a
  `<input type="date">` capped at `max="`+todayStr()+`"`. Same
  extract-for-testability split as backfill: `buildPaidDateEdit(payment,
  newDateRaw,today)` does the validation and returns `{paidAt}` or
  `{error}`; the `save-paiddate` handler just applies `pd.paidAt=
  pdResult.paidAt`. **Settled in-session: only `paidAt` is editable, never
  `dueDate`.** `dueDate` is cadence-generated and is what `historyByMonth`
  groups by, so this means correcting a paid date can never move a payment
  into a different Spend History month — proven by test (checking the month
  bucket before/after, and that a successful edit's return object never
  carries a `dueDate` key), not just asserted. If `dueDate` ever becomes
  editable too, revisit this — it would need the month-shift question
  answered for real, and the "can't move months" test would need rewriting,
  not just relaxing.

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
node test_paidup.js     # 138/138 passing as of 2026-09-13
node test_sw_logic.js   # 26/26 passing as of 2026-09-13
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
  - The whole `EGS PURE CADENCE LOGIC` block (`occurrencesInMonth()`,
    `statusFor()`, `periodDisplay()`, and the date helpers) gets the same
    treatment: extracted between its `START`/`END` markers plus the
    separate `MONTHS` array it reads, run via `new Function(...)`, then
    exercised against real calendar facts (verified independently against
    plain `Date()` output, not guessed) — day-31 clamping into February
    across a leap-year line, a quarterly anchor whose quarter crosses a
    year boundary (and is labelled by calendar quarter, not anchor-relative
    — `2027-Q1` for a Nov-anchored bill's February occurrence), annual
    Feb-29 clamping, a 5-Monday month, biweekly across both 2026 DST
    transitions (only the fall-back direction actually shifts a date if the
    arithmetic regresses to epoch-ms — see below), and `statusFor`'s
    soon/upcoming boundary plus its overdue check across a year line. Each
    of these was proven to fail for the right reason by breaking the
    corresponding line in `index.html`, confirming the expected test (and
    only that test) failed, then reverting — same proof discipline as
    `raceAbort`'s suite.
  - Spend History and backfill (`historyByMonth()`, `renderHistory()`,
    `backfillOccurrences()`, `buildBackfillPayment()`) — found 2026-09-13
    with zero coverage. These close over `db` and call each other
    (`billById`/`catById`/`uid`/`money`/`infoI`) rather than being
    self-contained like the cadence block, so each named function is
    extracted individually by regex (a same-line-close-first, multi-line-
    fallback pattern, since some of these are one-liners) and run together
    in one scope, with `db` an object the fixtures mutate in place between
    cases and with the already-tested `CAD.occurrencesInMonth` /
    `CAD.periodDisplay` injected rather than re-extracted — real
    integration, proving backfill actually generates records from the
    cadence logic rather than merely asserting it does. Covers: unpaid
    payments excluded; a paid $0 or amount-less payment still counted (and
    not corrupting the total into `$NaN`); an archived bill's payment
    folded into the total; several same-bill payments in one month all
    landing in that bucket (5 real weekly Mondays, not a hand-built list);
    biweekly occurrences either side of a month boundary splitting into two
    months; a bill paid in a different month than it fell due, grouped by
    `dueDate` not `paidAt`; a month with no payments producing no map entry
    (not a phantom `$0` row); the empty-store "No history yet" state;
    newest-first ordering; `backfillOccurrences`' dedupe; and
    `buildBackfillPayment`'s full decision tree (valid, duplicate period,
    cadence-impossible period, negative amount, unparseable amount). All 11
    mutation-tested the same way as the cadence suite.
  - `buildPaidDateEdit(payment,newDateRaw,today)` (same section, added
    2026-09-13): valid edit, the today-itself inclusive boundary, a future
    date refused, an unpaid payment refused, a missing payment refused
    without throwing, an empty date, a malformed date string, and — the
    settled question from that thread — a structural check that a
    successful edit's return object carries `paidAt` and never `dueDate`,
    plus an end-to-end check that applying the edit leaves
    `historyByMonth()`'s month bucket unchanged. 6 mutations proved each
    bites, including one that added a `dueDate` key to the return value
    specifically to prove the month-shift guard would catch it.
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
- **Not covered by anything:** `backfillModal()`, `backfillPeriodFieldHtml()`,
  and `paidDateModal()` themselves (the DOM-rendering half — `openModal`,
  the `<select>`/`<input type="date">` markup) — only the pure decision
  logic they call is tested. Same for the `save-backfill` and
  `save-paiddate` click handlers' own DOM glue (reading `$('#f-bf-month')`,
  `$('#f-paiddate')`, etc.) now that the decision logic behind each is a
  pure function.

## Gotchas

- Biweekly's DST safety (`occurrencesInMonth`'s `Date(y,m,d+14*k)` calendar
  arithmetic) is asymmetric if someone regresses it to epoch-ms math: a
  spring-forward (23-hour day) overshoot lands at 1am the *same* calendar
  day, so it still reads correctly; a fall-back (25-hour day) undershoot
  lands at 11pm the *previous* day, which does shift the date. The
  fall-back test catches that regression; the spring-forward test stays as
  a guard against other arithmetic mistakes even though it wouldn't catch
  that specific one. Don't read "the spring test still passes" as "the
  mutation didn't break anything."
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
