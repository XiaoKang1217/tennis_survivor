# Seoul + Singapore 2026 preview

- Station: `2026-w39-seoul-singapore`; WTA Seoul **250**, WTA Singapore **500**.
- Sale: 2026-09-19 20:22:42 to 2026-09-21 09:45, Asia/Shanghai.
- Grant: 500; four result Combo awards share a 700 cap. Steady: 8% gross, cap 150. Value pick: original price <=100, QF/SF/F/W pays 60/120/200/300. Small budget: gross/cost 0.75/1/1.25/1.5 pays 50/100/150/200 (original cost <=500).
- Dual award checks one qualifying player from **each event**, only for this station. Regular ATP/WTA behavior remains the default.
- Welfare: principal <=500, >=3 players, 20% original-cost discount capped at 300; maximum three discounted submissions in the 2026 season, including cancelled submissions. The existing submit RPC enforces the limit under a wallet lock; the new state response exposes that same full-season count.
- Small-budget Combo uses original signing cost, before welfare discount, consistently in calculator and settlement.
- R1 time remains pending official OOP. Existing strict R1 rollover keeps US Open income/boards visible until a confirmed start. Refresh supplies the real R1 time without changing the manual sale cutoff.
- Opening prices are locked; Q identities include the event and draw position. Later qualifier landing retains the original Q price.

## Data

Fetched 2026-09-19. Main-draw positions checked against every official PDF entry:

- Seoul: https://wtafiles.wtatennis.com/pdf/draws/2026/1024/MDS.pdf (32 positions, four Q).
- Singapore: https://wtafiles.wtatennis.com/pdf/draws/2026/1152/MDS.pdf (28 players across 32 positions, four Q, four byes).
- Live draw input: https://www.live-tennis.cn/zh/draw/ajax/31024/2026/device/0/horizontal/true and https://www.live-tennis.cn/zh/draw/ajax/31152/2026/device/0/horizontal/true.
- Rankings: https://www.live-tennis.cn/zh/rank/wta/s/year (1,200 rows; week of September 14).
- Elo: https://tennisabstract.com/reports/wta_elo_ratings.html (530 rows, last update September 14).
- All 52 named players have ranking, overall/surface Elo, and photos. Eight Q placeholders use the established pricing fallback.

## Verification and release

Preview: http://127.0.0.1:8039/ . Local roster operations are browser-only.

No production database writes or deployment were performed. Before production station sync, apply `supabase/migrations/202609190001_manager_seoul_singapore_combo.sql` after the existing US Open migrations. The migration adds the dedicated two-event Combo route and returns the authoritative welfare count; installation itself does not issue any rewards.

Verified browser market switching, calculator, local submission, photo loading, and 390/768/1440px layouts. Earlier local PostgreSQL checks verified daily delta idempotency before the award adjustment; the revised default amounts still require a fresh SQL integration check before deployment. Focused tests cover independent Q identities, locked qualifier replacements, ordinary ATP/WTA dual rules, welfare boundaries, R1 rollover, retirement winners, snapshots and ledger details.

Daily predictions now use one date-range REST query with RLS-filtered embedded personal picks for authenticated users (public games only for anonymous users). Existing cross-day selection order is retained. Submission applies the server receipt immediately and refreshes in the background. This optimization needs no new migration.
