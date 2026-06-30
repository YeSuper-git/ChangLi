# ChangLi 多会话并行开发与发布流程

本文档用于多个 Hermes 会话/Agent 同时开发 ChangLi 时的协作约定。

## 核心原则

- 多个开发会话可以并行开发。
- 每个开发会话必须使用独立分支或独立 worktree。
- 子开发会话只负责开发、验证、commit、push、创建 PR。
- 子开发会话禁止合并 `main`、禁止打 tag、禁止发版。
- 只有主发布会话负责统一 review、解决冲突、合并、版本号、tag、GitHub Actions 和发布记录。

## 子开发会话口令

```text
你是 ChangLi 子开发会话。用独立 worktree/分支开发，只 commit/push/开 PR，不合并 main，不发版。完成后汇报 PR 编号、改动文件、验证结果。
```

## 主发布会话口令

```text
雪莉，收 ChangLi 当前 open PR，解决冲突，合并成一个版本并发布。
```

## 子开发会话流程

1. 拉取最新代码。

   ```bash
   git fetch origin
   ```

2. 从 `origin/main` 创建独立分支。

   ```bash
   git checkout -B agent/<task-name> origin/main
   ```

3. 开发需求。
4. 跑验证。

   ```bash
   npm run build
   cargo check
   ```

5. 提交并推送。

   ```bash
   git status --short
   git add <changed-files>
   git commit -m "fix: 简短说明"
   git push -u origin agent/<task-name>
   ```

6. 创建 PR，并填写 `.github/PULL_REQUEST_TEMPLATE.md`。

## 主发布会话流程

1. 查看 open PR。

   ```bash
   gh pr list --state open --json number,title,headRefName,baseRefName,author,mergeStateStatus,isDraft,updatedAt
   ```

2. 查看每个 PR 的改动文件。

   ```bash
   gh pr diff <PR_NUMBER> --name-only
   gh pr view <PR_NUMBER> --json number,title,url,headRefName,mergeStateStatus,commits,files,body
   ```

3. 检查文件重叠和逻辑冲突。

重点关注：

- `src/pages/ActorDetail.tsx`
- `src/pages/Settings.tsx`
- `src/pages/Library.tsx`
- `src/pages/SeriesDetail.tsx`
- `src/utils/api.ts`
- `src-tauri/src/main.rs`
- `src-tauri/src/db.rs`
- `src-tauri/tauri.conf.json`
- `package.json`
- `.github/workflows/*`

4. 多 PR 时，优先在临时 release 分支整合。

   ```bash
   git fetch origin
   git checkout -B release/integration origin/main
   ```

5. 逐个合并或 cherry-pick PR 改动。
6. 解决冲突后重新跑验证。

   ```bash
   npm run build
   cargo check
   ```

7. 用户明确说“发”“好了吗”“发布”后，才执行发版。

## 发布流程

1. 合并确认要进入本版的 PR。
2. 更新版本号：
   - `package.json`
   - `src-tauri/Cargo.toml`
   - `src-tauri/tauri.conf.json`
   - 如需要，同步 `src-tauri/Cargo.lock`
3. 更新 CHANGELOG / Obsidian 发布记录。
4. commit：

   ```bash
   git commit -m "fix(vX.Y.Z): 标清本版改动"
   ```

5. push main。
6. 创建并推送 tag。

   ```bash
   git tag vX.Y.Z
   git push origin main
   git push origin vX.Y.Z
   ```

7. 等 GitHub Actions 完成。

   ```bash
   gh run list --limit 5
   gh run view <RUN_ID> --json status,conclusion,url,displayTitle,jobs
   ```

8. 验证 Release artifact。
9. 汇报版本号、PR 列表、commit、tag、功能点、验证结果、已知问题。

## 禁止事项

- 禁止多个会话同时合并 `main`。
- 禁止子会话发版。
- 禁止未验证就标记完成。
- 禁止把无关改动混入 PR。
- 禁止在用户说“先不用发”时发布。

## 合并前检查清单

- [ ] PR 基于最新 `origin/main` 或已 rebase。
- [ ] PR 描述完整。
- [ ] 影响文件清楚。
- [ ] 与其他 open PR 文件重叠已检查。
- [ ] `npm run build` 通过。
- [ ] `cargo check` 通过。
- [ ] 没有未提交改动。
- [ ] 用户明确允许发布后才发版。
