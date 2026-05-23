# Analytics Plan

## 目标

接入 GA4，用于了解网站真实使用情况：

- 每日 PV
- 每日 UV
- 用户主要访问哪些模块
- ATP/WTA 使用比例
- 用户是否使用筛选、排序、选手统计点击等关键交互

## 隐私原则

- 不上传用户 ID。
- 不上传具体玩家用户名。
- 不上传完整选人明细。
- 可以上传模块名、赛事名、巡回赛类型、筛选类型、被点击的球员名。

## GA4 Measurement ID

已填写。前端使用 `index.html` 里的 `GA_MEASUREMENT_ID`：

```text
G-E51GZG7C1F
```

当前已填写真实 ID，页面会加载 GA4 并发送 page view 与自定义事件。

## 基础事件

GA4 默认 page view 会记录：

- 页面浏览量
- 访客数
- 来源
- 设备
- 地区
- 页面路径

## 自定义事件

### `module_view`

用户进入或切换模块时触发。

参数：

- `module`
- `tour`
- `event_label`

建议模块值：

- `current_picks`
- `live_points`
- `breakdown`
- `preference`
- `disasters`
- `daily_flights`
- `fortune`

### `tour_switch`

用户切换 ATP/WTA 时触发。

参数：

- `module`
- `tour`

### `event_switch`

用户切换赛事或年份时触发。

参数：

- `module`
- `tour`
- `event_label`
- `year`

### `filter_apply`

用户使用筛选时触发。

参数：

- `module`
- `tour`
- `filter_type`

建议筛选值：

- `all`
- `alive`
- `filled`
- `search`
- `pick`

### `player_stat_click`

用户点击实时选人统计里的球员时触发。

参数：

- `module`
- `tour`
- `player`
- `event_label`

### `sort_apply`

用户点击表格列头排序时触发。

参数：

- `module`
- `tour`
- `sort_key`
- `sort_direction`

### `fortune_draw`

用户在每日运势模块摇签时触发。

参数：

- `module`
- `tour`

## 实现注意事项

- `trackEvent()` 必须在 GA4 未加载时安全失败，不影响页面功能。
- 模块初始化时只打一次默认模块访问事件。
- 对搜索输入类事件做节流或只记录筛选类型，不记录每个键盘输入。
- 本地预览时可保留 debug 输出，但发布前不应污染页面 UI。

## 当前接入状态

- 已接入 GA4 初始化封装。
- 已接入 `module_view`、`tour_switch`、`event_switch`、`filter_apply`、`player_stat_click`、`sort_apply`、`fortune_draw`。
- 已填写 Measurement ID：`G-E51GZG7C1F`。

## 后续查看方式

- Realtime：确认刚发布后是否收到访问和事件。
- Reports > Engagement > Events：查看事件总量。
- Explore：按 `module`、`tour`、`event_name`、`event_label` 分析模块访问。
