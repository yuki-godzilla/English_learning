# 保守ガイド

学習内容は [English Journal](../learning-records/journal.md) で読みます。この文書は、別PCで検証・生成・同期するための技術情報です。

## 構成

```text
learning-records/
├─ journal.md             # 人が読む学習記録の正本
├─ progress.json          # 評価データの正本
├─ media-manifest.json    # 画像メタデータの正本
├─ media/                 # 現在使う画像
├─ resources/             # 発音課題など
└─ archive/               # 固定移行記録。生成処理は読まない

scripts/
├─ charts/                # 評価グラフ
├─ content/               # 3正本の検証
├─ lib/                   # Journal共通パーサー
├─ pronunciation/         # 録音・ローカル音声分析
└─ site/                  # Learning Site生成・検証

site-src/                 # Siteのテーマ・CSS・JavaScript
requirements/             # Python依存
```

`.generated-site-docs/`、`site/`、`output/`、`tmp/` は再生成可能で、正本ではありません。

## 初回セットアップ

- Node.js: `.nvmrc` のバージョン
- Python: 3.12

```powershell
npm ci
py -m venv .venv-site
.\.venv-site\Scripts\python.exe -m pip install --requirement requirements/site.txt
```

## 日常コマンド

```powershell
# 3正本、グラフ、サイト、リンク、画像、プライバシーを一括検証
npm run check

# 検証済みサイトを生成
npm run build

# ローカルプレビュー
npm run serve
```

## 会話ランタイムとフィードバック方針

Codexのローカル英会話では、リポジトリ直下の `AGENTS.md` が会話中に読み込まれる実行用プロンプトの正本です。通常会話、Wrap-up、Session Packageの記録指示は同ファイルへ直接統合し、別プロンプトへ規範を複製しません。

`npm run content:check` は、会話の流れを優先する方針、冠詞・前置詞の文脈判定、ASR不確実箇所の分離、Wrap-upの1〜2項目制限、終了時に復唱を強制しない方針の必須マーカーを検証します。マーカー検査は文章の存在を保証する回帰防止であり、実際の会話品質は各セッションのWrap-upとSession Packageで確認します。

評価データを変更した回だけ、目視確認後に追跡グラフを更新します。

```powershell
npm run charts:publish
```

## 新しいセッション

1. `journal.md` のセッション一覧先頭へ `session-meta`、固定アンカー、本文を追加する。
2. Journalの目次、5分復習、成長説明、必要な学習バンクを更新する。
3. 測定根拠がある場合だけ `progress.json` を更新する。未測定は推定で補わない。
4. 画像を追加する場合は `media/` に置き、`media-manifest.json` に用途・alt・出典・利用条件・目視確認後のSHA-256を登録する。
5. `npm run check` を通し、意図した差分だけをcommit / pushする。

Journalの各セッションは同じメタデータと本文からGitHub表示とLearning Siteへ展開されます。生成ページを直接編集しません。

## 発音評価環境

```powershell
npm run pronunciation:status
npm run pronunciation:setup
```

録音、モデル、分析中間物は `tmp/` と `.venv-pronunciation/` に置き、GitやLearning Siteへ含めません。

## GitHub Pages

`.github/workflows/learning-site.yml` はpushとPull Requestで検証します。初回公開、公開範囲変更、Pages設定変更、手動デプロイはYukiの明示承認後だけ行います。

手動実行で `publish` を有効にした場合だけ、検証済みの `site/` をPagesへ渡します。全ページの`noindex`は検索掲載を控える依頼であり、閲覧を防ぐ認証ではありません。正本リポジトリがPublicなら、サイトに載せないファイルや過去コミットも閲覧可能です。

## PC間同期

```powershell
git pull --rebase
npm run check
git status
git diff
```

未コミット変更を破棄せず、force pushを使いません。検証・pushの成功確認までをPC間共有完了とします。
