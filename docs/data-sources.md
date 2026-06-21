# Data Sources

## 数据来源总览

当前主站的幸存者、积分构成、用户偏好等老模块不依赖后端数据库，前端数据来自仓库内的静态 JSON 文件：

- `data/current.json`
- `data/breakdown.json`
- `data/history.json`
- `data/preference.json`
- `data/manager_atp_calendar_2026.json`

这些 JSON 文件由 `scripts/` 下的 Python 脚本抓取和生成，主要外部来源是：

- `https://www.live-tennis.cn`

巡回赛经纪人模块是新增例外：市场和赛事元数据保留静态 JSON 快照用于快速首屏加载，登录后的提交阵容、扣款、换人、账本和配置大厅真实数据走 Supabase 表/RPC。

## 候选新增数据：签表挑战

调研日期：2026-05-23

可公开读取的 live-tennis 签表挑战入口：

- 菜单：`https://www.live-tennis.cn/zh/dc/menu`
- 赛历：`https://www.live-tennis.cn/zh/dc/calendar/2026`
- 赛事页样例：`https://www.live-tennis.cn/zh/dc/RG/2026/MS`
- 预测分布样例：`https://www.live-tennis.cn/zh/dc/RG/2026/MS/distribution`
- 规则：`https://www.live-tennis.cn/zh/help/rule/dc`

可用于炉网第一版“签表挑战观察室”的字段：

- 当前开放挑战列表和原站链接。
- 赛事名、年份、组别、截止时间。
- 预测分布中的冠军、半区、1/4 区、1/8 区、决赛对阵、人数和百分比。
- 原站填表链接和预测分布链接。

暂不建议第一版依赖：

- 排行榜 query：页面入口是公开的，但数据通过带 CSRF 保护的 POST 接口加载，例如 `/zh/dc/RG/2026/MS/rank/query`，需要额外验证 cookie/token 流程和抓取稳定性。
- 提交签表：需要原站登录和写入能力，炉网不应代提交。

## `data/current.json`

生成脚本：

- `scripts/fetch_current.py`

主要用途：

- ATP/WTA 当前进行中的幸存者赛事
- 当前用户列表
- 今日选择
- 存活/未参赛/出局状态
- 当前排名、即时排名、即时积分
- 本站得分、扣除积分
- 今日选人统计

关键规则：

- 当前进行中赛事从 live-tennis 菜单候选中动态识别。
- 如果菜单提前暴露下一站，但 detail 数据为空，需要避免误选下一站。
- 四大满贯当前站在扣除去年积分后必须强制保留本站 `0` 分，不允许由其他赛事顶上。
- 轮空用户如果第一天未参赛，前端不能按存活用户显示。

## `data/breakdown.json`

生成脚本：

- `scripts/fetch_breakdown.py`

主要用途：

- 积分构成
- 大满贯、年终、1000、500、250 等赛事类型分布
- 场地分布
- 未来 12 个月积分失效分布
- 用户即时积分构成明细

关键规则：

- 当前进行中的大满贯即使本站得分为 `0`，也要在积分构成里保留强制项。
- “世界第一”标签应根据即时排名动态赋予。

## `data/history.json`

生成脚本：

- `scripts/fetch_history.py`

主要用途：

- 用户偏好
- 历史上的惨案
- 每日航班
- 每日运势候选数据

关键规则：

- 历史赛事来自 live-tennis 幸存者日历。
- 惨案文案应基于已知字段生成，避免写死错误球员事实。
- 每日航班应优先展示当前赛事；当前赛事无航班记录时显示暂无数据，不回退到历史旧赛事。

## `data/preference.json`

生成脚本：

- `scripts/fetch_preference.py`

当前状态：

- 仓库中存在该数据文件和脚本，但当前 GitHub Actions 的每日数据主要更新 `data/history.json`。
- 后续如果偏好模块重构，需要确认 `preference.json` 是否继续作为独立数据源，还是并入 `history.json`。

## `data/manager_atp_calendar_2026.json`

来源：

- 用户提供的 ATP 官方 2026 巡回赛历 PDF：`2026-atp-tour-calendar-december-2025.pdf`

主要用途：

- 巡回赛经纪人模块的 ATP 赛站元数据种子表。
- 存储每站赛事的赛季、巡回赛、周次、城市、级别、场地、签位数、赛事名和来源。
- 正式接入 Supabase 后，可导入 `manager_tournaments` 表；前端根据幸存者当前开放赛事直接查询对应赛站，不需要用户打开页面时再临时查签位数。

字段：

- `season`
- `tour`
- `calendar_month`
- `week`
- `start_date_label`
- `city`
- `category`
- `level`
- `tournament_name`
- `surface_code`
- `surface`
- `draw_size`
- `manager_eligible`
- `source`
- `event_key`

关键规则：

- 只保留第一版经理游戏可用的普通单打赛事：ATP 250、ATP 500、ATP Masters 1000、大满贯。
- United Cup、Davis Cup、Laver Cup、ATP Finals、Next Gen Finals 暂不进入第一版经理经济规则，避免团队赛和小组赛误用淘汰赛轮次收益。
- `event_key` 包含赛季、周次、城市和赛事名，避免巴黎、伦敦等同城多站覆盖。

建议 Supabase 表：

```sql
create table if not exists public.manager_tournaments (
  id uuid primary key default gen_random_uuid(),
  season int not null,
  tour text not null check (tour in ('ATP', 'WTA')),
  event_key text not null,
  live_tennis_event_id text,
  calendar_month text,
  week int,
  start_date_label text,
  city text not null,
  category text not null,
  level text not null,
  tournament_name text not null,
  surface_code text,
  surface text,
  draw_size int not null,
  manager_eligible boolean not null default true,
  source text,
  source_url text,
  updated_at timestamptz not null default now(),
  unique (season, tour, event_key)
);
```

查询方式：

- 当前幸存者赛事有 live-tennis `event_id` 时，优先用 `live_tennis_event_id` 查。
- 没有映射时，用 `season + tour + week + city/tournament_name` 兜底匹配。
- 前端只接收已经归一化后的 `level/surface/draw_size`，不在页面加载时解析 PDF 或网页。

## 数据更新风险

- live-tennis 页面结构变化会导致抓取失败。
- 赛事名称硬编码会导致新赛事、改名赛事、双周赛事异常。
- GitHub Actions 定时任务不保证精确准点执行，尤其整点和半点附近容易延迟。
- 大 JSON 文件会增加页面加载成本，需要后续考虑拆分或懒加载。
