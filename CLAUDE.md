# CLAUDE.md

Follow [AGENTS.md](AGENTS.md).

- `main` への直接コミット・直接pushは禁止。
- 作業ブランチとPull Requestを利用する。
- ブランチ名は `feature/<topic>` / `fix/<topic>` / `docs/<topic>` / `chore/<topic>`。
- PR作成前に `just check` を実行する。配布変更時は `just test-smoke` も実行する。
- アプリの実装はRustへ一本化済み。TypeScript実装やNode用ランタイム依存を再導入しない。
