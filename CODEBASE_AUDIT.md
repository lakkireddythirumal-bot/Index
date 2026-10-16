# Codebase Audit — Feed Plant Manager

**Repository:** `lakkireddythirumal-bot/Index`  
**Branch reviewed:** `main`  
**Review date:** 2026-10-13  
**Scope:** Static review of `index.html`, `app.js`, `style.css`, `manifest.json`, and `service-worker.js`.

This is a source-code audit, not a live production test. Supabase database policies, Google Apps Script permissions, and live browser behavior cannot be confirmed from these repository files alone.

## Highest-impact findings

### 1. App assets could remain stale after a deployment — addressed

The previous service worker used cache-first behavior for same-origin non-navigation assets. Once `app.js` or `style.css` was cached, it could continue serving the old copy until the cache version changed. This could make a successful GitHub commit appear not to take effect for returning users.

**Change committed:** `service-worker.js` now uses network-first for navigation and local JS/CSS/JSON/web-manifest assets, falls back to cached content when offline, precaches `app.js` and `style.css`, and uses cache version `v3` to retire the prior cache after activation.

### 2. Dashboard history reads — improved with a bounded incremental refresh

The dashboard still retains the complete history required by historical views and reports. The first load and a forced full refresh read all five tables. After a successful full sync, ordinary refreshes fetch only rows with `report_date` in the most recent seven days, replacing cached rows in that date window while retaining older history locally. A full sync is scheduled after 24 hours, and the visible Refresh button forces a full sync.

A live database count on 2026-10-13 showed 6,430 rows across the five tables. The recent-date query returned 2,432 rows, or about 38% of the full row count. This suggests roughly 62% fewer rows transferred during incremental refreshes when the cache is eligible. This is a row-count estimate, not a measured network-byte or latency benchmark.

**Trade-off:** Changes or deletions older than the seven-day window are picked up by the daily full sync or the manual full refresh. The full history remains available between syncs; if IndexedDB is unavailable or empty, the app safely falls back to a full read.

### 3. Cache persistence and fallback — addressed

The dashboard now stores one versioned snapshot in IndexedDB, including the normalized dashboard payload, raw source rows, save time, and last full-sync time. On startup, a previous snapshot is rendered while a live refresh runs. If the network refresh fails, the app retains available dashboard data and marks the connection as offline instead of replacing the screen with a blank error state. Cache read/write failures are caught and do not block a live refresh.

The cache stores a single latest snapshot rather than unbounded entries. IndexedDB quota or browser restrictions can still prevent caching, in which case the live-data path continues to work.

### 4. Main JavaScript file is a large, tightly coupled unit — medium priority

`app.js` is approximately 230 KB and contains more than 360 named functions. Rendering, data access, calculations, reports, and UI interactions share one global script.

**Risk:** Changes can cause regressions across unrelated sections, and isolated automated tests are difficult.

**Recommendation:** Introduce characterization tests first, then split code into modules by domain (data access, calculations, reports, spare parts, UI) without changing output contracts in one large rewrite.

### 5. Frontend data-access security needs a backend review — important, not confirmed as a vulnerability

The browser source includes a Supabase legacy `anon` key and a Google Apps Script web-app URL. A Supabase `anon` key is designed to be public in browser code; it is not equivalent to a service-role/secret key. A live database check confirmed RLS is enabled on the five dashboard tables and `material_master`, but each table's SELECT policy uses `USING (true)`. Therefore, anyone who can reach the API with the public key can read those tables. This may be intentional for the current dashboard, but it is not private/user-scoped access.

The Supabase security advisor returned no findings during this review. That is not a guarantee that public access is appropriate for the business data. No RLS policy or Apps Script permission changes were made, to avoid breaking the existing app or integrations. The Google Apps Script deployment's access settings still require a separate check.

### 6. Error handling and stale-data visibility — improved

On startup, the app can restore its last successful snapshot and show a cached timestamp while refreshing. If a refresh fails, already loaded data remains visible and the connection status is marked offline. Cached data is not labelled as live.

## Changes made in this audit

