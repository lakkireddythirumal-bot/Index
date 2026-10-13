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

### 2. Dashboard refresh downloads full history from five Supabase tables — high priority

`loadDashboard()` concurrently reads `stock_data`, `production_data`, `pp_bags_data`, `feed_unit_data`, and `feed_unit_totals`. `supabaseRows()` uses `select=*` and offset pagination in batches of 1,000 until each table is exhausted. The complete history is then retained in browser memory for dashboard calculations and reports.

**Risk:** Refresh time and data transfer grow with history. Avoiding this safely requires identifying which views need full history, using date-range queries or server-side summaries where possible, and validating that historical reports and comparisons remain correct. This was not changed in this first pass because it can affect business calculations.

### 3. Cache persistence and fallback are disabled — high priority

The source defines cache keys, but `saveCache()` returns immediately, `cachedData()` returns `null`, and `restoreCache()` returns `false`. The refresh failure UI mentions saved data, but this code path does not restore a previously successful dashboard payload.

**Recommendation:** Add a bounded, versioned persistent cache with explicit freshness labels and safe quota/error handling. Prefer IndexedDB for larger history payloads over assuming the browser's localStorage quota is sufficient.

### 4. Main JavaScript file is a large, tightly coupled unit — medium priority

`app.js` is approximately 226 KB and contains more than 360 named functions. Rendering, data access, calculations, reports, and UI interactions share one global script.

**Risk:** Changes can cause regressions across unrelated sections, and isolated automated tests are difficult.

**Recommendation:** Introduce characterization tests first, then split code into modules by domain (data access, calculations, reports, spare parts, UI) without changing output contracts in one large rewrite.

### 5. Frontend data-access security needs a backend review — important, not confirmed as a vulnerability

The browser source includes a Supabase legacy `anon` key and a Google Apps Script web-app URL. A Supabase `anon` key is expected to be public in a browser app; it is not equivalent to a service-role/secret key. Actual security depends on table grants, Row Level Security (RLS) policies, and the Apps Script deployment's access settings.

**Required verification outside this repository:** Confirm RLS is enabled for every exposed table, review grants and policies for all operations, ensure no service-role/secret key is present in browser code, and confirm the Apps Script endpoint exposes only intended data. No database policy or Apps Script permission changes were made in this audit.

### 6. Error handling does not consistently preserve useful stale data — medium priority

The dashboard retries the full data load once after an error, then displays a generic connection failure. Because persistent cache restoration is disabled, the user may lose access to previously loaded information after a network failure or page reload.

**Recommendation:** Pair the cache restoration work with a visible last-updated timestamp and a clear stale-data indicator. Never label cached data as live.

## Changes made in this audit

- Updated `service-worker.js` to prefer fresh deployed app assets while retaining offline fallback.
- Added `app.js` and `style.css` to the app-shell cache.
- Bumped the service-worker cache version to `v3` so the previous cache is removed on activation.
- Preserved the existing Supabase URL/key wiring, Google Apps Script endpoint, dashboard data shape, reports, and application logic.
- Added this audit document for traceability.

## Verification status

- [x] Inspected current repository source files and the existing service-worker behavior.
- [x] Confirmed the service-worker update was committed to GitHub.
- [ ] Browser-level online/offline testing — not run in this environment.
- [ ] Confirm service-worker update activation on a real device — not run.
- [ ] Confirm live GitHub Pages deployment and deployed version — not checked.
- [ ] Audit live Supabase RLS/grants and Google Apps Script access settings — not possible from source files alone.
- [ ] Measure real API transfer/time before and after — baseline not collected.

## Recommended next sequence

1. Verify the service-worker update on the deployed site and an iPhone.
2. Add a safe, bounded IndexedDB cache and honest stale-data status.
3. Measure per-table row counts, payload sizes, and refresh timings.
4. Reduce redundant history reads with validated date-range queries or server-side summaries.
5. Add automated checks for stock reconciliation, month comparisons, and report totals before refactoring the large JavaScript file.
6. Review Supabase RLS/grants and Apps Script permissions separately before making security changes.
