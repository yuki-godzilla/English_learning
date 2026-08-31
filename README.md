# Yuki × Chappy English Journal

> 話したことを、次に話せる英語へ。

英会話の内容を「保存する」だけでなく、読み返し、思い出し、もう一度話し、成長を実感するための学習記録です。

## Learning Site

学習者向けの画面を、リポジトリ内の正本Markdownと評価データから自動生成します。

- **ホーム** — 最新の続き、今回できたこと、今日の5分復習
- **セッション** — 全セッションを新しい順に表示し、30秒の要約から本文へ進む
- **5分復習** — 答えを開くactive recall、表現・語彙・スピーキングの検索
- **成長** — 行動の根拠、L1〜L5、Pronunciationの測定有無、資格スコア目安
- **資料** — セッションで実際に参照した記事と公式情報

公開用サイトは構築・検証済みですが、**GitHub Pagesの初回公開はまだ行っていません**。公開するとリポジトリ内容がWebサイトとして見つけやすくなるため、Yukiの明示承認後に手動デプロイします。`noindex`は検索掲載を控える指示であり、アクセス制御や非公開化ではありません。

> **公開範囲:** リポジトリがPublicの場合、Learning Siteとは別に、Git管理中の正本と過去コミットも閲覧可能です。現在ファイルの匿名化だけでは過去履歴は消えないため、スマホ公開前に「正本リポジトリをPrivateにする」または「匿名化した公開用リポジトリを分離する」かを決めます。

## 今すぐGitHubで読む

Pages公開前のフォールバックです。

1. [最新セッション](learning-records/latest.md)
2. [セッションIndex](learning-records/session-index.md)
3. [Expression Bank](learning-records/banks/expression-bank.md)
4. [Vocabulary Bank](learning-records/banks/vocabulary-bank.md)
5. [Pronunciation & Speaking Bank](learning-records/banks/pronunciation-speaking-bank.md)

## ローカルでLearning Siteを開く

初回だけNode.jsとPython依存を準備し、その後は次のコマンドで起動します。

```powershell
npm ci
py -m venv .venv-site
.\.venv-site\Scripts\python.exe -m pip install --requirement requirements-site.txt
npm run site:serve
```

ブラウザで `http://127.0.0.1:8000/` を開きます。自動検証は次の1コマンドです。

```powershell
npm run site:check
```

## 正本と生成物

- 正本: `learning-records/` のMarkdown、`english_progress_tracker.json`
- Git管理用の匿名化済み固定移行資料: `learning-records/archive/google-docs-final-2026-08-31.md`
- 閲覧面の設定: `mkdocs.yml`、`site-theme/`、`site-overrides/`
- 生成物: `.generated-site-docs/`、`site/`（Git管理しない）

運用ルールは [AGENTS.md](AGENTS.md)、セットアップ・更新・公開手順は [保守ガイド](docs/maintenance.md) を参照してください。
