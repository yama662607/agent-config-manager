# ACM (Agent Config Manager) 技術スタック一新 & 次世代 TUI 刷新計画書

## 1. エグゼクティブサマリー

`acm` は、複数 AI エージェント（Claude Code / Codex / Antigravity / Grok）の MCP サーバーおよびスキルの設定・配布を直接管理するツールです。
現在、コアのファイル編集・配布ロジックは正常に機能しているものの、**TUI (Terminal User Interface) の体験品質・操作性・パフォーマンスが極めて低い** という重大な課題を抱えています。

本計画書では、現在の擬似 TUI（`enquirer` + `console.clear()`）の限界を根本から解決するため、モダン TUI エコシステム（Rust / Go / TypeScript）のベストプラクティスを調査・比較し、最適な技術スタックへの全面刷新アーキテクチャと移行計画を策定します。

---

## 2. 現行 TUI の根本原因分析 (Root Cause Analysis)

### 2.1 現行アーキテクチャの課題
現在の `src/tui/` は、**フルスクリーン端末アプリケーション（Alternate Screen Buffer / Event Loop）ではなく、対話型プロンプト（Enquirer）を `while` ループで回しているだけ** の擬似実装になっています。

```
[acm tui loop]
   ↓
[console.clear] ── 画面全消去（ちらつきの原因）
   ↓
[Enquirer Select] ── リスト表示
   ↓ (検索・フィルタしたい場合)
[プロンプト終了] ── 一旦 Select を抜ける
   ↓
[Enquirer Input] ── 文字入力
   ↓ (再度ループ先頭へ戻って全消去＆再描画)
[acm tui loop]
```

### 2.2 発生している具体的なペイン
1. **画面の激しいちらつき（Flicker）**: 画面遷移や選択のたびに `console.clear()` が走る。
2. **リアルタイム・インクリメンタル検索の欠如**: 文字を打ちながらリアルタイムにリストが絞り込まれず、別モーダルで文字を入力させてから再描画している。
3. **2ペイン（リスト＋詳細プレビュー）が作れない**: 左側でスキルや MCP を選択しながら、右側で `SKILL.md` や設定内容をリアルタイム閲覧・シンタックスハイライト表示できない。
4. **キーバインド・操作感の悪さ**: Vim ライクな操作（`j`/`k`/`h`/`l`/`/`）、タブ切り替え（`Tab`/`1`/`2`/`3`）、ワンキー操作（`Space`でトグル、`d`で削除、`r`でリネーム）が実装できない。
5. **ターミナルリサイズ時の描画崩れ**: SIGWINCH（ウィンドウリサイズイベント）への即時再レイアウト追従が困難。

---

## 3. 技術スタック・TUI エコシステム比較調査

CLI / TUI アプリケーションにおける 3 大主要スタックを比較検証しました。

| 評価軸 | 案 A: Rust (`ratatui` + `crossterm`) | 案 B: Go (`bubbletea` + `lipgloss`) | 案 C: TypeScript (`ink` / React CLI) |
| :--- | :--- | :--- | :--- |
| **代表的な実績ツール** | `lazygit`, `bottom`, `gitui`, `yazi`, `zellij` | `glow`, `gum`, `gh-dash`, `soft-serve` | `gemini-cli`, `prisma init`, `cloudflare wrangler` |
| **TUI 表現力・完成度** | ★★★★★ (業界最高峰、2ペイン/タブ/高速描画) | ★★★★☆ (Elmアーキテクチャで非常に綺麗) | ★★★☆☆ (対話型CLI向け、フル2ペインTUIは癖あり) |
| **パフォーマンス・起動速度** | **0.001〜0.005 秒**（即時起動、ゼロオーバーヘッド） | 0.01〜0.03 秒（高速） | 0.2〜0.5 秒（Node.jsランタイム起動オーバーヘッド） |
| **配布性 (Distribution)** | **単一バイナリ** (`brew`, `cargo`, GitHub binary) | **単一バイナリ** (`brew`, `go install`, GitHub binary) | `npm install -g` (ユーザー環境に Node.js 必要) |
| **状態管理モデル** | Component / TEA / Event Loop | TEA (Model-Update-View) | React Hooks / Component State |
| **設定パースの堅牢性** | `toml`, `serde_json`, `serde_yaml` で型安全保証 | `pelletier/go-toml`, `gopkg.in/yaml.v3` | `smol-toml`, `yaml` |
| **移行コスト** | 中（ロジックをRustへ移植） | 中（ロジックをGoへ移植） | 低〜中（既存TS資産を一部流用可能） |

---

## 4. 推奨スタック決定: **Plan A (Rust + Ratatui)**

### なぜ Rust + Ratatui なのか？
1. **圧倒的な TUI 体験**:
   `lazygit` や `yazi` のような、**一切の遅延・ちらつきのないミリ秒応答、リッチな2ペイン/3ペイン分割、シンタックスハイライト、ファジーファインダー** を実現できる唯一無二のデファクトスタンダード。
2. **AI エージェント / 開発者双方への最高の親和性**:
   - 人間が使うとき: 直感的で美しい TUI ダッシュボード
   - エージェントが使うとき: `acm --json` や各サブコマンドがミリ秒で完了する超軽量単一バイナリ（Node.js の起動コストなし）
