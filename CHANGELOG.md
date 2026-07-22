# Changelog

All notable maintenance changes to this site are documented here.

Versioning guideline:
- Patch versions fix bugs or update data without changing behavior.
- Minor versions add user-facing features or change data logic.
- Major versions are reserved for large rewrites or incompatible data changes.

## Unreleased - v0.4.0

### Added
- Added a lazy-loaded live tennis module with Beijing-date status filters, collapsible tournament sections, court grouping, surface colors, serving and latest-point indicators, and responsive match cards.
- Added match statistics and H2H detail views plus independent player H2H and yearly match-history searches.
- Added a server-side API Tennis proxy with shared JSON cache, SSE fan-out, ETags, CORS allow-listing, request throttling, and persisted daily request accounting.
- Added production systemd and Nginx templates. The API key is read only from a protected server environment file and is never exposed to the static site.

### Changed
- Live-score polling now runs only around scheduled match windows: 60-second observation probes and 8-second refreshes after a live match is detected, with adaptive quota protection at 6500, 7300, and 7800 daily requests.
- Missing court and surface metadata are displayed as `未标注` instead of being hardcoded.

### Validation
- Added Node.js tests for field normalization, tournament/court grouping, observation windows, no polling outside match windows, and adaptive request intervals.
- Verified the service health and cached response endpoints, parsed all new JavaScript, and ran `git diff --check`.
- Verified desktop browser navigation, zero horizontal overflow, and the independent H2H form without using simulated score data.

## v0.3.9 - 2026-07-20

Release baseline:
- Online version before release: commit `04439517`.
- New published version: `v0.3.9`.
- Rollback target for this release: commit `04439517`.

### Fixed
- Fixed asynchronous remote-state refreshes so a missing or cancelled backend lineup cannot clear an unsubmitted or withdrawn local draft.
- Kept submitted, locked, settling, and settled lineups authoritative so successful submissions and official transfers still refresh and persist active contracts immediately.

### Validation
- Added regressions for unsubmitted drafts, withdrawn drafts, resubmission, and official transfer refresh without changing transfer business rules.
- Ran the complete Node.js manager test suite and Python scoring tests.
- Ran station validation and `git diff --check`.

## v0.3.8 - 2026-07-20

Release baseline:
- Online version before release: commit `21fdfe5b`.
- New published version: `v0.3.8`.
- Rollback target for this release: commit `21fdfe5b`.

### Fixed
- Fixed pre-match withdraw/edit/resubmit so a successful resubmission immediately replaces the cached draft with the authoritative active contracts.
- Fixed submitted lineups so stale local draft players are never merged into the current remote lineup.
- Stopped repeated renders from reloading an obsolete lineup snapshot from local storage, while preserving the withdrawn lineup as an editable draft until it is resubmitted.

### Validation
- Added regression coverage for withdrawing Blockx/Bartunkova, editing the draft to Darderi/Krejcikova, and resubmitting without ghost players.
- Ran the complete Node.js manager test suite and Python scoring tests.
- Ran station validation and `git diff --check`.

## v0.3.7 - 2026-07-20

Release baseline:
- Online version before release: commit `10e1e5e`.
- New published version: `v0.3.7`.
- Rollback target for this release: commit `10e1e5e`.

### Changed
- Moved the Estoril/Prague manager lineup submission deadline from 17:45 to 16:45 Asia/Shanghai for both tours.
- Marked the station schedule windows as manual so the daily refresh does not recalculate the deadline from the 18:00 first-match placeholder.
- Added immutable station publication v2 as a window amendment while preserving publication v1 opening prices and history.

### Validation
- Ran the focused Estoril/Prague opening and publication tests.
- Ran the complete Node.js manager test suite and Python scoring tests.
- Ran station validation and `git diff --check`.

## v0.3.6 - 2026-05-29

Release baseline:
- Online version before release: `v0.3.5` lineage at live commit `dbb22cd`.
- New published version: `v0.3.6`.
- Rollback target for this release: commit `dbb22cd`.

### Changed
- Daily Jinx settlements now include each completed match's start time so leaderboard scoring can ignore votes submitted after that player's match had already started.
- Updated the Daily Jinx leaderboard RPC documentation so a hit only scores when the vote was submitted before `match_start_at`; canceled, postponed, unstarted, and unfinished matches do not score.

### Fixed
- Fixed the Daily Jinx leaderboard on mobile by preventing the global table minimum width from pushing score and hit columns off-screen.