- Updated `service-worker.js` to prefer fresh deployed app assets while retaining offline fallback.
- Added `app.js` and `style.css` to the app-shell cache and bumped the cache version to `v3`.
- Added a single-snapshot IndexedDB cache for the dashboard and raw history.
- Added a seven-day recent-date refresh path, with a full sync after 24 hours and a full sync on manual Refresh.
- Changed refresh-failure handling to retain loaded/cached data and clearly mark the dashboard offline.
- Preserved the existing Supabase URL/key wiring, Google Apps Script endpoint, dashboard data shape, reports, and application logic.
- Added this audit document for traceability.

## Verification status

- [x] Inspected current repository source files and existing service-worker/cache behavior.
- [x] Confirmed the cache and refresh changes were committed to GitHub.
- [x] Queried the live Supabase schema and row counts. At review time: stock 5,487; production 230; PP bags 230; feed unit 462; feed totals 21.
- [x] Confirmed RLS is enabled on the five dashboard tables and `material_master`; each has a SELECT policy with `USING (true)`. This means reads are intentionally public to callers who have the public API key; it does not provide user-level confidentiality.
- [x] Supabase security advisor returned no findings at the time of review.
- [ ] Browser-level online/offline testing — not run in this environment.
- [ ] Confirm service-worker update activation and IndexedDB behavior on a real iPhone/browser — not run.
- [ ] Confirm live GitHub Pages deployment and deployed version — not checked.
- [ ] Verify Google Apps Script deployment access settings — not confirmed.
- [ ] Measure actual response bytes, refresh latency, and behavior after real data imports — not yet measured.

## Recommended next sequence

1. Verify the service-worker and IndexedDB cache on the deployed site and an iPhone.
2. Measure actual network bytes and refresh timings, then confirm historical reports against a full sync.
3. Decide whether public read access is acceptable for this internal dashboard; if not, introduce authentication and scoped RLS policies before tightening the current SELECT policies.
4. Verify Google Apps Script deployment access separately.
5. Add automated checks for stock reconciliation, month comparisons, and report totals before refactoring the large JavaScript file.


## Data Accuracy & Reconciliation Center — added 2026-10-13

A read-only panel was added below Attention Required. It summarizes four checks and exposes a row-level drill-down without modifying source data or replacing existing dashboard calculations.

- **Raw material stock:** checks opening + recognized inward movements − recognized outward movements − closing against recorded consumption for the selected/latest stock date. The classification deliberately reuses the current transaction labels; unrecognized movement types are not silently assigned to a category.
- **Feed-unit balance:** checks opening + production + transfer − dispatch against closing for each product/date.
- **PP-bag balance:** checks opening + received − issue − damage against closing.
- **Production output percentage:** checks reported output percentage against actual output ÷ standard output, with a tolerance of 0.5 percentage points. Rows with zero standard and zero actual output and no percentage are marked not applicable rather than counted as missing.
- **Source freshness:** shows the latest available report date for stock, production, PP bags, feed unit, and feed-unit totals.

Missing required fields are shown as NO DATA; numeric differences are shown as MISMATCH. The panel is diagnostic and read-only. Raw material checks use known transaction labels and should be reconciled against the source MIS before the results are treated as an accounting authority.

### Verification of this addition

- [x] UI markup added without replacing the existing Attention Required or Management Quick View.
- [x] Checks are called from the existing dashboard render cycle.
- [x] Existing Supabase, Google Apps Script, caching, reports, and Data Control wiring was not intentionally changed by this addition.
- [x] JavaScript syntax and manifest JSON checks performed after changes.
- [ ] Browser rendering, real mobile interaction, and end-to-end comparison against a manually verified plant report remain to be tested.


### Live source-data spot check — 2026-10-13

A read-only SQL spot check was run against the latest available report date:

- **Production:** 10 rows; 5 have zero standard and zero actual output with no percentage (not applicable); the other eligible rows had no output-percentage mismatches in this sample.
- **PP bags:** 10 rows; no missing balance fields and no arithmetic mismatches in this sample.
- **Feed unit:** 21 rows; 3 have one or more required balance fields missing. One complete row, YOUNG LAYER MASH 60KG, has a 7.20 MT difference between reported closing and calculated closing and should be reviewed against the original MIS.
- **Raw material stock:** 34 materials on the latest date. Some key transaction rows have missing daily quantities, and the source contains generic or variant transaction labels. The center therefore marks missing or unclassified rows as NO DATA rather than claiming a false match.

