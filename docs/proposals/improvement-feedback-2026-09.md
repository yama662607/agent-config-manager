> Historical proposal. The Rust migration is implemented; see [current migration notes](../rust-migration.md) for the active architecture and checks.

# ACM (Agent Config Manager) 改善提案書 & 実務フィードバック (2026-09)

本ドキュメントは、実務において AI エージェントが `acm` を用いてスキルの新規作成・検証・リネーム・複数プロバイダ（Claude Code / Codex / Antigravity / Grok）への配布を実施した際に得られた **具体的なペインポイント（摩擦）と機能改善提案** をまとめたものです。

開発担当エージェントが本提案を基に機能拡張・リファクタリングを計画・実施できるように構成しています。

---

## 1. 背景と課題の要約

`acm` は設定ファイルの直接編集・symlink 緩衝層（`~/.acm`）を通じたマルチプロバイダ配布において非常に強力に動作しています。一方で、スキルの開発ライフサイクル（試作 ➡ 名前変更 ➡ 再配布 ➡ 壊れたリンクの整理）において、以下の **5 つの摩擦（Friction）** が確認されました。

1. **名前変更（Rename）の手数が多すぎる**:
   スキル名の見直し時に 4 ステップの手動コマンド実行が必要。
2. **「リンク即配布」のショートカット欠如**:
   開発リポジトリの登録（`link`）と全プロバイダへの配布（`add -t c,x,a -H`）が分断されている。
3. **壊れたシンボリックリンク（Dangling Symlinks）の自動修復機能の不足**:
   フォルダ移動やリネーム時に古いリンクが残りやすい。
4. **`SKILL.md` の YAML Frontmatter 事前バリデーションの欠如**:
   形式エラーや description の不備があってもそのまま登録されてしまう。
5. **エージェント向け機械可読出力（`--json`）の拡充余地**:
   一部コマンドの ASCII テーブル出力をエージェントがパースする際のオーバーヘッド。

---

## 2. 具体的な改善提案

---

### 提案 1: `acm skill rename <old-name> <new-name>` コマンドの新設 (優先度: 高)

#### 現状の課題
スキルの名前変更（例: `coding-agent-session-recall` ➡ `ai-agent-archive-recall`）を行う際、以下の 4 手順を手動実行する必要がありました：
```bash
# 現状の手順
acm skill unlink <old-name>
acm skill remove <old-name> -t c,x,a -H
acm skill link ./<new-path>
acm skill add <new-name> -t c,x,a -H
```
途中でプロバイダの指定漏れやゴミが残るリスクがあります。

#### 提案仕様
```bash
acm skill rename <old-name> <new-name> [--path <new-source-path>]
```
- **挙動**:
  1. `~/.acm/skills/<old-name>` を `<new-name>` にリネーム（または新パスへ再リンク）。
  2. 全プロバイダ（Claude, Codex, Antigravity, Grok）の配布先シンボリックリンクを自動で `<new-name>` にリネーム。
  3. 古いシンボリックリンクをアトミックに削除。

---

### 提案 2: `acm skill link` への一括配布フラグ `--distribute` の追加 (優先度: 高)

#### 現状の課題
開発リポジトリで新しいスキルを作った際、通常は全対象プロバイダへ即座に配布したいため、毎回 `link` してから `add -t c,x,a -H` を叩く必要があります。

#### 提案仕様
```bash
# リンクと同時にデフォルトターゲット（または指定ターゲット）へ即座にシンボリックリンク配布
acm skill link ./my-skill --distribute [-H]
acm skill link ./my-skill -t c,x,a -H
```
- **挙動**: カタログへの登録と同時に、各プロバイダのスキルディレクトリへの symlink 作成を一撃で完了させる。

---

### 提案 3: `acm doctor --fix` (Dangling Symlinks の自動修復) (優先度: 高)

#### 現状の課題
開発リポジトリ側でフォルダ名を変更したり Git ブランチを切り替えた際、`~/.acm/skills/` や `~/.claude/skills/` 等にリンク切れのシンボリックリンク（Dangling Symlink）が残ることがあります。

#### 提案仕様
```bash
acm doctor           # リンク切れや不整合を一覧表示（警告）
acm doctor --fix     # リンク切れの symlink を安全に削除・修復
```
- **チェック対象**:
  - `~/.acm/skills/*` のリンク先が存在するか。
  - 各プロバイダ（Claude, Codex, Antigravity, Grok）のスキル symlink が `~/.acm` を正しく指しているか。
  - カタログ登録されているが実体が存在しない孤立エントリの検出とクリーンアップ。

---

### 提案 4: `acm skill validate <path>` / Frontmatter Lint 機能 (優先度: 中)

#### 現状の課題
`SKILL.md` の YAML frontmatter（`name`, `description`）の構文ミスや、プロバイダごとの制限（改行、文字数、特殊文字）があっても、`acm skill link` 時にはノーチェックで素通りしてしまい、後からエージェントがスキルを読み込めない原因になります。

#### 提案仕様
```bash
acm skill validate <path>
acm skill link ./my-skill --validate   # 登録前に自動チェック
```
- **検証項目**:
  - `name`: 英数字・ハイフンのみ、ディレクトリ名との整合性。
  - `description`: 存在チェック、空文字でないか、文字数（推奨: 50〜300文字）、クォートの整合性。
  - 必須ファイルの存在確認（`SKILL.md`）。

---

### 提案 5: 機械可読 JSON 出力 (`--json`) の完全サポート (優先度: 中)

#### 現状の課題
エージェントが `acm skill list` や `acm skill status` を叩いた際、ASCII テーブル枠線（`┌──┬──┐`）が出力されるため、エージェント側でパースする処理が複雑になり、トークンも浪費されます。

#### 提案仕様
全コマンドで `--json` フラグをサポートし、構造化された JSON を標準出力する：
```bash
acm skill list -g --json
acm skill status --json
acm skill show <name> --json
acm doctor --json
```

---

## 3. 実装ロードマップ案

| フェーズ | 対象機能 | 期待効果 |
| :--- | :--- | :--- |
| **Phase 1 (Quick Win)** | ・`acm skill link --distribute`<br>・`acm doctor --fix` | 日常の開発フローにおける手数半減、壊れたリンクの自律復旧 |
| **Phase 2 (Lifecycle)** | ・`acm skill rename`<br>・`acm skill validate` | スキル名変更や品質チェックの自動化・堅牢化 |
| **Phase 3 (Agent-Friendly)** | ・全主要コマンドの `--json` 完全対応 | AI エージェントからのプログラマブルな呼び出し最適化 |

---

## 4. 担当エージェントへの引き継ぎメモ

- **リポジトリ**: `/Users/username/Code/Projects/agent-config-manager`
- **技術スタック**: TypeScript (Node.js >= 20, ES Modules, `tsc`)
- **テスト方針**: `just check` / `just test`（Node.js built-in test runner + tsx）
- **主要な変更箇所（見込み）**:
  - CLI 定義: `src/cli.ts` (Commander.js / 引数パース)
  - スキル管理ロジック: `src/skills.ts` / `src/catalog.ts`
  - 診断・修復ロジック: `src/doctor.ts`
