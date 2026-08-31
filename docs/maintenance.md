# Learning Site 保守ガイド

このページは学習内容ではなく、別PCで同じ閲覧面を再現・検証するための保守手順です。

## 必要環境

- Node.js: `.nvmrc` のLTS版
- Python 3.12以上
- Node依存: `package-lock.json`
- Site依存: `requirements-site.txt`

Windowsでの初回セットアップ:

```powershell
npm ci
py -m venv .venv-site
.\.venv-site\Scripts\python.exe -m pip install --requirement requirements-site.txt
```

`.venv-site/`、`.generated-site-docs/`、`site/` は再生成可能なためGit管理しません。

## コマンド

```powershell
# 正本の検証、グラフ生成、Learning Site生成、MkDocsビルド、サイト検証
npm run site:check

# ローカルプレビュー
npm run site:serve
```

`site:check` は次を確認します。

- 正本の全セッション（現在9件）と主要ページの生成
- 30秒 recap とactive recallの存在
- サイト内リンクと画像参照
- 画像のaltと1セッション最大2点
- 検索索引の主要キーワード
- 個人メール、ローカル絶対パス、特定の勤務先・所属・非公開製品名、運用ファイル名の混入

閲覧構造、CSS、画像配置、生成ロジックを変更した場合は、スマホ幅とPC幅の両方でホーム、5分復習、Bank検索、セッション画像、成長画面を確認します。

## 正本と閲覧面の分離

- `learning-records/daily-notes/YYYY-MM.md`: 月別Daily Notesの正本
- `learning-records/banks/*.md`: 3 Study Banksの正本
- `english_progress_tracker.json`: 評価履歴の正本
- `scripts/build-learning-site.mjs`: 正本を学習者向けページへ変換
- `.generated-site-docs/`: MkDocs入力となる一時生成物
- `site/`: 公開可能な完成HTML

生成ページを直接編集しません。内容修正は正本へ反映してから再生成します。

## GitHub Pages

`.github/workflows/learning-site.yml` はpushとPull Requestで検証だけを行います。初回公開は自動では行いません。

Yukiが公開を明示承認した後、GitHub Actionsの `Learning site` を手動実行し、`publish` を有効にすると、検証済みの `site/` だけをPagesへ渡します。初回はGitHubのPages設定でSourceをGitHub Actionsにする必要があります。公開URL、公開状態、Actionsの成功を確認するまで「公開済み」と扱いません。全ページへ`noindex`を付けますが、これは検索エンジンへの依頼であり、URLを知る人の閲覧を防ぐ認証ではありません。

Pagesの公開可否と、正本リポジトリの公開可否は別に判断します。正本リポジトリがPublicなら、生成サイトに載せなかった情報もGitファイルや過去コミットから閲覧できます。通常は正本をPrivateにし、公開が必要な場合だけ匿名化済みの生成物を別の公開先へ渡す構成を優先します。現在ファイルを修正しても過去コミットは消えないため、既存履歴を扱う場合は、リポジトリのPrivate化、匿名化済み新規リポジトリへの移行、履歴書き換えのいずれかをYukiの明示判断で行います。

## 通常の同期

```powershell
git pull --rebase
npm run site:check
git status
git diff
```

意図したファイルだけをstageし、検証後にcommit / pushします。force push、公開範囲変更、Pages設定変更はYukiの明示指示がある場合だけ行います。

## 発音評価環境

発音評価はLearning Siteと別のローカル環境です。

```powershell
npm run pronunciation:status
npm run pronunciation:setup
```

録音、モデル、分析中間物は `tmp/` と `.venv-pronunciation/` に置き、GitやLearning Siteへ含めません。
