# Changelog

All notable maintenance changes to this site are documented here.

Versioning guideline:
- Patch versions fix bugs or update data without changing behavior.
- Minor versions add user-facing features or change data logic.
- Major versions are reserved for large rewrites or incompatible data changes.

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
