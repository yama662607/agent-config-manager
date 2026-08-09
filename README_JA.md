# agent-config-manager

[![npm version](https://img.shields.io/npm/v/@yama662607/agent-config-manager)](https://www.npmjs.com/package/@yama662607/agent-config-manager)
[![npm downloads](https://img.shields.io/npm/dm/@yama662607/agent-config-manager)](https://www.npmjs.com/package/@yama662607/agent-config-manager)
[![license](https://img.shields.io/npm/l/@yama662607/agent-config-manager)](LICENSE)
[![Node.js Version](https://img.shields.io/node/v/@yama662607/agent-config-manager)](https://github.com/yama662607/agent-config-manager)

[English version is here](README.md)

`acm`は、MCPサーバーとスキルのためのクロスエージェント設定管理ツールです。マニフェストベースのツールとは異なり、`acm`はプロジェクト内のネイティブ設定ファイルを直接編集します—中間マニフェストは不要、「同期」ステップも不要です。

## デザイン原則

> **`acm`は設定マネージャーであり、レンダラーではありません。**

- **ネイティブ設定ファイルが唯一の情報源** — `.mcp.json`、`.codex/config.toml` など
- **プロジェクト側の`acm`ファイルは不要** — すべてのツール状態は `~/.acm/` に保存
- **直接編集** — コマンドがネイティブ設定を原子的に変更
- **どのディレクトリからでも動作** — Gitルートまたはネイティブ設定ファイルによるプロジェクト検出

## クイックスタート

```bash
# インストール
npm install -g @yama662607/agent-config-manager

# プロジェクトにMCPサーバーを追加
acm mcp add @modelcontextprotocol/server-github --targets claude

# GitHubからスキルを追加
acm skill install https://github.com/anthropics/skills/tree/main/skill-creator

# 設定内容を確認
acm mcp
acm skill

# カタログエントリを一覧表示
acm mcp list -g
acm skill list -g
```

## コマンド

### `acm mcp`

現在のプロジェクトのMCPサーバーを管理します。

```bash
# ステータス表示（デフォルト）- 対話的TUI
acm mcp

# サーバーを追加
acm mcp add @modelcontextprotocol/server-github --targets claude,codex

# サーバーを削除
acm mcp remove @modelcontextprotocol/server-github

# 特定のターゲットで有効化/無効化
acm mcp disable github --targets claude
acm mcp enable github --targets codex
```

### `acm skill`

現在のプロジェクトのスキルを管理します。

```bash
# ステータス表示（デフォルト）- 対話的TUI
acm skill

# カタログからスキルを追加
acm skill add skill-creator --targets claude,codex

# GitHubからスキルをインストール
acm skill install https://github.com/anthropics/skills/tree/main/frontend-design

# スキルを削除
acm skill remove frontend-design
```

### カタログの操作

ローカルカタログ（`~/.acm/`）で再利用可能なMCP定義を管理します。

```bash
# すべてのカタログエントリを一覧表示
acm mcp list -g

# 詳細を表示
acm mcp show -g @modelcontextprotocol/server-github

# カタログに追加
acm mcp add -g @modelcontextprotocol/server-github

# カタログから削除
acm mcp remove -g @modelcontextprotocol/server-github
```

### `acm catalog skill`

ローカルカタログで再利用可能なスキル定義を管理します。

```bash
# すべてのカタログエントリを一覧表示
acm skill list -g

# 詳細を表示
acm skill show -g skill-creator

# ファイルからカタログに追加
acm catalog skill add my-skill --file ./skills/my-skill/SKILL.md

# ローカルディレクトリからインポート
acm skill import -g ~/.claude/skills/frontend-design

# GitHubからインストール
acm skill install https://github.com/anthropics/skills --name frontend-design

# skills.directoryレジストリを検索
acm skill list -g --search typescript

# カタログから削除
acm skill remove -g skill-creator
```

### `acm validate`

変更を加えずにプロジェクト設定を検証します。

```bash
acm validate          # 警告は許容
acm validate --strict # 警告で失敗
```

### `acm plugin`

プラグインは skills・commands・agents・hooks・MCP サーバーをまとめた単位です。

```bash
# デスクトップアプリに同梱されたプラグインを探す
acm plugin discover
acm plugin discover --import

# 任意のディレクトリからカタログへ取り込む
acm plugin import ./some-plugin
acm plugin import ./some-plugin --as other-name

acm plugin list
acm plugin update    # 参照元が変わったものだけ取り直す
acm plugin repair    # 古い取り込みが落としたファイルを復元する
```

`import` はマニフェストの置き場所を問いません（`.claude-plugin/plugin.json`、
`.codex-plugin/plugin.json`、`.grok-plugin/plugin.json`、ルートの `plugin.json`）。
マニフェストを持たず `skills/` だけのディレクトリも受け付けます。一部のアプリは
その形で同梱しているためです。

#### 全プロバイダーで使えるようにする

変換は不要です。4 プロバイダーはプラグインの中身については一致しており、
マニフェストの置き場所だけが異なります。4 箇所すべてに書いたディレクトリは、
どのプロバイダーも自分のものとして読みます。適応は各プロバイダーが自前で行います
（Antigravity は `commands/` を skills へ自動変換し、Claude は知らないフィールドを
無視します）。

インストールだけは別です。有効化されたプラグインはプロバイダーが記録する状態なので、
そこは各 CLI に委譲します。`acm plugin convert` はカタログをローカルマーケットプレイス
として公開し、各プロバイダーに渡します。

```bash
acm plugin convert --all -t claude,codex,antigravity,grok
```

出力の最後に「Carried but unused」が出ます。**そのプロバイダーが読まないフィールドを、
落とさずに運びつつ名指しする**のがこのコマンドの要点です。生成されたマーケットプレイス
は派生物なので、いつでも作り直せます。バージョン管理には入れないでください。

根拠は [docs/provider-config-surfaces.md](docs/provider-config-surfaces.md) にあります。
唯一の実質的な差異（Antigravity はプラグインの MCP サーバーを `.mcp.json` ではなく
`mcp_config.json` から読む）もそこに記録しています。

### `acm doctor`

診断とヘルスチェックを実行します。

```bash
acm doctor      # チェックのみ
acm doctor --fix # 自動修正を試みる
```

## 複数のマシンで同じカタログを使う

カタログはディレクトリなので、同期は git リポジトリで足ります。2 台目では次の 3 つだけです。

```bash
git clone <カタログのリポジトリ> ~/Code/Tools/agent-catalog
npm install -g @yama662607/agent-config-manager
acm init --catalog ~/Code/Tools/agent-catalog
```

以後は `git pull` / `git push` で揃います。同期デーモンもロックファイルもありません。

これは**公開とは別の話**です。自分の端末間で共有するカタログは private のままで全てを含み、
公開するのは許可リストで選んだ部分集合です。

### 移動できないもの

大半は移動できます。スキルのファイルも、`npx -y <package>` を実行するレシピもそのまま動きます。
移動できないのは、開発リポジトリへ symlink されたスキルと、バイナリ・チェックアウト・vault を
絶対パスで指すレシピです。これらは意図的なものなので、acm は否定せず**列挙**します。

```
[Portability]
  ✓ 14 references to this machine, all present
    They will need attention if you clone this catalog elsewhere.
```

書いた側のマシンでは、clone する**前に**何が引っかかるか分かります。2 台目では同じ一覧が
そのまま作業リストになります。

```
[Portability]
  ✗ zotero: command -> ~/.local/bin/zotero-mcp
  ✗ obsidian-companion-mcp: environment OBSIDIAN_VAULT_PATH -> ~/Library/…/Main
  4 of 14 not found on this machine.
```

スキルはそのマシンの作業コピーへ張り直し、レシピは `acm mcp add --command …` か
カタログ項目の編集で指し直します。判定はローカルの stat のみなので実行コストはありません。

## サポート対象ターゲット

4 つのエージェントに対応しています。スコープごとに保存先が異なります。

| ターゲット | 別名 | ホームスコープの MCP | ホームスコープのスキル |
|-----------|------|---------------------|----------------------|
| Claude Code | `c` | `~/.claude.json` の `mcpServers` | `~/.claude/skills/` |
| Codex | `x` | `~/.codex/config.toml` | `~/.codex/skills/` |
| Antigravity | `agy` `a` `g` | `~/.gemini/config/mcp_config.json` | `~/.gemini/config/skills/` |
| Grok | `k` | `~/.grok/config.toml` | カタログのパスを登録 |

プロジェクトスコープを読むのは Claude・Codex・Grok の 3 つです。Antigravity の CLI は
プロジェクト設定を読まないため、書き込む際に警告します。

各プロバイダの保存先、検証方法、更新時の再確認手順は
[docs/provider-config-surfaces.md](docs/provider-config-surfaces.md) に記載しています。

## スキルの配置: symlink とコピー

カタログのスキルを配布する方法は 2 つあります。

| 配布先 | 既定 | 理由 |
|--------|------|------|
| ホーム（`-H`） | symlink | 個人環境。実体が 1 つなのでズレようがない |
| プロジェクト | コピー | リポジトリは共有される。絶対パスの symlink は他環境で壊れる |

`--link` / `--copy` で明示的に切り替えられます。`acm skill` の Placement 列が状態を示します。

| 表示 | 意味 |
|------|------|
| `link` | symlink。常に最新 |
| `copy` | コピーで内容一致 |
| `stale` | コピーがカタログと異なる（`acm skill update` で入れ直す） |
| `broken` | symlink 先が消えている |
| `catalog` | Grok が登録経由で読んでいる |

## 開発リポジトリと繋ぐ

スキルはコピーせず symlink で登録できます。開発中の編集が全プロバイダへ即座に届きます。

```bash
acm skill link ~/src/my-skill
acm skill unlink my-skill
```

MCP はプロセスなので symlink では繋がりません。代わりにレシピを作業コピーに向けます。

```bash
acm mcp add my-server --local ~/src/my-server -t codex
acm mcp add my-server --from-package @scope/my-server -t codex
```

## 出所の記録と更新の検知

ダウンロードしたスキルは上流が更新されます。`acm` は出所を記録して追跡します。

```bash
acm skill install <github-url>          # URL と解決済みコミットを自動記録
acm skill meta <id> --source <url> --ref <sha>
acm skill meta <id> --forked            # 意図的な改変は追従対象外にする
acm skill outdated                      # 上流と照合
```

デスクトップアプリに同梱されたプラグインも扱えます。パスは固定せず、マニフェストや
`skills/` を持つかどうかで判定し、アプリのバージョンとともに記録します。

```bash
acm plugin discover            # アプリ内のプラグインを探す
acm plugin discover --import   # カタログへ取り込む
```

## 診断

```bash
acm doctor -H              # カタログ位置、コマンドの実在、ずれを確認
acm doctor -H --offline    # 通信を伴う確認を省略
```

`[Catalog Drift]` は 2 つの問いを分けて表示します。**参照元が進んだ**（取り込み直す）と
**カタログが進んだ**（コミットする）は対処が違うためです。

## カタログの手動編集と高度な機能

カタログの実体はディレクトリです。スキルは `skills/<id>/` に置くだけで認識され、
索引は読み込みのたびにディレクトリと frontmatter から再構築されます。
`catalog.toml` が保持するのは MCP レシピだけです（ディレクトリから導出できないため）。

### 1. Claude/Codex設定のコピペインポート（MCP Server自動正規化）
既存のClaude CodeやCodexの設定ファイルから、以下のような生の `mcpServers`（または `mcp_servers`）ブロックをコピーして、そのまま `~/.acm/catalog.toml` のルートレベルに貼り付けることができます。

```toml
# ~/.acm/catalog.toml に直接貼り付け可能！
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
- 次回 `acm` コマンドが実行されるか、設定がロードされたタイミングで、貼り付けられた生の設定が自動的に検出されます。
- 検出された設定は `acm` 標準のカタログエントリ（`catalog.mcps`）に自動的に変換・正規化されます。
- 正規化の際、**すでに登録済みのエントリのメタデータ（`displayName`、`tags`、`description`など）が破壊的に上書きされることはありません。** 既存のメタデータは維持され、実行レシピのみが安全にアップデートされます。
- 正規化・移行が完了すると、貼り付けられた生の `mcpServers` ブロックは `catalog.toml` から自動的にきれいに削除（クリーンアップ）されます。

### 2. ドラッグ＆ドロップによるスキルの自動検出（Symbolic Link対応）
`~/.acm/skills/` ディレクトリの中に、`SKILL.md` を含むフォルダを配置するだけで、自動的にカタログに登録・同期されます。

- **フォルダのドラッグ＆ドロップ:** インターネットや他のプロジェクトからダウンロードしたスキルのフォルダ（例：`frontend-design`）を、そのまま `~/.acm/skills/` 以下に配置してください。
- **シンボリックリンク (Symlink) のサポート:** `ln -s /path/to/my-skill ~/.acm/skills/my-skill` のようにシンボリックリンクを作成して配置することも可能です。`acm` はシンボリックリンクを自動的に解決し、ターゲットディレクトリ内の `SKILL.md` に基づいてメタデータ（名前、説明、ライセンス等）をカタログへ自動登録します。
- **自動クリーンアップ:** `~/.acm/skills/` 内のフォルダやシンボリックリンクを削除すると、次回起動時またはロード時に自動的にカタログ（`catalog.toml`）からそのスキルの登録が解除され、常に実際のファイルシステムの状態と同期されます。
- **堅牢なメタデータ抽出:** `SKILL.md` の YAML フロントマターは、堅牢な YAML パーサーによってパースされるため、不正なフォーマットや複数行にわたる説明文があっても安全に処理されます。

### 3. ファイルロック機能（並列処理への対応）
カタログの書き込み（ミューテーション）は、`~/.acm/catalog.lock` を用いたファイルロックメカニズムによって保護されています。これにより、複数のプロセスやエージェントが同時に書き込みを行った場合でも、競合やファイルの破損を防ぎ、原子的に書き込みが行われます。

## アーキテクチャ

```
~/.acm/                    # ユーザーレベルカタログ
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
- **ツールに依存しない** — `acm`を削除してもプロジェクトは動作
- **CIフレンドリー** — チェック用の`acm validate`、ドリフト検出不要
- **クロスエージェント** — Claude Code、Codex、Antigravity CLIでMCPとスキルを管理

## ライセンス

MIT © [Daisuke Yamashiki](https://github.com/yama662607)

## リンク

- [npmパッケージ](https://www.npmjs.com/package/@yama662607/agent-config-manager)
- [GitHubリポジトリ](https://github.com/yama662607/agent-config-manager)
- [_issues](https://github.com/yama662607/agent-config-manager/issues)
- [Model Context Protocol](https://modelcontextprotocol.io)

## コントリビューション

貢献をお待ちしています！お気軽にプルリクエストを送ってください。

## サポート

問題やご質問がある場合は、[GitHubでIssueを作成](https://github.com/yama662607/agent-config-manager/issues/new)してください。
