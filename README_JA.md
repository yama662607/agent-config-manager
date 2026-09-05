# agent-config-manager

[English](README.md) · [Rust移行メモ](docs/rust-migration.md) · [差分確認・復元・検証の詳細](docs/native-workflows.md)

`acm` は Claude Code・Codex・Antigravity・Grok の MCP サーバー、スキル、プラグインを管理するツールです。CLIと対話型TUIは同じRust実装を使います。プロバイダーの設定ファイルを直接扱い、カタログには再利用する定義とディレクトリ一式を保存します。

## インストール

このチェックアウトのRust版を使う場合:

```sh
cargo install --path . --locked
acm --version
```

ネイティブ実行ファイルにはNode.jsは不要です。npmの起動スクリプトと開発用の配布スクリプトにはNode.js 20以上が必要です。MCPサーバー自身がNode・Python・uvなどを必要とする場合は別途用意してください。

リリースCIはmacOS・Linux・Windowsのx64/arm64バイナリ、チェックサム、npmパッケージを作成します。公開後は次のコマンドでインストールできます:

```sh
npm install -g @yama662607/agent-config-manager
```

Rustパッケージの公開まではnpmに旧版が残る場合があります。現時点のチェックアウトを使うには上のソースビルドを利用してください。配布パッケージでは `acm` と `agent-config-manager` の両方が同じRustバイナリを起動します。

## スコープと設定

| スコープ | オプション | 動作 |
| --- | --- | --- |
| プロジェクト | 省略時、`--project` | 現在地から最寄りのGit・ネイティブ設定ルートを探索。独立したディレクトリでも利用可能 |
| ホーム | `--home`、`-H`、`--allow-home` | ユーザー全体のプロバイダー設定を操作 |
| カタログ | `--catalog`、`-g`、`--global` | 再利用する定義を管理 |

ホームディレクトリから実行する場合は `--home` を明示します。ネイティブプラグイン操作の既定はホームです。プラグインのプロジェクトインストールに対応するのはClaudeです。

`--targets claude,codex`、`-t all` で対象を選択します。短縮名は `c`=Claude、`x`=Codex、`a`/`g`/`agy`=Antigravity、`k`=Grokです。`~/.acm/config.toml` で既定値を変更できます:

```toml
catalog_dir = "~/Code/my-agent-catalog"
default_targets = ["claude", "codex"]
# discovery_roots = ["~/Applications", "~/Library/Application Support/Claude"]

# PATHを変えずにネイティブCLIを明示する場合
# [provider_commands]
# codex = "/path/to/codex"
```

ネイティブCLIの優先順位は `ACM_CLAUDE_BIN` / `ACM_CODEX_BIN` / `ACM_ANTIGRAVITY_BIN` / `ACM_GROK_BIN` → `provider_commands` の該当項目 → PATH上の通常コマンド（Antigravityは `agy`）です。プラグイン操作とClaudeのホームMCP委譲に適用し、MCP定義自身の起動コマンドには影響しません。

カタログの優先順位は `ACM_CATALOG_DIR` → `catalog_dir` → `~/.acm` です。対象の設定がなければ4プロバイダーを選択します。壊れた設定はエラーとして報告します。

## MCPサーバー

```sh
acm mcp list
acm mcp add example --command echo --arg hello --targets codex
acm mcp add remote --url https://example.com/mcp --targets claude --home
acm mcp add local --local ./my-mcp --targets codex
acm mcp add tool --from-package @example/mcp-server --targets claude
acm mcp edit example --args '["updated"]' --env MODE=demo --targets codex
acm mcp disable example --targets codex
acm mcp enable example --targets codex
acm mcp show example --targets codex --json
acm mcp remove example --targets codex
```

追加時はカタログにも登録します。`--no-register` で登録を省略できます。`--arg` と `--env KEY=VALUE` は複数指定可能です。`--args` は文字列配列のJSON、`--cwd` は作業ディレクトリを受け取ります。`--local` は `package.json` / `pyproject.toml` から起動方法を組み立てます。

```sh
acm mcp update example --targets codex   # カタログの定義を配置
acm mcp adopt example --targets codex    # 指定した1プロバイダーの定義をカタログに保存
acm mcp list --catalog --search example
acm catalog mcp show example             # 従来のコマンド形式も利用可能
```

`mcp add/edit/remove/enable/disable/update/adopt` は `--dry-run` に対応します。変更先と機密値を伏せた変更前後の定義を表示し、ファイル更新やプロバイダーコマンドの実行はしません。更新は無効状態を保持し、カタログとの対応が曖昧な定義を推測で変更しません。

