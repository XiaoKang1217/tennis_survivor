# 巡回赛经纪人上线说明

## 数据源

- 当前开站由 `data/manager/active_events.json` 控制。
- 单站数据放在 `data/manager/events/*.json`，包含级别、场地、签数、提交窗口、换人规则、签表球员和身价字段。
- 头像映射放在 `data/manager/player_photos.json`。无法确认官方头像时使用本地 fallback，避免错图；已确认的 WTA 官方头像缓存到 `assets/manager/players/wta/`，当前目录约 900KB。
- ATP 签数长期参考 `data/manager_atp_calendar_2026.json`；WTA 单站以官方 tournament/draw 页面为准。

## Supabase

1. 运行 `supabase/migrations/202606200001_tour_manager.sql`。
2. 用 service role key 同步当前数据：

```bash
SUPABASE_SERVICE_ROLE_KEY=... node scripts/manager/sync-current-station.mjs
```

前端未登录时仍可用 localStorage 保持 demo 预览体验；只要登录且 Supabase 配置存在，本地和线上都会走 Supabase RPC，提交阵容、扣钱、换人、账本以数据库为准。

如果没有 service role key，脚本会自动 dry-run，只生成 `outputs/manager-sync/*.json`，不会写库。

本地 demo 样例配置和样例榜单只允许在 `localhost/127.0.0.1/file://` 且未配置 Supabase 时作为预览 fallback；一旦 Supabase 可用，配置大厅和公共榜单不能回退到假数据。

## 关键边界

- 未登录不能签约、提交、换人、看个人数据。
- 每站只能提交一次阵容。
- 人数、预算、重复提交、换人次数都由 RPC 校验。
- 提交和换人只信数据库里的 `event_key + player_key + price`，不信前端传来的价格。
- 赛事按 `station_key` 绑定，不能把别站球员塞进当前站。
- 配置大厅和公共榜单应从 Supabase view 读取；阵容提交后立即展示完整配置。
- 每日结算任务以后只写 `tour_manager_settlements` 和 `tour_manager_wallet_ledger`，前端不自行结算真实收益。
- 每日竞猜从北京时间 2026-08-17 起，在 ATP、WTA 各自当日有效候选比赛中按双方世界排名差升序排列，选择上中位场次；奇数取正中，偶数取中间两场里排名差较大的场次。已发布的 `station_key + contest_date + tour` 题目保持冻结，不因规则或赛程刷新而替换。
- 球员主键统一使用 `tour|english-slug`；事件 JSON 里若保留中文 key，前端和同步脚本都会转成 canonical key，避免本地草稿、头像和 RPC 提交不一致。
- WTA 官方页面/头像 blob 若缺图，只标记 `missing` 并使用 fallback，不自动抓外部图片。