3. **安全なファイル・設定操作**:
   Rust の強固な型システムと `serde`（シリアライズ/デシリアライズ）により、JSON / TOML / YAML の読み書き不整合や symlink 破損をコンパイル時に防止。

---

## 5. 新アーキテクチャ & TUI 設計仕様

### 5.1 TUI 画面レイアウト設計 (2ペイン + ヘッダー/フッター)

```text
┌─ acm (Agent Config Manager) ─────────────────────────────────── [Tab: Switch Mode] [?: Help] ┐
│  [1] Skills (Catalog & Installed)   [2] MCP Servers   [3] Doctor & Health   [4] Plugins       │
├──────────────────────────────────────┬────────────────────────────────────────────────────────┤
│ 🔍 Filter: recall                    │ 📄 Preview: ai-agent-archive-recall                    │
├──────────────────────────────────────┼────────────────────────────────────────────────────────┤
│ > ● ai-agent-archive-recall [linked] │ Description:                                           │
│   ○ frontend-design         [copy]   │   Autonomous session recall for AI coding agents.      │
│   ● zotero-integration      [linked] │                                                        │
│                                      │ Location:                                              │
│                                      │   ~/.acm/skills/ai-agent-archive-recall                │
│                                      │ Symlink Targets:                                       │
│                                      │   [✓] Claude Code: ~/.claude/skills/...                │
│                                      │   [✓] Codex: ~/.codex/skills/...                       │
│                                      │   [✓] Antigravity: ~/.agents/skills/...                │
│                                      │   [✓] Grok: registered in config.toml                  │
│                                      │                                                        │
│                                      │ Frontmatter Validation:                                │
│                                      │   ✓ Valid YAML Frontmatter                             │
│                                      │   ✓ Name matches directory                             │
├──────────────────────────────────────┴────────────────────────────────────────────────────────┤
│ [Space] Toggle Target  [a] Add/Distribute  [r] Rename  [d] Delete  [/] Search  [q] Quit       │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 キーバインド体系
* **ナビゲーション**: `j` / `k` (上下移動), `h` / `l` (ペイン間移動 / 折りたたみ), `Tab` (タブ切り替え)
* **クイックアクション**:
  - `/`: インクリメンタル・ファジー検索（タイプ即時絞り込み）
  - `Space`: 選択アイテムの有効/無効トグル、またはターゲット個別選択
  - `a`: 新規リンク/インストール（モーダル入力）
  - `r`: インプレース・リネーム（全プロバイダ symlink 自動同期）
  - `d` / `x`: 削除 / アンリンク確認
  - `f`: `acm doctor --fix` 即時実行（壊れた symlink 修復）
* **終了/ヘルプ**: `q` (終了), `?` (キーバインドヘルプ表示)

---

## 6. 技術スタック刷新ロードマップ

### フェーズ詳細

#### Phase 1: 高速コアエンジンの実装 (Rust)
- クレート選定:
  - `clap` (derive): 堅牢な CLI 引数パース、`--json` フラグ
  - `serde`, `toml`, `serde_json`, `serde_yaml`: 完全な型安全性
  - `tokio`: 非同期 I/O、GitHub API 連携
  - `walkdir`, `symlink`: クロスプラットフォームなファイル・symlink 制御
- 実装項目:
  - 提案1 (Rename), 提案2 (Link --distribute), 提案3 (Doctor --fix), 提案4 (Frontmatter Validate), 提案5 (JSON) をコアレベルでビルトイン実装。

#### Phase 2: Ratatui によるリッチ TUI の実装
- クレート選定:
  - `ratatui` (UI描画・ウィジェット・レイアウト)
  - `crossterm` (ターミナルバックエンド、キー・マウス・リサイズイベント)
  - `syntect` (SKILL.md / 設定ファイルのシンタックスハイライト)
  - `nucleo` / `fuzzy-matcher` (高速ファジー検索)
- 実装項目:
  - 2ペイン UI（左: スキル/MCP 一覧、右: 詳細・プレビュー・整合性チェック結果）
  - タブによるモード切り替え（Skills / MCPs / Plugins / Doctor）
  - リアルタイム検索 & キーバインドによる直感操作

#### Phase 3: 配布・互換性維持
- 既存の `acm` コマンドライン引数・設定ファイル構造との **完全な下位互換性** を維持。
- 配布方式:
  - Homebrew: `brew install yama662607/tap/acm`
  - Cargo: `cargo install agent-config-manager`
  - npm: `@yama662607/agent-config-manager`（プラットフォーム別プレビルドバイナリのラッパー）

---

## 7. トレードオフと代替案の検討

* **もし TypeScript のまま進める場合（代替案）**:
  - `ink` (React for CLI) + `ink-text-input` + `ink-select-input` の組み合わせに全面書き換え。
  - メリット: 言語を変更せず TS 資産を直接再利用できる。
  - デメリット: 2ペインのフルスクリーンターミナル制御（alternate buffer、リサイズ追従、ちらつき防止）において React の再レンダリング制御が難しく、Rust/Go ほどの爆速・堅牢な操作感には届かない。
* **判定**:
  - TUI の操作性と品質を根本的に解決し、長期的に開発者・エージェント双方に愛されるプロダクトにするためには **Rust + Ratatui への刷新が最も費用対効果が高い** と結論付けます。
