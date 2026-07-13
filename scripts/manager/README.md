# Tour Manager Data Pipeline

The production data flow is:

Current station selection is still manual: edit `data/manager/active_events.json` to choose the ATP/WTA station. The scripts below refresh the dynamic links inside that station.

0. `validate-station.mjs`
   - Checks the active station, event files, player keys, draw positions, scores, prices, and photo readiness.
   - Fails on structural problems and missing station-level submission windows, warns on expected temporary gaps such as later-event schedules or missing official photos.

1. `refresh-current-station-data.mjs`
   - Reads the active station, discovers live-tennis draw URLs, refreshes draw players, reads result/schedule pages, derives submission and transfer windows, writes a sync report, and can sync matches plus call settlement.
   - `--write` updates local event JSON. `--sync --settle` writes events/matches and calls the service-role settlement RPC when `SUPABASE_SERVICE_ROLE_KEY` is present.

2. `maybe-build-prices.mjs` / `build-prices.mjs`
   - The daily workflow calls `maybe-build-prices.mjs`. A formally opened station should set `pricing.market_prices_locked: true` in `active_events.json`; the workflow then keeps the published opening prices while draw, schedule, ranking, and result data continue to refresh. Before a station is locked, pricing may run only before the submission cutoff/main draw start. `--force` remains an explicit operator override.
   - Fetches/imports official ATP/WTA rankings, Tennis Abstract Elo, and the active station draw files.
   - Computes base strength, surface fit, draw path, recent-form proxy, total score, price, expected points, and break-even round.
   - Writes `data/manager/market_snapshot.json`, updates active `data/manager/events/*.json`, and can sync ranking/Elo/price rows to Supabase.
   - ATP official rankings may be Cloudflare-protected. If so, pass a downloaded official export/page with `--atp-ranking-file`.

3. `publish-station-snapshot.mjs`
   - Freezes the complete station publication after pricing: station config, full market, resolved display photos, selected price version and player prices, Combo rules, station grant, submission/transfer windows, source-file hashes, and one canonical SHA-256 data hash.
   - Writes an immutable Git archive under `data/manager/publications/` and inserts the same hash-verified snapshot into Supabase when migration `202607130001_manager_station_publication_snapshots.sql` has been applied.
   - An existing version is never overwritten. A later cutoff, transfer window, market correction, or rule correction must use a new `publication_version` and the matching amendment kind.

4. `apply-qualifier-placements.mjs`
   - Reads qualifier-placement markers created during draw refresh, syncs the replacement player rows, and calls the service-role RPC that updates already submitted Q-slot contracts to the real landed player while keeping the original Q-slot contract price.
   - If the Supabase RPC migration has not been applied yet, the script writes a warning report and exits successfully so the daily workflow is not blocked.

5. `apply-pre-r1-substitutions.mjs`
   - Reads same draw-position pre-R1 substitution markers created during draw refresh, syncs the replacement player rows, and calls the service-role RPC that updates submitted contracts to the replacement player while keeping the original contract price.
   - Requires migrations `202606210006_manager_pre_r1_substitution_price_policy.sql` and `202606230004_manager_pre_r1_substitution_repair.sql`; without the RPC, the script exits successfully with a warning instead of calling the old price-changing RPC.
   - Can be rerun after the main draw has started to repair missed substitutions. The report marks those rows as `late_review`, but still applies them with service-role access.

6. `sync-current-station.mjs`
   - Runs validation, station sync, Tennis Abstract Elo imports, and reviewed photo metadata sync in order.
   - This is a lower-level fallback if prices have already been reviewed and generated.

7. `sync-station.mjs`
   - Reads `data/manager/active_events.json`.
   - Writes events, player master records, draw entries, market players, and a draft price version.

8. `import-tennis-abstract-elo.mjs`
   - Reads Tennis Abstract ATP/WTA Elo pages.
   - Writes `tour_manager_elo_snapshots`.

9. `sync-player-photos.mjs`
   - Syncs reviewed photo metadata into player tables.
   - Real download/cache/upload is intentionally separated so bad remote photos cannot silently enter production.

10. `refresh-player-photos.mjs`
   - Resolves official player photos for the active station and updates `data/manager/player_photos.json`.
   - WTA defaults to the official `wtafiles.blob.core.windows.net/images/headshots/{profile_id}.jpg` headshot and can download it into `assets/manager/players/wta/`.
   - ATP official media aliases are Cloudflare-protected from direct scripts, so ATP rows stay pending unless already manually cached.

`.github/workflows/update_manager.yml` runs the manager refresh at 06:00 Asia/Shanghai each day:
`refresh-current-station-data.mjs --write --sync`, then `maybe-build-prices.mjs`, then the current-station publisher, then `apply-qualifier-placements.mjs`, then `apply-pre-r1-substitutions.mjs`, then `settle-current-or-previous-station.mjs`, then `validate-station.mjs`.

`settle-current-or-previous-station.mjs` keeps settlement on `previous_station` while its finals are incomplete. It syncs and settles the previous station first; only after all previous-station finals are completed does it continue to the current active station. This preserves delayed finals and combo settlement during week-to-week station transitions.

