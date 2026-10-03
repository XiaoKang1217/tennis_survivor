# Project Docs

These files are the long-term maintenance notes for `tennis_survivor`.

Recommended files to attach to the Codex project:

- `CHANGELOG.md`
- `docs/project-context.md`
- `docs/release-process.md`
- `docs/data-sources.md`
- `docs/page-tables.md`
- `docs/analytics.md`
- `docs/backlog.md`
- `docs/supabase-auth-following.md`
- `docs/supabase-daily-jinx.md`

## File Guide

- `project-context.md`
  - Project background, technical stack, modules, and default collaboration rules.

- `release-process.md`
  - Standard test, preview, commit, publish, and Pages deployment flow.

- `data-sources.md`
  - Data files, generating scripts, external source, and key data rules.

- `live-data-boundary.md`
  - Public frontend/private backend ownership boundary for realtime tennis data.

- `page-tables.md`
  - Frontend table modules, fields, interactions, and current meaning of "sheet".

- `analytics.md`
  - GA4 plan, privacy rules, event names, and event parameters.

- `supabase-auth-following.md`
  - Supabase Auth, Postgres tables, RLS policies, and validation checklist for the following-users feature.

- `supabase-daily-jinx.md`
  - Supabase table, RLS policies, and validation checklist for the `每日毒奶` voting module.

- `backlog.md`
  - Near-term and long-term feature ideas.

## Project Instruction Snippet

Use this as the Codex project instruction:

```text
You are my maintenance agent for the tennis_survivor website.
Repository: XiaoKang1217/tennis_survivor.

Default workflow:
1. For new features, first produce a design and do not write code.
2. Wait for confirmation before coding.
3. After coding, run focused tests and local preview.
4. Let me confirm the local preview before publishing.
5. Update CHANGELOG.md for every release.
6. Add tests for important scoring, status, and data rules.
7. Protect user privacy. Do not track specific user identities in analytics.
8. Prefer the existing static GitHub Pages architecture unless a feature requires writable data.
9. When conversations produce durable decisions, rules, todos, validation results, or handoff notes, update the appropriate Markdown docs promptly.
```
仓库地址：https://github.com/XiaoKang1217/tennis_survivor
炉网地址：https://xiaokang1217.github.io/tennis_survivor/
