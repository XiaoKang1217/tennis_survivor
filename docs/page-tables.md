# Page Tables

## 说明

本项目目前没有直接使用 Google Sheets 作为数据源。用户口中的“sheet”主要指网站前端里的表格模块。

如果未来引入 Google Sheets 作为可编辑后台，需要另开文档记录真实 Google Sheets 的 worksheet、列名、权限和同步规则。

## 顶部导航

顶部导航保留 ATP/WTA 实时选人两个独立入口；其他双 tour 模块合并为父模块入口，并在模块内部用 ATP/WTA sheet 切换：

- ATP 实时选人
- WTA 实时选人
- 积分构成：内部切换 ATP/WTA
- 用户偏好：内部切换 ATP/WTA
- 历史上的惨案：内部切换 ATP/WTA
- 每日航班
- 每日运势
- 每日毒奶

## 实时选人表

位置：

- ATP：`content-ms-s`
- WTA：`content-ws-s`

数据来源：

- `data/current.json`

核心字段：

- `user_id`
- `username`
- `current_rank`
- `instant_rank`
- `today_player`
- `players`
- `status`
- `fill_status`
- `has_today`
- `not_participated`
- `current_score`
- `deduct_score`
- `this_event_score`
- `instant_score`
- `rank_change`
- `day`

核心交互：

- 搜索用户名或选手
- 全部/仅存活/今日已填筛选
- 关注/取消关注用户，并通过“关注用户”筛选查看已关注玩家
- 点击今日选人统计里的选手，筛选选择该选手的用户
- 今日选人统计默认展示前 10 名，超过 10 名的候选可点“展开”查看全部。
- 今日选人统计中的存活/今日已填数字使用实时选人数据里的 `alive`/`filled_count` 口径；球员分布百分比以今日已填人数为分母。
- `player_stats` 需要输出全量候选统计，不能只输出 top20，否则展开后仍不是全部，且用统计求和会误判今日已填。
- 点击用户行展开历史选择
- 点击表头排序

关注规则：

- 关注关系保存稳定的 `user_id`。
- 同一个 `user_id` 被关注后，在 ATP/WTA 实时选人表、积分构成表、用户偏好表中出现时都显示为已关注。
- 未登录用户点击关注或“关注用户”筛选时弹出注册/登录界面；其他浏览不需要登录。

## 积分构成表

位置：

- ATP：`bd-content-ms`
- WTA：`bd-content-ws`

数据来源：

- `data/breakdown.json`

核心字段：

- `uid`
- `n`
- `ir`
- `s`
- `gs`
- `m1`
- `a5`
- `a2`
- `ye`
- `label`
- `detail`
- `exp_list`

核心交互：

- 按排名、积分和积分类型排序
- 点击用户行展开积分构成
- 关注/取消关注用户，并通过“关注用户”筛选查看已关注玩家的积分构成
- 查看赛事类型、场地、积分失效时间
- 世界第一标签动态跟随即时排名第一

## 用户偏好表

位置：

- ATP：`content-ms-p`
- WTA：`content-ws-p`

数据来源：

- `data/history.json`

核心字段：

- `user_id`
- `username`
- `instant_rank`
- `events_participated`
- `events_eliminated`
- `events_champion`
- `worst_player_name`
- `worst_player_count`
- `best_player_name`
- `best_player_count`
- `champion_players`
- `final_players`

核心交互：

- 切换年份范围
- 点击用户行展开详情
- 关注/取消关注用户，并通过“关注用户”筛选查看已关注玩家的历史偏好
- 排序

## 历史上的惨案表

位置：

- ATP：`content-ms-t`
- WTA：`content-ws-t`

数据来源：

- `data/history.json`

核心字段：

- `rank`
- `player`
- `event`
- `day`
- `count`
- `comment`

核心交互：

- 切换年份
- 查看球员、赛站、轮次、受害人数和辣评

## 每日航班

位置：

- `p-flight`

数据来源：

- `data/history.json`
- 当前赛事信息来自 `data/current.json`

核心规则：

- 当前赛事无出局/退赛/自杀记录时显示暂无航班数据。
- 不应该自动回退展示历史赛事航班，避免误导用户。

## 每日运势

位置：

- `p-fortune`

数据来源：

- 当前可选球员主要来自 `data/current.json`

核心交互：

- ATP/WTA 切换
- 摇签生成今日娱乐建议

## 每日毒奶

位置：

- `p-jinx`

数据来源：

- 候选球员来自 `data/current.json` 的 `today_pool`
- 毒奶榜权重来自 `data/daily_jinx_pick_counts.json` 中每日实时选人统计快照。
- 出局结算来自 `data/daily_jinx_settlements.json`，每条出局记录带有当日选人统计 `pick_count`。
- 投票和留言保存到 Supabase `daily_jinx_votes`

核心规则：

- ATP/WTA 切换。
- 题目为 `今天你最希望谁出局？`。
- 候选名单按中文姓名拼音从 A 到 Z 排列。
- 每个登录用户每天每个 tour 只能提交一次。
- 每次选择 1 到 3 名球员。
- 留言必填，最长 50 字。
- 提交后当天不能修改。
- 提交后结果区显示当前账号当日真实选择，格式为 `你今日的毒奶球员为：xxx，xxx，xxx`。
- 提交后才可见大家选择了谁。
- 弹幕只在该模块内展示，格式为 `@用户名：留言`。
- 一个提交只展示一条弹幕，即使该用户一次选择了 2-3 名球员。
- 弹幕按轨道队列循环滚动，同速播放；页面切出再回来时会重启队列，避免后台节流导致弹幕堆叠。
- 毒奶区域包含三个内部模块：ATP 男单、WTA 女单、毒奶榜。
- 毒奶榜不再拆两个 sheet，而是在一个视图里左侧展示 ATP，右侧展示 WTA。
- 毒奶得分规则：如果用户在该球员比赛开始前完成提交，且该球员真实出局，并且该球员当天在实时选人统计里有 `x` 人选择，则每个毒中该球员的用户获得 `x` 分。
- 取消、推迟、未开赛或未完赛的比赛不产生毒奶得分。
- 毒奶榜展示累计毒奶分：每天结算昨日赛果后，把新增命中分数累加到用户历史总分里。
- 炉网账号昵称如果是 11 位手机号，前端展示时只保留前三位和后四位，中间显示为 `****`。
- 毒奶榜只展示聚合后的炉网昵称和毒奶分；原始投票明细仍受 Supabase RLS 保护。

## 候选模块：签表挑战观察室

状态：

- 已完成原站入口和规则调研，尚未编码。

候选位置：

- `p-dc`

候选数据来源：

- 新增 `data/dc.json`
- 候选生成脚本：`scripts/fetch_dc.py`

候选核心字段：

- `updated_at`
- `events`
- `event_id`
- `year`
- `gender`
- `event_name`
- `tour`
- `deadline`
- `entry_url`
- `distribution_url`
- `distribution`
- `section`
- `player`
- `opponent`
- `count`
- `percent`

候选核心交互：

- ATP/WTA 和赛事切换。
- 查看当前挑战、截止时间和原站填表入口。
- 查看冠军、半区、1/4 区、1/8 区和决赛对阵预测分布。
- 高亮共识热门、争议区块和娱乐向冷门提醒。
