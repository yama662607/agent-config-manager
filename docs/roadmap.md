# ACM ロードマップ（2026-08 時点）

複数プロバイダ（Claude Code / Codex / Antigravity / Grok）に対して Skill・MCP・プラグインを
統一管理するという ACM の役割を強化するための、5 つの作業項目とその決定事項を記録する。
実装はこのドキュメントを起点に、項目ごとに PR を分けて進める。

## 進捗（2026-08-01 時点）

| # | 項目 | 状態 |
| --- | --- | --- |
| 1 | Skill 配布の symlink 化 | 完了（PR #13） |
| 2 | Skill のバージョン管理基盤 | 完了（PR #13） |
| 3 | ACM + kanade 運用スキル | 完了（カタログに `acm-config-management` を作成し4プロバイダへ配布） |
| 4 | Grok をプロバイダとして追加 | 完了（MCP: PR #12 / Skill: PR #14） |
| 5 | 隠しパス探索手順のドキュメント | 完了（PR #15 → `docs/finding-bundled-assets.md`） |

## 前提：現在のアーキテクチャ

- 実体（カタログ）は `~/.kanade/catalogs/` にあり、`~/.acm/` から symlink されている。
  これは kanade リポジトリ（`git@github.com:yama662607/kanade.git`）の **`catalog` ブランチ**で管理されている。
  - `~/.acm/skills` → `~/.kanade/catalogs/skills`
  - `~/.acm/skills-metadata.toml`、`mcps-metadata.toml`、`plugins`、`plugins-metadata.toml` も同様
  - `catalog.toml` のみ `~/.acm/` の実ファイル
- `~/.kanade/catalogs` は Git リポジトリなので、カタログ内の変更履歴は Git で追跡されている。
- ACM は「カタログの実体を各プロバイダのネイティブ設定パスへ配布する」ツールとして動作する。

---

## 1. Skill 配布を symlink 方式にする

### 現状

- 配布は全ファイルの再帰コピー（`src/skill-adapters.ts` の `copySkillDirToConfig` → `fs.cp`）。
- 同じ Skill をプロバイダ数 × プロジェクト数だけ複製するため、ストレージを圧迫する。
- コピー後にカタログ側を更新しても配布先へ伝播せず、**ズレが発生しても検知できない**。
- 読み取り側（`getSkills`）は既に symlink を追従する実装になっているので、書き込み側の対応だけで足りる。

### 決定

- **ホーム配下（`~/.claude/skills` などの個人環境）は symlink をデフォルトにする。**
- **プロジェクト配下はコピーをデフォルトにする。** 絶対パスの symlink がリポジトリにコミットされると、
  他メンバーの環境や CI で dead link になるため。
- どちらも CLI オプションで明示的に切り替えられるようにする（`--link` / `--copy`）。

### 実装メモ

- `copySkillDirToConfig` を配置戦略（link / copy）を受け取る形に一般化する。
- **既存のコピー済み Skill の移行に専用コマンドは作らない。** アンインストールして入れ直す運用とする。
- アンインストール時、symlink だけを削除しカタログ実体に触れないことをテストで保証する。

---

## 2. Skill のバージョン管理基盤

Skill は継続的に更新・整理・追加していくため、その土台を先に整える。

### 現状

- `~/.acm/skills-metadata.toml` の `version` フィールドのみ。frontmatter からの読み取りか手動入力。
- 内容ハッシュ、更新検知、差分表示、更新履歴の仕組みはいずれも無い。
- 実質的なバージョン管理はカタログの Git 履歴に依存している。

### やること

- カタログ側の Skill に内容ダイジェスト（ディレクトリ全体のハッシュ）を持たせる。
- 配布先の状態を「symlink（常に最新）／コピーが最新／コピーが古い／配布先で改変あり」に分類して表示する。
- `acm skill status` 相当で、カタログと各配布先のズレを一覧できるようにする。
- 更新操作（カタログ更新 → 配布先へ反映）を明示的なコマンドとして提供する。
- symlink 方式ではズレ自体が構造的に発生しないため、この検知はコピー方式の配布先が主対象になる。

---

## 3. ACM + kanade 運用スキルの作成

### 目的

エージェント自身が ACM を正しく使えるようにするための Skill。ACM の使い方に加えて、
kanade（`~/.cargo/bin/kanade`）を併用した**動作確認のワークフロー**を含める。

### kanade を使う理由

kanade を使うと、エージェントから別ディレクトリで安全にサブエージェントを起動できる。
新しい Skill / MCP / プラグインを探してきて追加したとき、公式手順どおりでも動かないことがあるため、
起動したエージェントと会話して**実際に動作するかを検証する**。これが主な用途。

### 決定

- 実体は **カタログ（`~/.kanade/catalogs/skills`）に作成**する。ACM 自身でドッグフーディングし、
  カタログ側の Git 履歴にも残す。
- 最終的に ACM 経由で各プロバイダのホーム配下へ配置し、すべてのエージェントから使えるようにする。

### スキルに含める内容

- ACM の基本操作（`mcp` / `skill` / `catalog` / `plugin` / `scan` / `doctor`）
- カタログを実体とし、各プロバイダへ配布するという設計思想
- symlink 配布とコピー配布の使い分け（項目 1 の決定）
- 新規 Skill / MCP / プラグインを追加するときの手順
- kanade でサブエージェントを起動し、対話で動作確認する検証フロー
- 検証に失敗したときの切り分け（設定パスの誤り、依存の欠落、プロバイダ固有の制約）