All scripts support `--dry-run`. Without `SUPABASE_SERVICE_ROLE_KEY`, dry-run is automatic.

```bash
/Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/validate-station.mjs
/Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/refresh-current-station-data.mjs --write
/Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/maybe-build-prices.mjs --dry-run
/Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/publish-station-snapshot.mjs --write-file --strict-ready --dry-run
/Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/refresh-player-photos.mjs --write
/Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/sync-current-station.mjs --dry-run
/Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/sync-station.mjs --dry-run
/Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/import-tennis-abstract-elo.mjs --tour WTA --dry-run
/Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/sync-player-photos.mjs --dry-run
```

To write to Supabase:

```bash
SUPABASE_SERVICE_ROLE_KEY=... /Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/refresh-current-station-data.mjs --write --sync
SUPABASE_SERVICE_ROLE_KEY=... /Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/maybe-build-prices.mjs
SUPABASE_SERVICE_ROLE_KEY=... /Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/publish-station-snapshot.mjs --write-file --strict-ready
SUPABASE_SERVICE_ROLE_KEY=... /Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/apply-qualifier-placements.mjs
SUPABASE_SERVICE_ROLE_KEY=... /Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/apply-pre-r1-substitutions.mjs
SUPABASE_SERVICE_ROLE_KEY=... /Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/refresh-current-station-data.mjs --skip-draw --skip-schedule --sync --settle
```

Or run individual steps:

```bash
SUPABASE_SERVICE_ROLE_KEY=... /Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/build-prices.mjs --atp-ranking-file outputs/downloads/atp-ranking.html
SUPABASE_SERVICE_ROLE_KEY=... /Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/sync-station.mjs
SUPABASE_SERVICE_ROLE_KEY=... /Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/import-tennis-abstract-elo.mjs --tour WTA
SUPABASE_SERVICE_ROLE_KEY=... /Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/sync-player-photos.mjs
```

Do not publish a price version until the imported draw, ranking, Elo, and photos are reviewed.

## Station Publication Snapshots

The initial station sale is version 1. The publisher is idempotent: rerunning the same version verifies the existing Git/Supabase hash and makes no mutation. If the same station/version has a different hash, publication fails instead of rewriting history.

Before first production use, apply:

```text
supabase/migrations/202607130001_manager_station_publication_snapshots.sql
```

For a normal station opening, `active_events.json` must contain the complete `rules.station_grant`, `rules.combo_version`, and `rules.combo` object. Once every active market is open and the station opening time has arrived, run:

```bash
SUPABASE_SERVICE_ROLE_KEY=... /Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/publish-station-snapshot.mjs --write-file --strict-ready
```

If an official window is published or changed after opening, append a new immutable version. Never edit an existing publication file or database row:

```bash
SUPABASE_SERVICE_ROLE_KEY=... /Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/publish-station-snapshot.mjs --version 2 --kind window_amendment --published-at 2026-07-13T20:00:00+08:00 --write-file --strict-ready
```

Use `market_amendment` for a formally republished market or price correction. Historical Git manifests under `data/manager/publication-manifests/` pin the source commit and rule set used for backfills. To verify or insert all known historical versions:

```bash
/Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/backfill-station-publication-snapshots.mjs --dry-run
SUPABASE_SERVICE_ROLE_KEY=... /Users/candicekang/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/manager/backfill-station-publication-snapshots.mjs
```

Historical backfill is intentionally not part of the daily manager workflow. After applying the migration, run the `Backfill Manager Publication Snapshots` workflow once from GitHub Actions. It requires the table to exist and fails clearly if the migration is missing. The daily workflow only checks or inserts the current station publication.

## Next Station Update Routine

1. Update `data/manager/active_events.json` to point at the ATP/WTA station files.
2. Update or add `data/manager/events/*.json`.
   - If a draw is not out, keep an event shell with `draw_status: "pending"` and `market_status: "draw_pending"`.
   - If a draw is out, include draw positions, profile ids, ranking, scores, price, and qualifier placeholders.
3. Run `refresh-current-station-data.mjs --write`.
   - This refreshes live-tennis draw URLs, draw players, schedule/results, submission cutoff, transfer window fields, and the current-station sync report.
4. Run `build-prices.mjs --dry-run`.
   - This updates the static market snapshot and event files locally.
   - Review warnings for missing rankings, missing Elo, ATP official ranking blocking, and qualifier placeholders.
5. Run `refresh-player-photos.mjs --write` to refresh official WTA photos and pending ATP photo metadata.
6. Review `data/manager/player_photos.json`. Only keep reviewed real official photos or stable fallbacks.
7. Add the complete station grant and Combo rule object to `active_events.json`, then run `publish-station-snapshot.mjs --write-file --strict-ready` when the station formally opens.
8. Re-run `refresh-current-station-data.mjs --write --sync`, `maybe-build-prices.mjs`, `apply-qualifier-placements.mjs`, `apply-pre-r1-substitutions.mjs`, and then `refresh-current-station-data.mjs --skip-draw --skip-schedule --sync --settle` with `SUPABASE_SERVICE_ROLE_KEY=...` to write matches, qualifier placements, pre-R1 substitutions, settlements, ranking, Elo, draw, market, and price-version rows.
