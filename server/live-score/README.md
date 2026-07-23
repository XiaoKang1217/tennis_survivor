# 炉网实时比分服务

这个服务是浏览器与 API Tennis 之间的唯一数据入口。API key 只保存在服务器的 `/etc/luwang-live-score.env`，不会进入 Git、前端或浏览器网络请求。

## 轮询规则

- 北京时间当天赛程缓存 5 分钟。
- 赛前赔率通过 API Tennis `get_odds` 按当天及次日批量获取，每小时刷新并按比赛 ID 合并；优先展示 bet365，缺失时依次回退到 1xBet、Betway、bwin 或首个完整盘口。
- 没有进入开赛观察窗口时，不请求 `get_livescore`。
- 预计开赛前 15 分钟进入观察窗口；尚未确认有进行中比赛时，每 60 秒请求一次。
- API 确认至少一场比赛进行中后，固定每 8 秒请求一次，并通过 SSE 推送给所有在线用户。
- 所有进行中比赛结束或从 `get_livescore` 消失后，退出 8 秒轮询；当天仍有待开始比赛时，在下一场观察窗口恢复 60 秒检查。
- 官方赛程日包含换算成北京时间次日的 `+1` 比赛；北京时间零点不会强制换日。
- 北京时间进入新的一天后立即预抓并缓存新赛程，日期选择器可提前查看；上一官方赛程日全部比赛结束后，才自动把默认日期切换到新的赛程日。
- 从 2026-07-22 起保存最近 5 个赛程日的最终快照，供前端日期选择器查询。
- API-Tennis 的 `get_fixtures` 是比赛身份、赛事、日期、时间、轮次和状态的唯一赛程来源。
- `live-tennis.cn` 只作为可选的场地类型与具体球场元数据来源：必须赛事名称和完整双方球员全部匹配才补充，绝不新增、删除、重命名或过滤 API 比赛。
- API 一旦确认完赛，按 event ID 和“日期＋赛事＋单双打＋完整双方球员”双重锁定，后续数据不能降级为进行中或未开赛。
- 不再根据 6500、7300、7800 等本地请求计数改变刷新速度或主动停止。
- 所有浏览器共享服务端的一次请求和缓存，访问人数不会成倍消耗上游额度。

## 本地启动

复制 `.env.example` 中的变量到安全的进程环境后运行：

```sh
npm test
npm start
```

前端默认请求同源 `/api`。本地生产同构预览可通过 `?live-api=http://127.0.0.1:8787` 指向 SSH 隧道后的服务器服务。

## 生产部署

1. 服务代码安装到 `/opt/luwang-live-score/current`。
2. 环境文件安装到 `/etc/luwang-live-score.env`，权限 `0600`。
3. 缓存目录使用 `/var/lib/luwang-live-score`。
4. systemd 使用 `deploy/luwang-live-score.service`。
5. Nginx 使用 `live-api.tennisapi.online` 并配置 HTTPS 证书。

生产前端设置：

```html
<script>window.LUWANG_LIVE_API_BASE='https://live-api.tennisapi.online';</script>
```