---

## 4. Grok をプロバイダとして追加

### 現状

- 未対応。`src/types.ts` の `TargetName` は `'claude' | 'codex' | 'antigravity'` のみ。
- ローカルには grok CLI 0.2.117 が導入済み。

### 調査結果（出典: `~/.grok/docs/user-guide/`。grok CLI に同梱の公式ドキュメント）

#### MCP

`~/.grok/config.toml` の `[mcp_servers.<name>]` セクションで定義する。TOML なので Codex に近い扱いになる。

```toml
[mcp_servers.my-server]
command = "/path/to/server"
args = ["--flag", "value"]
env = { API_KEY = "sk-..." }
enabled = true                 # enable/disable がネイティブに存在（既定 true）
startup_timeout_sec = 30
tool_timeout_sec = 6000
tool_timeouts = { slow_op = 120 }
```

- HTTP/SSE の場合は `url` と `headers`（`{ "Authorization" = "Bearer token" }`）。
- プロジェクトスコープは `<repo>/.grok/config.toml`。cwd → git root の連鎖で最も深いファイルが勝つ。
  **ただしそのフォルダが trusted になって初めて有効**（`~/.grok/trusted_folders.toml`）。
- 設定の優先順位: `requirements.toml` > 環境変数 > リポジトリ `.grok/config.toml` > user/managed config > 既定値。

#### Skill

探索先の優先度順（高い方が勝つ。同名は重複排除される）:

| パス | スコープ |
| --- | --- |
| `./.grok/skills/`, `./.grok/commands/` | Local（CWD）: 最高 |
| `./.claude/skills/`, `./.claude/commands/` | Local / Repo: 高 |
| `<repo_root>/.grok/skills/` | Repo: 中 |
| `~/.grok/skills/`, `~/.grok/commands/` | User: 低 |
| `~/.claude/skills/`, `~/.claude/commands/` | User: 低（Claude Code 互換） |
| `~/.cursor/skills/`, `./.cursor/skills/` | Cursor 互換 |

- 各階層で `.agents/skills/`（および `commands/`）もスキャンされる。
- `[skills] paths` で追加ディレクトリ、`ignore` で除外、`disabled` で個別無効化ができる。
- 探索に `.gitignore` は影響しない。

#### 設計上の注意

**Grok は既定で `~/.claude/skills/` と `./.claude/skills/` も読む。**
そのため Grok を独立した Skill ターゲットとして単純に追加すると、Claude 向けに配布済みの Skill が
二重に見える（Grok 側は同名を重複排除するが、ACM の status 表示と実体の対応が分かりにくくなる）。
### 決定

- **Skill と MCP の両方**を対象にする。ただし扱いは非対称になる。
- **MCP**: `~/.grok/config.toml` の `[mcp_servers.*]` を編集する。TOML なので Codex に近い実装になる。
- **Skill**: `~/.grok/skills/` への配布は行わない。`[skills] paths` にカタログのパスを直接登録し、
  Grok にカタログを直接読ませる。二重配布を避けられ、実体を一箇所に保つという symlink 化の方針とも一致する。
  - 副作用として、Grok の Skill は「配布された一覧」ではなく「カタログそのもの」になる。
    `acm skill` の status 表示で Grok だけ意味が異なる点を UI 上で明示する必要がある。

---

## 5. デスクトップアプリの隠しパス探索手順のドキュメント化

### 背景

本当に有用な Skill / プラグイン / MCP は、ホームディレクトリの設定ファイルではなく、
デスクトップアプリの Application Support 配下などの分かりにくいパスに置かれていることが多い。
これらはアプリの更新と同時に更新されるため、**最も新しい実装が入っている**。
毎回探し当てて参照できるよう、探索手順を本プロジェクトのドキュメントとして残す。

### 現時点で見つかっている手がかり（macOS）

- `~/Library/Application Support/Claude/` 配下にデスクトップアプリの実体がある。
  - `local-agent-mode-sessions/skills-plugin/<uuid>/` — セッションごとの skills プラグイン
  - `claude-code/`、`claude-code-sessions/`、`claude-code-vm/`、`vm_bundles/`
- アプリ本体の同梱リソースは `/Applications/<App>.app/Contents/Resources/` 側にもある。

### ドキュメントに書くこと

- 探索コマンドの定型（`find` の maxdepth 指定、`skills` / `plugins` / `*.skill` 等の名前パターン）
- プロバイダごとの既知パス一覧と、それが何のディレクトリか
- アプリ更新で場所が変わったときの再探索手順
- 見つけたものを ACM カタログへ取り込むときの注意（そのままコピーせず、ライセンスと機密情報を確認する）
- **読み取り専用で扱う。** アプリ管理下のパスを ACM が書き換えることはしない。

---

## 進め方

OpenSpec は使わない。項目ごとに作業ブランチを切り、PR を経由してマージする（`CLAUDE.md` 参照）。

実際の実施順序と PR:

1. 本ドキュメント（PR #11）
2. Grok の MCP 対応（PR #12）
3. symlink 配布 + 配置ズレ検知（PR #13、#12 の上に積層）
4. Grok の Skill 対応（PR #14、#13 の上に積層）
5. 隠しパス探索手順のドキュメント（PR #15、main から独立）
6. ACM + kanade 運用スキル（カタログ側に作成。このリポジトリの PR には含まれない）

PR #12 → #13 → #14 は積層しているため、#12 から順にマージする。