### Validation
- Regenerated `data/daily_jinx_settlements.json` with match-start timestamps and confirmed no settlement rows are missing `match_start_at`.
- Verified the mobile Daily Jinx leaderboard at 390x844: board width and table scroll width both fit within the viewport.
- Ran JS syntax checks for `index.html`.
- Ran Python syntax checks for `scripts/fetch_daily_jinx_settlements.py`.
- Ran `python3 -m unittest scripts.test_scoring`.
- Ran `git diff --check`.

## v0.3.5 - 2026-05-25

Release baseline:
- Online version before release: `v0.3.4` lineage at live commit `93bdc10`.
- New published version: `v0.3.5`.
- Rollback target for this release: commit `93bdc10`.

### Changed
- Mask phone-like炉网账号 nicknames in frontend display, keeping only the first three and last four digits, for example `15804031803` renders as `158****1803`.
- Documented that `毒奶榜` shows cumulative scores across all settled Daily Jinx dates while adding newly settled points each day.

### Validation
- Ran JS syntax checks for `index.html`.
- Verified `15804031803` renders as `158****1803` while normal nicknames are unchanged.
- Ran `git diff --check`.

## v0.3.4 - 2026-05-25

Release baseline:
- Online version before release: `v0.3.3` lineage at live commit `79c68f2`.
- New published version: `v0.3.4`.
- Rollback target for this release: commit `79c68f2`.

### Added
- Added `data/daily_jinx_pick_counts.json` as a daily survivor live-pick snapshot so the Daily Jinx leaderboard can score against the original pick-count weights after `current.json` moves to the next day.
- Updated the current-data workflow to publish the Daily Jinx pick-count snapshot together with `data/current.json`.

### Fixed
- Fixed `毒奶榜` scoring to award each correct jinx the losing player's survivor live-pick count, rather than the number of Daily Jinx voters who selected that player.
- Preserved existing Daily Jinx settlement records when the settlement refresh cannot fetch a result page, avoiding accidental data loss during transient network failures.

### Validation
- Ran JS syntax checks for `index.html`.
- Ran Python syntax checks for `scripts/fetch_current.py` and `scripts/fetch_daily_jinx_settlements.py`.
- Ran `python3 -m unittest scripts.test_scoring`.
- Ran `git diff --check`.

## v0.3.3 - 2026-05-24

Release baseline:
- Online version before release: `v0.3.2` lineage at live commit `aebeec1`.
- New published version: `v0.3.3`.
- Rollback target for this release: commit `aebeec1`.

### Added
- Added the Daily Jinx settlement data pipeline for `毒奶榜`, including the generated `data/daily_jinx_settlements.json`, fetch script, and scheduled workflow integration.

### Fixed
- Changed the Daily Jinx submitted-result copy to show the current account's actual selected players: `你今日的毒奶球员为：xxx，xxx，xxx`.
- Fixed Daily Jinx submission under Supabase RLS by inserting votes without requesting a returned row, so the write no longer triggers an unnecessary select/returning permission check.

### Validation
- Ran JS syntax checks for `index.html`.
- Ran `python3 -m unittest scripts.test_scoring`.
- Ran `git diff --check`.
- Opened local `每日毒奶` preview and confirmed the module loads without browser console errors.

## v0.3.2 - 2026-05-24

Release baseline:
- Online version before release: `v0.3.1` lineage at live commit `b223575`.
- New published version: `v0.3.2`.
- Rollback target for this release: commit `b223575`.

### Added
- Added frontend analytics events for registration, logout, daily-jinx result views, daily-jinx leaderboard views, row expansion, data-load errors, Supabase errors, and external-link clicks.
- Added anonymous GA4 `user_id` hashing for logged-in sessions without sending nicknames, emails, survivor usernames, follow targets, vote targets, or messages.
- Added optional frontend Supabase writes for login events, follow/unfollow events, daily-jinx vote picks, and feature-daily activity; these safely no-op until the corresponding tables or RPC are created.

### Validation
- Ran JS syntax checks for `index.html`.
- Ran `python3 -m unittest scripts.test_scoring`.
- Ran `git diff --check`.
- Verified the local main page at `http://127.0.0.1:8001/`.

## v0.3.1 - 2026-05-24

Release baseline:
- Online version before release: `v0.3.0` lineage at live commit `3c01bcb`.
- New published version: `v0.3.1`.
- Rollback target for this release: commit `3c01bcb`.

### Fixed
- Fixed `每日毒奶` barrage playback so messages use a consistent speed, queue per lane, and avoid visual overlap.
- Fixed barrage recovery after switching away from the page and returning by clearing paused animation state and restarting the queue.

### Validation
- Ran JS syntax checks for `index.html`.
- Ran `git diff --check`.
- Verified the local barrage preview at `http://127.0.0.1:4182/jinx-preview.html`, including consistent speed, no overlap, continuous looping, and recovery after tab visibility changes.

