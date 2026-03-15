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
| Gemini CLI | `.gemini/settings.json` | ✓ | ✓ |

## アーキテクチャ

```
~/.acsync/                    # ユーザーレベルカタログ
├── catalog.json              # 再利用可能なMCPとスキル定義
├── catalog-schema.json       # スキーマバージョニング
└── catalog.lock              # 並列アクセス安全性

my-project/                   # あなたのプロジェクト
├── .git/
├── .mcp.json                 # Claude Code MCP設定（直接編集）
├── .claude/skills/           # Claude Codeスキル
│   └── <name>/SKILL.md
├── .codex/config.toml        # Codex設定（直接編集）
├── .codex/skills/            # Codexスキル
│   └── <name>/SKILL.md
└── .gemini/settings.json     # Gemini CLI設定（直接編集）
```

## 利点

- **プロジェクトに余分なファイルを追加しない** — git diffで実際の設定変更が確認できる
- **説明しやすい** — 「マニフェストから生成」ではなく「`.mcp.json`を編集」
- **ツールに依存しない** — `acsync`を削除してもプロジェクトは動作
- **CIフレンドリー** — チェック用の`acsync validate`、ドリフト検出不要
- **クロスエージェント** — Claude Code、Codex、Gemini CLIでMCPとスキルを管理

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