These are source-data spot checks, not browser end-to-end tests. The flagged differences are observations to reconcile with the plant's original MIS, not automatic edits to the database.

## Calculation accuracy follow-up — 2026-10-16

**Working branch:** `audit/calculation-fixes-2026-10-16`  
**Scope:** Frontend calculation consistency fixes in `app.js`. No database rows, Supabase policies, source Excel files, or credentials were changed.

### Fixes applied

- Removed the non-negative clamp from raw-material reconciliation so an impossible/negative calculated balance remains visible as a mismatch instead of being converted to zero.
- Centralized consumption movement spelling recognition and reused it in reconciliation, abnormal-consumption checks, history charts, comparisons, Data Control, and reports.
- Applied the existing premix KG-to-MT conversion consistently to feed production/dispatch trends, selected-date feed metrics, and Plant AI feed totals.
- Converted raw-material stock totals to MT before displaying them as a plant-wide total.
- Changed the production trend alert volume to use Feed Unit production in MT; production output and process-loss percentages continue to use production-quality records, whose actual output is in bags.
- Added deterministic one-row-per-product/date selection for feed-unit history calculations, and aligned duplicate product selection across feed-unit and PP-bag summaries.
- Reused the production display's duplicate-product selection rule for selected production rows.
- Changed plant-level output efficiency from a simple mean of product percentages to total actual output divided by total standard output, with a reported-percentage average only as a fallback when standard/actual quantities are unavailable.

### Verification performed

- [x] Parsed the full updated JavaScript source successfully using a JavaScript syntax parser.
- [x] Ran source-level regression assertions for the unit conversions, unclamped reconciliation, centralized consumption recognition, dated-product deduplication, and weighted output calculation.
- [x] Confirmed the updated branch file can be fetched from GitHub after each commit.
- [ ] Browser/device regression testing has not been run.
- [ ] The calculations have not yet been reconciled against a fresh live Supabase export and manually verified source MIS.
- [ ] The hidden duplicate row in the source Excel/import workflow cannot be repaired by frontend code alone; the import/upsert key and source-row handling must be checked separately.

**Important:** The fixes are committed on the audit branch only. They should be reviewed and tested against known plant reports before merging into `main`. The code-level checks do not prove that every live-data calculation is correct.

### Live-data spot checks — 2026-10-16

Read-only SQL checks were run against the connected Supabase project for duplicate product/date rows, production percentage arithmetic, and latest available balance records. These are targeted spot checks, not a full source-MIS reconciliation.

- No duplicate product/date groups were found in the current `feed_unit_data`, `pp_bags_data`, or `production_data` tables during the duplicate check.
- No production output-percentage arithmetic mismatches above 0.5 percentage points were found in that check.
- PP-bag balances on the latest report date reconciled in the query.
- **Feed Unit:** `BROILER FINISHER PELLETS` had a 0.90 MT difference between calculated closing (32.55 MT) and reported closing (31.15 MT) on 2026-10-16. `CATTLE FEED` had a missing daily production value. These are source-data exceptions; no database values were changed.
- **Raw material stock:** `MAIZE SILO2` has two `CL. STOCK` records for 2026-10-16, one with `for_day = -1.62759` and one with `for_day = 29.40951`. The app now marks this reconciliation as NO DATA until the duplicate is reviewed instead of silently choosing one. The correct record cannot safely be inferred by frontend logic alone.
- **Premix stock fields:** `BFP PREMIX`, `PSC PREMIX`, and `STARTER PREMIX` had null daily quantities on the latest date while monthly/yearly values existed. The app now treats missing daily quantities as NO DATA instead of treating them as zero.
- `DE OILED C DOC` uses the source transaction label `CL. STOCK IN M.T`; the closing-stock label matcher now recognizes this variant.

### Additional calculation safeguards

- Daily stock balances now preserve their sign; a negative closing is not converted to a positive value.
- Duplicate opening/closing rows and missing daily quantities are reported as NO DATA/review-needed rather than producing a misleading MATCH.
- Stock display/status logic distinguishes NO DATA and NEGATIVE STOCK from a real zero balance.
