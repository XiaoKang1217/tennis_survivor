# 炉网实时比分服务

这个服务是浏览器与 API Tennis 之间的唯一数据入口。API key 只保存在服务器的 `/etc/luwang-live-score.env`，不会进入 Git、前端或浏览器网络请求。

## 轮询规则

- 北京时间当天赛程缓存 5 分钟。
- 赛前赔率通过 API Tennis `get_odds` 按当天及次日批量获取，每小时刷新并按比赛 ID 合并；优先展示 bet365，缺失时依次回退到 1xBet、Betway、bwin 或首个完整盘口。
- 没有进入开赛观察窗口时，不请求 `get_livescore`。
- 预计开赛前 20 分钟至赛后 4 小时之间，每 60 秒探测一次。
- 确认有进行中比赛后，每 8 秒请求一次，并通过 SSE 推送给所有在线用户。
- 当日请求量达到 6500/7300/7800 后，自动降为 15 秒/60 秒/停止非必要实时请求。
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