状態には `synced`、`differs`、`disabled`、`inline`、`plugin`、`missing` を表示します。設定に含まれる無関係な項目とTOMLコメントを保持します。ClaudeのホームMCPは `claude mcp` 経由で変更します。Claude/Antigravityで無効化した定義はマシン側に保存し、再有効化時に復元します。

## スキル

```sh
acm skill import ./my-skill --catalog
acm skill install https://github.com/example/skills/tree/main/skills/my-skill --catalog
acm skill add my-skill --targets claude,codex
acm skill import ./my-skill --no-catalog --targets codex
acm skill add notes --file ./notes.md --targets claude
acm skill search coding
acm skill list --all --json
```

ディレクトリの取り込みとGitHubからのインストールでは、スクリプトなどの補助ファイルと実行権限を保持します。既存の取り込みを置き換えるには `--force` が必要です。GitHubソースにはコミット情報を記録します。ダウンロードには利用可能な `gh` を優先し、公開HTTPSを代替に使います。

プロジェクトはコピー、ホームはリンクが既定です。`--copy` / `--link` で変更できます。Grokにはカタログのスキルディレクトリを `skills.paths` として登録するため、そのディレクトリ全体が探索対象になります。不要なスキルは `skill disable <id> -t grok` で除外します。`--no-catalog` は対象プロバイダーへ直接配置します。

```sh
acm skill link ./my-skill --as development-skill
acm skill link ./my-skill --distribute --home --targets claude
acm skill unlink development-skill
acm skill update my-skill --targets codex
acm skill rename my-skill renamed-skill --targets claude,codex
acm skill validate ./my-skill
acm skill meta renamed-skill --pin --category coding --tags rust,cli
acm skill list --catalog --pinned --category coding
acm skill outdated renamed-skill
acm skill update renamed-skill --catalog
```

`skill update` は最後に配置した内容と現在のコピーを比較します。配置後の編集や、baselineがない旧コピーの内容が異なる場合は `--force` が必要です。`--copy` / `--link` を明示しても保護を迂回しません。既存コピーの置き換え前に、補助ファイルと権限を含む完全なバックアップを保存します。カタログと一致する旧コピーは、置き換えずにbaselineを記録できます。カタログスコープでは記録したローカル/GitHubソースから更新します。forked指定のスキルは `--force` がない限り更新しません。リネームは名前の衝突を拒否し、配置先の編集内容・baseline・復元履歴を保持します。

`remove` / `disable` は配置先から取り除きます。カタログを削除するのはカタログスコープを指定した場合です。カタログにないスキルを後で復元したい場合は、削除前にimportしてください。

```sh
acm skill update my-skill --targets codex --dry-run
acm skill update my-skill --targets codex --force
acm skill backups my-skill --targets codex --json
acm skill restore my-skill BACKUP_ID --targets codex --dry-run
acm skill restore my-skill BACKUP_ID --targets codex
```

復元はスキル名・プロジェクト/ホーム・対象プロバイダーを照合し、対象を1つに指定して実行します。バックアップ作成後の変更があれば `--force` が必要です。復元前のコピーも保存し、`undoBackupId` で復元操作を戻せます。復元先のリンクをたどることはありません。baselineと履歴は権限を制限した `~/.acm/skill-state/` に置き、公開カタログへ含めません。すべての削除を自動保存する機能ではありません。

スキルの `add/import/install/update/enable/disable/remove/link/unlink/rename/restore` は `--dry-run` に対応します。コピーの差分は追加・変更・削除するパスと競合を表示し、本文を出力せず、カタログ・配置先・履歴を変更しません。GitHubインストールやカタログ更新のpreviewは一時領域へソースを取得するため、ネットワークを使う場合があります。未対応の組み合わせはエラーになります。[詳細](docs/native-workflows.md)も参照してください。

## プラグイン

```sh
acm plugin scan
acm plugin discover --root ./downloaded-plugins
acm plugin import ./my-plugin --as my-plugin
acm plugin add ./plugin-development-repo
acm plugin show my-plugin --json
acm plugin convert my-plugin --dry-run
acm plugin convert my-plugin --assemble-only
acm plugin install my-plugin --targets claude,codex
acm plugin update my-plugin --dry-run
acm plugin update my-plugin
acm plugin uninstall my-plugin --targets claude,codex --keep-skills
```

importはプラグイン全体をコピーし、addは開発元へリンクします。変換ではマニフェスト、スキル、コマンド、フック、エージェントなどを保持し、旧版が分離したスキルも戻します。プロバイダー固有の項目も残しますが、各プロバイダーが利用する項目は異なります。

convertはローカルマーケットプレイスを構築・登録します。`--assemble-only` は構築だけ行います。installは各プロバイダーのネイティブCLIを呼び出します。失敗は非ゼロ終了で報告します。複数プロバイダーへの処理は順番に行い、途中で失敗した場合も、先に成功したインストールと記録は残ります。

