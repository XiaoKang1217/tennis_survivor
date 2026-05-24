# Release Process

## 标准发布流程

1. 理解需求并确认范围。
2. 如为新功能，先输出设计，不写代码。
3. 修改代码或数据脚本。
4. 更新或新增测试。
5. 本地运行数据脚本或测试。
6. 启动本地预览，通常为 `http://127.0.0.1:4173/`。
7. 用浏览器检查关键路径。
8. 用户确认本地效果。
9. 更新 `CHANGELOG.md`。
10. commit。
11. push 到 GitHub。
12. 等待 GitHub Pages 部署成功。
13. 线上验收。

## 推荐版本号

- Patch：bug 修复、文档、数据更新，例如 `v0.1.1`
- Minor：新增用户可见功能，例如 `v0.2.0`
- Major：大重构或不兼容数据结构变化，例如 `v1.0.0`

## 常用验证命令

```bash
python3 -m unittest scripts.test_scoring
python3 -m py_compile scripts/fetch_current.py scripts/fetch_breakdown.py scripts/fetch_history.py scripts/fetch_preference.py scripts/test_scoring.py
python3 -m http.server 4173
```

## GitHub Actions

- `Update Current Data`
  - 文件：`.github/workflows/update_current.yml`
  - 频率：每小时 `7`、`22`、`37`、`52` 分
  - 作用：更新 `data/current.json`

- `Update Breakdown Data`
  - 文件：`.github/workflows/update_breakdown.yml`
  - 频率：每天 `03:11` UTC
  - 作用：更新 `data/current.json` 和 `data/breakdown.json`

- `Update Daily Data`
  - 文件：`.github/workflows/update_preference.yml`
  - 频率：每天 `03:19` UTC
  - 作用：更新 `data/history.json`

## 发布注意事项

- 如果修改了 `.github/workflows/*.yml`，GitHub token 需要 `workflow` 权限。
- 如果本地 `git push` 网络超时，可以重试，或使用 GitHub App 直接创建远端提交。
- 发布后必须等待 `pages build and deployment` 成功。
- GitHub Actions 可能出现 Node.js 版本弃用警告；只要部署成功，这不是当前站点代码错误。
