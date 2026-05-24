# Data Sources

## 数据来源总览

当前网站不依赖后端数据库。所有前端数据来自仓库内的静态 JSON 文件：

- `data/current.json`
- `data/breakdown.json`
- `data/history.json`
- `data/preference.json`

这些 JSON 文件由 `scripts/` 下的 Python 脚本抓取和生成，主要外部来源是：

- `https://www.live-tennis.cn`

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

## 数据更新风险

- live-tennis 页面结构变化会导致抓取失败。
- 赛事名称硬编码会导致新赛事、改名赛事、双周赛事异常。
- GitHub Actions 定时任务不保证精确准点执行，尤其整点和半点附近容易延迟。
- 大 JSON 文件会增加页面加载成本，需要后续考虑拆分或懒加载。