```sh
acm plugin snapshot
acm plugin scan --diff
acm plugin discover --import
acm plugin repair
acm plugin repair --apply
acm plugin doctor
acm plugin unlink my-plugin
```

updateは記録したアプリ由来の情報を根拠に、移動したアプリ内のソースを再探索します。通常のローカルソースが消えた場合は同名の別ソースへ切り替えず、エラーにします。移転先は `plugin import /new/path --as my-plugin --force` で明示的に登録してください。判定可能な旧バージョンへの巻き戻しは `--force` がなければ拒否します。IDを省略するとカタログ内を確認します。repairは不足するファイルだけを補います。unlinkはアンインストール済みの開発リンクが対象です。状態表示はACMで成功したネイティブインストールの記録を利用します。既存のプロバイダーセッションでは再起動が必要な場合があります。

```sh
acm plugin verify my-plugin --targets claude,codex --json
acm plugin verify my-plugin --targets claude,codex --reconcile
acm plugin list --verify --targets claude,codex --json
acm status --home --verify --targets claude,codex --json
acm plugin compatibility my-plugin --targets all
```

verifyはネイティブCLIへ問い合わせ、ACMの過去の記録と現在の `installed`・`disabled`・`missing`・`unknown` を区別します。`--reconcile` は明確な観測結果だけをACMの記録へ反映し、インストールや削除はしません。CLI不在・失敗・未対応の出力・識別の曖昧さはunknownとして非ゼロ終了します。インストールの存在と有効状態は別で、`enabled: null` はCLIから確認できないことを示します。

compatibilityは保持する各機能の対応根拠をプロバイダー別に示し、convertのpreviewにも含めます。2026-09-05に、スキルだけを含むローカルプラグインを隔離環境で検証し、Claude Code 2.1.261・Codex 0.149.0・Antigravity 1.1.27・Grok 1.0.5でインストール・一覧・削除が成功しました。Claude/Codexは識別と有効状態を確認でき、Grokは有効状態、Antigravityは一覧からの取得元の識別に限界がありました。フック・MCP実行・認証付きアプリ連携・任意のスキル実行まで保証する検証ではなく、未検証機能はunknownです。[実CLI検証記録](openspec/changes/harden-native-workflows/live-provider-verification.md)に詳細があります。

## 診断とカタログ公開

```sh
acm doctor --offline --targets codex
acm doctor --strict --json
acm doctor --fix
acm scan --dry-run
acm scan
```

doctorは設定の構文、リンク切れ、起動コマンド、作業ディレクトリ、移植性、差分をローカルで確認します。警告も終了コードへ反映したい場合は `--strict` を指定します。`--fix` はリンク切れを取り除きます。壊れた設定を空のファイルで置き換える処理は行いません。

カタログの `PUBLIC.txt` に `skill/my-skill`、`mcp/example`、`plugin/my-plugin` のように公開する資産を1行ずつ記載します。

```sh
acm catalog publish --dry-run
acm catalog publish --to ./public-catalog-checkout --commit
```

`dist-public` へのステージング前に秘密情報と個人の絶対パスを検査します。公開先には変更のないGitチェックアウトを指定します。既存の無関係なファイルは保持します。`--commit` はローカルコミットだけを作成し、pushはしません。`publish/bundle` の追加ファイルも同じ検査を受けます。

## TUIと開発

端末で `acm` / `acm init` を実行するとRatatuiの画面を開きます。Tab・1〜4でタブ移動、矢印・Ctrl+N/Pで選択、`/` で検索、`H` でスコープ切替、`q` で終了します。自動処理では明示的なコマンドと `--json` を使用してください。

MCP/スキルのプロバイダー一覧JSONは従来の `servers` / `skills`、`projectRoot`、`totalCount`、`enabledCount` を含む形式です。カタログ一覧は配列です。

`--json` では引数・実行エラーも1つのJSON文書と非ゼロ終了コードで返します。複数対象への変更は `results` に対象ごとの結果を残し、成功済みの変更を保持して `retryTargets` を示します。複数資産の操作では `retryResources` を示す場合もあります。途中成功は内側のdetailも確認してください。`--verbose` はバージョン・スコープ・対象・カタログ情報をstderrへ追加し、stdoutのJSONを壊しません。TUIでも失敗・部分成功と外部エディターの終了エラーを表示します。

```sh
just check          # フォーマット・Clippy・Rustテスト・配布構成
just build          # target/release/acm
just dev --help
just test-smoke     # npmパッケージを作成・展開して実行確認
```

テストはホームとカタログを隔離し、プロバイダーのテスト用CLIを使います。アプリ本体はRustだけで動作します。`bin/` と `scripts/` のJavaScriptは起動・配布専用です。

MIT License: [LICENSE](LICENSE)
