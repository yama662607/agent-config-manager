# agent-config-sync

[![npm version](https://img.shields.io/npm/v/@yama662607/agent-config-sync)](https://www.npmjs.com/package/@yama662607/agent-config-sync)
[![npm downloads](https://img.shields.io/npm/dm/@yama662607/agent-config-sync)](https://www.npmjs.com/package/@yama662607/agent-config-sync)
[![license](https://img.shields.io/npm/l/@yama662607/agent-config-sync)](LICENSE)
[![Node.js Version](https://img.shields.io/node/v/@yama662607/agent-config-sync)](https://github.com/yama662607/agent-config-sync)

`acsync`は、MCPサーバーとスキルのためのクロスエージェント設定管理ツールです。マニフェストベースのツールとは異なり、`acsync`はプロジェクト内のネイティブ設定ファイルを直接編集します—中間マニフェストは不要、「同期」ステップも不要です。

## デザイン原則

> **`acsync`は設定マネージャーであり、レンダラーではありません。**

- **ネイティブ設定ファイルが唯一の情報源** — `.mcp.json`、`.codex/config.toml` など
- **プロジェクト側の`acsync`ファイルは不要** — すべてのツール状態は `~/.acsync/` に保存
- **直接編集** — コマンドがネイティブ設定を原子的に変更
- **どのディレクトリからでも動作** — Gitルートまたはネイティブ設定ファイルによるプロジェクト検出

## クイックスタート

```bash
# インストール
npm install -g @yama662607/agent-config-sync

# プロジェクトにMCPサーバーを追加
acsync mcp add @modelcontextprotocol/server-github --targets claude

# GitHubからスキルを追加
acsync skill install https://github.com/anthropics/skills/tree/main/skill-creator

# 設定内容を確認
acsync mcp
acsync skill

# カタログエントリを一覧表示
acsync catalog mcp list
acsync catalog skill list
```

## コマンド

### `acsync mcp`

現在のプロジェクトのMCPサーバーを管理します。

```bash
# ステータス表示（デフォルト）- 対話的TUI
acsync mcp

# サーバーを追加
acsync mcp add @modelcontextprotocol/server-github --targets claude,codex

# サーバーを削除
acsync mcp remove @modelcontextprotocol/server-github

# 特定のターゲットで有効化/無効化
acsync mcp disable github --targets claude
acsync mcp enable github --targets codex
```

### `acsync skill`

現在のプロジェクトのスキルを管理します。

```bash
# ステータス表示（デフォルト）- 対話的TUI
acsync skill

# カタログからスキルを追加
acsync skill add skill-creator --targets claude,codex

# GitHubからスキルをインストール
acsync skill install https://github.com/anthropics/skills/tree/main/frontend-design

# スキルを削除
acsync skill remove frontend-design
```

### `acsync catalog mcp`

ローカルカタログ（`~/.acsync/`）で再利用可能なMCP定義を管理します。

```bash
# すべてのカタログエントリを一覧表示
acsync catalog mcp list

# 詳細を表示
acsync catalog mcp show @modelcontextprotocol/server-github

# カタログに追加
acsync catalog mcp add @modelcontextprotocol/server-github

# カタログから削除
acsync catalog mcp remove @modelcontextprotocol/server-github
```

### `acsync catalog skill`

ローカルカタログで再利用可能なスキル定義を管理します。

```bash
# すべてのカタログエントリを一覧表示
acsync catalog skill list

# 詳細を表示
acsync catalog skill show skill-creator

# ファイルからカタログに追加
acsync catalog skill add my-skill --file ./skills/my-skill/SKILL.md

# ローカルディレクトリからインポート
acsync catalog skill import ~/.claude/skills/frontend-design

# GitHubからインストール
acsync skill install https://github.com/anthropics/skills --name frontend-design

# skills.directoryレジストリを検索
acsync catalog skill search typescript

# カタログから削除
acsync catalog skill remove skill-creator
```

### `acsync validate`

変更を加えずにプロジェクト設定を検証します。

```bash
acsync validate          # 警告は許容
acsync validate --strict # 警告で失敗
```

### `acsync doctor`

診断とヘルスチェックを実行します。

```bash
acsync doctor      # チェックのみ
acsync doctor --fix # 自動修正を試みる
```

## サポート対象ターゲット

| ターゲット | 設定ファイル | MCP | スキル |
|-----------|-------------|-----|--------|
| Claude Code | `.mcp.json` | ✓ | ✓ |
| Codex | `.codex/config.toml` | ✓ | ✓ |
| Antigravity CLI | `.gemini/antigravity/mcp_config.json` | ✓ | ✓ |

## カタログの手動編集と高度な機能

`acsync`のカタログデータベース（`~/.acsync/catalog.toml`）はTOMLフォーマットで保存されており、開発者がテキストエディタで直接開いて手動で編集やインポートを行いやすくなっています。

### 1. Claude/Codex設定のコピペインポート（MCP Server自動正規化）
既存のClaude CodeやCodexの設定ファイルから、以下のような生の `mcpServers`（または `mcp_servers`）ブロックをコピーして、そのまま `~/.acsync/catalog.toml` のルートレベルに貼り付けることができます。

```toml
# ~/.acsync/catalog.toml に直接貼り付け可能！
[mcpServers.sqlite]
command = "uvx"
args = [
  "mcp-server-sqlite",
  "--db-path",
  "/path/to/db.sqlite"
]

[mcpServers.sqlite.env]
SOME_ENV_VAR = "value"
```

**マージと自動正規化の仕組み:**
- 次回 `acsync` コマンドが実行されるか、設定がロードされたタイミングで、貼り付けられた生の設定が自動的に検出されます。
- 検出された設定は `acsync` 標準のカタログエントリ（`catalog.mcps`）に自動的に変換・正規化されます。
- 正規化の際、**すでに登録済みのエントリのメタデータ（`displayName`、`tags`、`description`など）が破壊的に上書きされることはありません。** 既存のメタデータは維持され、実行レシピのみが安全にアップデートされます。
- 正規化・移行が完了すると、貼り付けられた生の `mcpServers` ブロックは `catalog.toml` から自動的にきれいに削除（クリーンアップ）されます。

### 2. ドラッグ＆ドロップによるスキルの自動検出（Symbolic Link対応）
`~/.acsync/skills/` ディレクトリの中に、`SKILL.md` を含むフォルダを配置するだけで、自動的にカタログに登録・同期されます。

- **フォルダのドラッグ＆ドロップ:** インターネットや他のプロジェクトからダウンロードしたスキルのフォルダ（例：`frontend-design`）を、そのまま `~/.acsync/skills/` 以下に配置してください。
- **シンボリックリンク (Symlink) のサポート:** `ln -s /path/to/my-skill ~/.acsync/skills/my-skill` のようにシンボリックリンクを作成して配置することも可能です。`acsync` はシンボリックリンクを自動的に解決し、ターゲットディレクトリ内の `SKILL.md` に基づいてメタデータ（名前、説明、ライセンス等）をカタログへ自動登録します。
- **自動クリーンアップ:** `~/.acsync/skills/` 内のフォルダやシンボリックリンクを削除すると、次回起動時またはロード時に自動的にカタログ（`catalog.toml`）からそのスキルの登録が解除され、常に実際のファイルシステムの状態と同期されます。
- **堅牢なメタデータ抽出:** `SKILL.md` の YAML フロントマターは、堅牢な YAML パーサーによってパースされるため、不正なフォーマットや複数行にわたる説明文があっても安全に処理されます。

### 3. ファイルロック機能（並列処理への対応）
カタログの書き込み（ミューテーション）は、`~/.acsync/catalog.lock` を用いたファイルロックメカニズムによって保護されています。これにより、複数のプロセスやエージェントが同時に書き込みを行った場合でも、競合やファイルの破損を防ぎ、原子的に書き込みが行われます。

## アーキテクチャ

```
~/.acsync/                    # ユーザーレベルカタログ
├── catalog.toml              # 再利用可能なMCPとスキル定義 (TOML形式)
├── catalog-schema.json       # スキーマバージョニング
└── catalog.lock              # 並列アクセス安全性 (自動作成・削除)

my-project/                   # あなたのプロジェクト
├── .git/
├── .mcp.json                 # Claude Code MCP設定（直接編集）
├── .claude/skills/           # Claude Codeスキル
│   └── <name>/SKILL.md
├── .codex/config.toml        # Codex設定（直接編集）
├── .codex/skills/            # Codexスキル
│   └── <name>/SKILL.md
├── .gemini/antigravity/mcp_config.json  # Antigravity CLI設定（直接編集）
└── .agents/skills/           # Antigravity CLIスキル
    └── <name>/SKILL.md
```

## 利点

- **プロジェクトに余分なファイルを追加しない** — git diffで実際の設定変更が確認できる
- **説明しやすい** — 「マニフェストから生成」ではなく「`.mcp.json`を編集」
- **ツールに依存しない** — `acsync`を削除してもプロジェクトは動作
- **CIフレンドリー** — チェック用の`acsync validate`、ドリフト検出不要
- **クロスエージェント** — Claude Code、Codex、Antigravity CLIでMCPとスキルを管理

## ライセンス

MIT © [Daisuke Yamashiki](https://github.com/yama662607)

## リンク

- [npmパッケージ](https://www.npmjs.com/package/@yama662607/agent-config-sync)
- [GitHubリポジトリ](https://github.com/yama662607/agent-config-sync)
- [_issues](https://github.com/yama662607/agent-config-sync/issues)
- [Model Context Protocol](https://modelcontextprotocol.io)

## コントリビューション

貢献をお待ちしています！お気軽にプルリクエストを送ってください。

## サポート

問題やご質問がある場合は、[GitHubでIssueを作成](https://github.com/yama662607/agent-config-sync/issues/new)してください。
