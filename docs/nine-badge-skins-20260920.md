# 九徽章正式接入（2026-09-20）

基于当前主站 `index.html` 与已确认的 V3 皮肤资产接入。页面导航、阵容数据与操作、榜单数据与排序、购买/扣款/佩戴 RPC 均沿用现站。九款新增皮肤只在各自主题键下生效。顶部 banner 也使用同款装饰铭牌，姓名是可自动缩小、双向居中的 HTML 文字。

## 商品配置

| 新徽章 | 编号 | 经纪人本金 |
| --- | --- | ---: |
| 辛纳·落日球场的狐狸诗 | LW-2026-13 | 3999 |
| 门希克·沐光时刻 | LW-2026-14 | 3999 |
| 卢布列夫·赤弦不息 | LW-2026-15 | 3599 |
| 郑钦文·破晓之羽 | LW-2026-16 | 3999 |
| 阿尔卡拉斯·金狮逐光 | LW-2026-17 | 3999 |
| 莱巴金娜·雪落无声 | LW-2026-18 | 4599 |
| 2026美网·不夜之境 | U26-LIMITED | 2999 |
| 兹维列夫·当打之年 | LW-2026-19 | 3999 |
| 梅德韦杰夫·青葱校园 | LW-2026-20 | 3599 |

美网是赛事限定，其他八款为球员纪念。文案、故事、编号、全站配色沿用批准的 V3 内容。郑钦文使用 `object-position:center top` 显示凤凰。辛纳保留一双狐耳、一条尾巴的铭牌。

旧徽章本金价：费德勒、纳达尔、德约、辛纳赤焰狐心、阿卡蜜蜂鸭、阿卡星辉少年冠、郑钦文女王风范为 3999；斯瓦泰克、高芙、王欣瑜、卢布喵喵王子为 3599；温网限定为 2999。皮革 599、烂白菜 199、炉网挚友敬请期待均保持原配置。涨价不追溯已有购买和用户本金。

## 接入文件

- `assets/manager/badges/ui-v20/catalog.json`：九款权威发行配置；`catalog.js` 是同步的浏览器版本。
- `site-themes.css`：批准的九套全站色系与资产变量。
- `components.css`：只作用于 `.new-skin-scope` 内部的新组件，保留伪元素遮罩。
- `release.css` / `leaderboards.css`：对现站顶部、配置大厅、我的阵容、经纪人和毒奶榜的主题适配。
- `components.js` / `release.js`：真实徽章和铭牌、商城与实装预览。示例球员和示例分数仅用于商城弹窗；实际页面继续由原函数传入真实内容。
- `index.html`：扩展目录、更新指定价格、插入新主题分支及资源引用。旧徽章继续走原渲染分支。

新商城卡右上角读取真实拥有状态；按钮复用 `preview-badge`、`buy-badge`、`equip-badge` 等原事件，已佩戴时显示「佩戴中」。NEW!! 沿用原站红色倾斜样式，按新发行日期排序，旧徽章不显示 NEW!!。

## 图片与加载

所有图以独立 WebP 发出，不引入 78 MB 单文件预览。72 张图片总计约 7.0 MB，完整清单、尺寸约定和哈希在 `asset-manifest.json`。

徽章主图 640px；榜单/顶部小徽章 128px；顶部背景 1280px；榜单背景 1200px；商城背景 800px；两种卡片背景 960px；铭牌 720px。保持原构图和透明通道，仅进行缩放与编码。

徽章图片 `loading="lazy"` / `decoding="async"`。商城背景进入视口前约 350px 才加载。实装预览仅加载当前场景 CSS 引用的图片，不批量预载所有九套背景。无徽章的默认页面不请求新皮肤图片。采用系统中文字体，不附带预览用的大体积 CJK 字库。

## 后台发布

`.github/workflows/publish-badge-skins.yml` 在指定发行文件推送到 main 时运行。使用仓库已经配置的 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`，先测试和预检，再执行 `scripts/manager/publish-nine-badge-skins.mjs --write`。

该脚本仅访问 `tour_manager_badges`：一次 upsert 新九款，按价格分组更新旧十二款，仅改变其 price 字段，随后读回核验。保留已有 metadata 字段；序号冲突或旧商品缺失会在写入前中止。允许幂等重跑。无 schema 迁移，不写用户拥有状态、用户本金、阵容、历史购买或任何收益流水。

前台仍调用 `tour_manager_purchase_badge` 与 `tour_manager_set_active_badge`，实际扣款由原后台 RPC 读取商品表完成。发布完成应同时确认 GitHub Pages 和 Publish Badge Skin Catalogue 两个任务成功，并公开读取商品目录核对价格。

## 验证

运行 `node --test scripts/manager/tests/nine-badge-release.test.mjs scripts/manager/tests/badge-shop-order.test.mjs scripts/manager/tests/badge-gallery.test.mjs`。

浏览器验收覆盖桌面与手机、九套顶部/配置大厅/我的阵容、五种商城实装场景、长昵称、两类真实榜单 DOM、新旧商品价格、NEW!! 数量、资产解码和原购买/佩戴 RPC 链路。交易验收使用隔离的模拟 RPC，不消耗真实用户本金。
