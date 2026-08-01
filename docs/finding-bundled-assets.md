# デスクトップアプリに同梱された Skill / プラグイン / MCP の探し方

最も新しい Skill・プラグイン・MCP は、ホームディレクトリの設定ファイルではなく、
デスクトップアプリの内部に同梱されていることが多い。これらはアプリの更新と同時に更新されるため、
そのベンダーが現時点で最良と考えている実装が入っている。

このドキュメントは、それらを毎回探し当てるための手順をまとめたもの。
記載のパスは macOS で 2026-08-01 に実機確認したもので、**アプリ更新で変わる前提**で扱う。
だからこそ、パスの一覧より後半の「再探索の手順」のほうが寿命が長い。

> **読み取り専用で扱う。** これらはアプリが管理する領域で、次回の更新で上書きされる。
> ACM がここへ書き込むことはない。参考にする場合はカタログ側へ取り込む。

---

## 探索先は 3 種類ある

| 種類 | 位置 | 性質 |
| --- | --- | --- |
| アプリバンドル同梱 | `/Applications/<App>.app/Contents/Resources/` | アプリ更新でまるごと入れ替わる。ベンダー公式の最新形 |
| アプリのデータ領域 | `~/Library/Application Support/<App>/` | 実行時にダウンロード・展開される。セッション単位のものもある |
| CLI のキャッシュ | `~/.claude/`, `~/.codex/`, `~/.grok/` 配下 | `acm scan` が既に走査している領域 |

3 番目は ACM が扱えている。**手を伸ばす価値があるのは 1 番目と 2 番目**。

---

## 確認済みの具体例（2026-08-01 時点）

### ChatGPT.app — バンドル同梱プラグイン

```
/Applications/ChatGPT.app/Contents/Resources/plugins/openai-bundled/plugins/
├── browser/         ├── computer-use/    ├── latex/            ├── record-and-replay/  ├── sites/
├── chrome/          ├── deep-research/   ├── messages/         ├── reminders-macos/    └── visualize/
```

各プラグインは `skills/` `scripts/` `assets/` `docs/` を持つ標準的な構成。
`chrome` は `extension-host/` も持つ。同じ `openai-bundled` という名前のマーケットプレースが
`~/.codex/.tmp/bundled-marketplaces/openai-bundled/plugins/` にも展開されるため、
**アプリ側とCLI側で内容が違うことがある**。新しいのは通常アプリ側。

### Claude.app — セッション単位で展開される skills プラグイン

```
~/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin/<session-uuid>/<plugin-uuid>/
├── manifest.json          # skillId, description, creatorType, updatedAt, enabled を持つ
├── .claude-plugin/
└── skills/
    ├── consolidate-memory/  ├── mcp-builder/  ├── pdf/    ├── schedule/     ├── skill-creator/
    ├── docx/                ├── morning/      ├── pptx/   ├── setup-cowork/ └── xlsx/
```

`manifest.json` に `updatedAt` が入っているので、**カタログ側と比べて新しいかどうかを判定できる**。
UUID が2階層あるため、パスを固定で覚えても意味がない。後述の `find` で毎回引き当てる。

### Claude.app — バンドル同梱の MCP

```
/Applications/Claude.app/Contents/Resources/app.asar.unpacked/resources/office365-mcp/
```

`app.asar.unpacked` は Electron が「アーカイブに固めず生ファイルで置く」領域。
ネイティブバイナリを含むものがここに出るので、**MCP サーバーの実体はここにあることが多い**。

### 参考: `app.asar` の中身

`Claude.app` `Antigravity.app` `ChatGPT.app` はいずれも `Contents/Resources/app.asar` を持つ。
アーカイブ内も探したい場合は `npx @electron/asar list <path>` で一覧できる。
ただし中身はビルド後の JS が大半で、Skill の原文が入っていることは少ない。
**まず `app.asar.unpacked/` と `Resources/` 直下を見るほうが早い。**

---

## 再探索の手順

アプリが更新されて上記のパスが消えたときは、名前ではなく構造で探す。

### 1. アプリバンドルを掃く

```bash
find /Applications/<App>.app/Contents/Resources -maxdepth 3 \
  \( -name "*skill*" -o -name "*plugin*" -o -name "*.asar" \) 2>/dev/null
```

`app.asar.unpacked` が出たら、その下も同じ条件で掘る。

### 2. アプリのデータ領域を掃く

```bash
find ~/Library/Application\ Support/<App> -maxdepth 4 -type d \
  \( -name "skills" -o -name "plugins" -o -name "agents" -o -name "commands" -o -name "*marketplace*" \) 2>/dev/null
```

`maxdepth` は 3〜4 から始める。キャッシュ類が多い領域なので、いきなり深く掘ると
`Cache` `GPUCache` `Code Cache` `blob_storage` などのノイズで埋まる。

### 3. どのアプリを見るか分からないときは横断で掃く

```bash
find ~/Library/Application\ Support -maxdepth 4 -type d -name "skills" 2>/dev/null
```

### 4. 実体があるか確かめる

ディレクトリ名だけでは空の器のこともある（実例: `ChatGPT.app/Contents/Resources/skills/skills` は空）。
`SKILL.md` の存在で判定する。

```bash
find <candidate-dir> -name "SKILL.md" -maxdepth 4 2>/dev/null | head
```

### 5. 更新日時で新しさを見る

```bash
find <candidate-dir> -name "SKILL.md" -newermt "-30 days" 2>/dev/null
```

`manifest.json` を持つものは、そちらの `updatedAt` のほうが信頼できる。

---

## 見つけたものを取り込むときの注意

- **ライセンスを確認する。** `SKILL.md` の frontmatter に `license` があるか、同梱の LICENSE を見る。
  不明なものはカタログの公開対象（`PUBLIC.txt`）に入れない。
- **機密情報を確認する。** バンドル内の設定に API キーやエンドポイントが埋まっていることがある。
  取り込む前に `grep -rniE "api[_-]?key|token|secret|bearer" <dir>` で確認する。
- **絶対パスを確認する。** `/Applications/...` や `~/Library/...` を指す参照が残っていると、
  カタログへ移した時点で壊れる。
- **そのままコピーしない。** ベンダー固有の前提（そのアプリ内でしか動かないスクリプトやホスト連携）が
  混ざっていることが多い。参考にして書き直すほうが安全なことが多い。
- **元の場所は書き換えない。** アプリ更新で上書きされるので、変更は失われる。

---

## ACM が既に走査している領域（重複して探さなくてよい）

`acm scan` は以下を見ている。ここに出てくるものは改めて探す必要はない。

| プロバイダ | Skill | プラグイン / MCP |
| --- | --- | --- |
| Claude | `~/.claude/skills` | `~/.claude/plugins/cache`, `~/.claude/plugins/marketplaces` |
| Codex | `~/.codex/skills`, `.system`, `vendor_imports/.../.curated` | `~/.codex/.tmp/plugins/plugins`, `~/.codex/.tmp/bundled-marketplaces`, `~/.codex/plugins/cache` |
| Antigravity | `~/.agents/skills` | `~/.gemini/config/plugins` |
| Grok | `~/.grok/skills` | `~/.grok/plugins` |

```bash
acm scan
```

**このドキュメントが対象にするのは、この表に無い場所**。