## v0.3.0 - 2026-05-24

Release baseline:
- Online version before release: `v0.2.0` lineage at live commit `92d3eb2`.
- New published version: `v0.3.0`.
- Rollback target for this release: commit `92d3eb2`.

### Added
- Added the Supabase-backed `每日毒奶` module with ATP/WTA voting, one daily submission per account per tour, 1-3 player selections, and a required 50-character-max message.
- Added post-submission results for `每日毒奶`, including participant count, per-player vote counts, percentages, and module-local barrage messages.
- Added Supabase SQL/RLS documentation and validation notes for `daily_jinx_votes`.

### Changed
- Consolidated top navigation so ATP/WTA live-pick pages stay separate while breakdown, preference, and disaster modules use internal ATP/WTA sheet switches.
- Changed live-pick player statistics to left-align text, show the top 10 by default, and expand to the full player list on demand.
- Changed live-pick `今日已填` display to use the dynamic `filled_count` data field rather than summing player-stat rows.
- Changed current-data generation so `player_stats` outputs the full list instead of top 20 only.
- Moved the account button next to the update timestamp on mobile and removed the repeated `每30分钟内更新` suffix from the timestamp line.

### Fixed
- Fixed `每日毒奶` barrage rendering so one submission creates only one barrage message even when the user selects multiple players.

### Validation
- Ran JS syntax checks for `index.html`.
- Ran `python3 -m unittest scripts.test_scoring`.
- Ran Python syntax checks for `scripts/fetch_current.py`.
- Ran `git diff --check`.
- Verified local preview at `http://127.0.0.1:4181/`, including grouped navigation, live-pick stat expansion, mobile header layout, and daily-jinx submission/results behavior.

## v0.2.0 - 2026-05-24

Release baseline:
- Online version before release: `v0.1.1` at commit `7124db6`.
- New published version: `v0.2.0`.
- Rollback target for this release: commit `7124db6`.

### Added
- Added Supabase-backed nickname/password registration and login.
- Added follow/unfollow stars for survivor users.
- Added the `关注用户` filter to live picks, breakdown, and preference tables.
- Added Supabase setup, RLS, and validation documentation for the following-users feature.

### Changed
- Follow state now syncs by stable survivor `user_id` across ATP/WTA and across live picks, breakdown, and preference modules.
- Login prompts appear only when users try to follow someone, open the following filter, or use the account entry.
- Follow-related analytics events avoid sending account IDs, followed user IDs, or follow lists.

### Validation
- Ran JS syntax checks for `index.html`.
- Ran `python3 -m unittest scripts.test_scoring`.
- Ran Python syntax checks for data scripts.
- Verified local preview at `http://127.0.0.1:4180/`.
- Verified Supabase registration, duplicate nickname blocking, login, follow persistence after refresh, following filter, cross-module follow sync, unfollow, and logout.

## v0.1.1 - 2026-05-23

### Added
- Added project maintenance documentation under `docs/`.
- Added project context, release process, data source notes, page table notes, analytics plan, and backlog documentation.

### Changed
- Documented the default new-feature workflow: design first, code after confirmation, then test, preview, publish, and update changelog.
- Increased the real-time pick data schedule and client polling cadence so visible updates stay within the intended half-hour window more reliably.

## v0.1.0 - 2026-05-23

### Added
- Added clickable player filters in real-time pick statistics so selecting a player filters the user detail table below.
- Added unit tests for Grand Slam forced-zero scoring behavior.
- Added scheduled workflow test checks before committing generated data.

### Fixed
- Fixed Grand Slam scoring so the current Grand Slam is forced to 0 after last year's points are dropped, instead of being replaced by another event score.
- Fixed current-event breakdown composition so forced-zero Grand Slam entries remain visible in the scoring details.
- Fixed the dynamic "world No. 1" label so it follows the current instant ranking leader.
- Fixed not-participated users so they no longer appear as alive users or pass the "alive only" filter.
- Fixed current-event flight display so it no longer falls back to older event data before the current event has eliminations.

### Changed
- Regenerated current, breakdown, and history data for the 2026 French Open state.
- Moved scheduled GitHub Actions away from exact half-hour and daily boundary times to reduce schedule delay risk.
- Reworked historical elimination copy generation to avoid hardcoded, stale, or incorrect player facts.

### Validation
- Ran unit tests with `python3 -m unittest scripts.test_scoring`.
- Ran Python syntax checks for data scripts.
- Verified the local preview at `http://127.0.0.1:4173/`.
- Published commit `d4849ac` to `main` and confirmed GitHub Pages deployment succeeded.
