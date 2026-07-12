# 八徽章全站换肤层

这次改动只新增全站主题层，不重绘、不覆盖已经完成的登录态、榜单铭牌、配置大厅卡片和“我的阵容”徽章组件。

## 文件

- `assets/theme/full-site-badge-themes.css`：8 套色板与全站真实模块适配。
- `assets/theme/full-site-badge-theme.js`：主题切换 API、别名兼容和事件同步。
- `index.html`：只新增 CSS/JS 引用，并给 `body` 增加全站主题入口。

## 已覆盖的站点模块

- 顶部导航、功能标签与登录按钮
- 巡回赛经纪人首屏、提示框、资产指标
- 球员市场、筛选器、球员卡片、详情展开
- 收益计算器、“我的”、配置大厅、榜单与规则弹窗
- ATP/WTA 实时选人、KPI、表格、展开行与筛选器
- 积分构成、用户偏好、历史上的惨案
- 每日航班、每日运势、每日毒奶及毒奶榜
- FAQ、登录/注册弹窗
- PC 与移动端

语义状态色仍然保留，例如成功为绿、失败/毒奶为红；其外围底色、边框和表面会跟随徽章主题。

## 主题 ID

| 徽章 | 主题 ID | 全站方向 |
|---|---|---|
| 辛纳狐 | `sinner_fox` | 赤陶、奶油、少量松石绿 |
| 阿卡鸭 | `alcaraz_duck` | 粉紫晚霞、珊瑚、香槟金 |
| 德约GOAT | `djoko_goat` | 深海军蓝、象牙白、古金 |
| 卢布喵 | `rublev_cat` | 夜蓝、雾蓝、暖金 |
| 郑钦文Queen | `zheng_queen` | 帝王紫、暖白、王冠金 |
| 王欣瑜美人鱼 | `wang_mermaid` | 珍珠白、海水青、贝壳紫 |
| 炉网挚友 | `luwang_friend` | 蜂蜜、麦穗金、橄榄绿 |
| 温网限定 | `wimbledon_2026` | 草地绿、博物馆象牙、古典金 |

## 与徽章系统连接

徽章装备或切换成功后触发一次事件即可：

```js
document.dispatchEvent(new CustomEvent('luwang:badge-change', {
  detail: { badgeId: equippedBadgeId }
}));
```

也可以直接调用：

```js
window.LuwangFullSiteTheme.set('alcaraz_duck');
```

脚本兼容简写 ID，例如 `alcaraz`、`djokovic`、`wimbledon`、`lubu`、`zheng`、`sinner`、`mermaid` 和 `luwang`。

## 独立预览

不改装备状态也可以通过 URL 参数预览：

```text
?site-theme=wimbledon_2026
?site-theme=alcaraz_duck
?site-theme=djoko_goat
```

URL 参数优先级最高，便于逐一截图验收。
