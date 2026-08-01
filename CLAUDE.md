# CLAUDE.md

## Git Workflow

- `main` への直接コミット・直接 push は禁止。
- 変更は必ず作業ブランチを切り、Pull Request を経由して `main` にマージする。
- ブランチ名は `feature/<topic>` / `fix/<topic>` / `docs/<topic>` / `chore/<topic>`。
- PR を作る前に `npm run check` と `npm test` を通す。
