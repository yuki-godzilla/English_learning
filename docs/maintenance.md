# 保守ガイド

## v5.0 レポートの安全な発行

1. Git状態とremoteを確認し、安全なときだけpull。正本と必要な匿名化済み根拠を更新。
2. `npm run report:prepare`。画像・Site・候補PDF・単体テストを検証し、`tmp/report-runs/current.json` に入力/PDFハッシュを固定する。
3. レイアウト変更時は `npm run ui:check`。これは実ブラウザーで390px/1440px、横はみ出し、復習保存、計算済み印刷色/文字サイズを検証し、tmpへ画像を保存する。PlaywrightはCodex同梱runtime、または `PLAYWRIGHT_MODULE` に指定したモジュールを使用する。依存がない環境では未検証と明示し、合格扱いにしない。
4. PDF全ページと主要実寸ページ、PC/スマホ画像を実際に確認し、`npm run report:state -- reviewed "確認内容"`。
5. 対象差分をcommit/push。`npm run report:state -- verify-send` 後に検証済みPDFを送信し、`npm run report:state -- sent <provider-message-id>`。

ソースまたはPDFが変わるとreceiptが失効する。同一PDFを再送しない。送信直後の接続切れは、メールの送信済み検索で件名・宛先・添付サイズを照合してからreceiptを更新する。receiptは認証情報を持たず、メールを自動送信しない。

`tmp/report-prepare.lock` / `tmp/journal-pdf.lock` が残っていた場合、記載PIDのプロセスが存在せず処理が終了していることを確認してから、そのlockだけを除去する。広いtmpディレクトリを削除しない。候補PDFのpostflightに失敗した場合、最後の有効なPDFは維持される。

### 評価・Bank・復習の保守

- Session 17以降は `scripts/lib/scoring-contract.mjs` が新規根拠参照を検証。旧スコアの再監査は別依頼でのみ行う。
- Bank項目の追加時は本文をJournalへ、IDと正規化キーを `learning-records/resources/bank-ledger.json` へ追加する。IDは `bank + '-' + sha256(normalized_key).slice(0,16)` が初期値。既存項目の改名ではIDを変えない。統合元は `retired_reason` と `merged_into`（存続項目のキー）を残す。
- 復習履歴JSONはユーザー自身で保存・取込。旧ラベルは引き継ぐが日時は不明のまま。自己申告と会話中の独立した再利用観察は別情報。
- `npm run test:unit` は入力文・音読混入、比較群の重複、増減逆転、全N/A、旧発音根拠、Markdown表、復習履歴を回帰テストする。
- PDF本文の正本3ファイルとは別に、transcriptsは根拠、Bank台帳は同一性契約、receiptは一時的な送信状態である。固定Archiveは生成処理に含めない。

学習内容は [English Journal](../learning-records/journal.md) で読みます。この文書は、別PCで検証・生成・同期するための技術情報です。

## 構成

```text
learning-records/
├─ journal.md             # 人が読む学習記録の正本
├─ progress.json          # 評価データの正本
├─ media-manifest.json    # 画像メタデータの正本
├─ media/                 # 現在使う画像
├─ resources/             # 発音課題など
├─ transcripts/           # 公開前redaction済みraw evidenceとcoverage台帳
└─ archive/               # 固定移行記録。生成処理は読まない

scripts/
├─ charts/                # 評価グラフ
├─ content/               # 3正本の検証
├─ lib/                   # Journal共通パーサー
├─ pronunciation/         # 録音・ローカル音声分析
├─ pdf/                   # PDF用環境検出・生成後検査
├─ transcripts/           # raw evidenceとcoverageの検証
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
npm run pdf:setup
```

`.nvmrc`をNodeの基準版とします。Codex同梱Nodeが同じ版なら利用できます。別のターミナルで`node --version`が異なる場合は、Node管理ツールで`.nvmrc`に合わせてください。PDF生成は`.venv-pdf`を優先し、`requirements/pdf.txt`で依存を再現します。Chrome/Edge/Chromiumが標準場所にない場合は`JOURNAL_PDF_BROWSER`、既存Python環境を使う場合は`JOURNAL_PDF_PYTHON`を指定できます。

## 日常コマンド

```powershell
# 3正本、グラフ、サイト、リンク、画像、プライバシーを一括検証
npm run check

# 検証済みサイトを生成
npm run build

# ローカルプレビュー
npm run serve

# raw transcriptの形式・収録範囲・公開不可の既知パターンを検証
npm run transcripts:check

# 統合Journal PDFを生成し、機械的な収録・しおり・リンク検査まで実行
npm run journal:pdf
```

## 会話ランタイムとフィードバック方針

Codexのローカル英会話では、リポジトリ直下の `AGENTS.md` が会話中に読み込まれる実行用プロンプトの正本です。通常会話、Wrap-up、Session Packageの記録指示は同ファイルへ直接統合し、別プロンプトへ規範を複製しません。

`npm run content:check` は、会話の流れを優先する方針、冠詞・前置詞の文脈判定、ASR不確実箇所の分離、Wrap-upの1〜2項目制限、終了時に復唱を強制しない方針の必須マーカーを検証します。マーカー検査は文章の存在を保証する回帰防止であり、実際の会話品質は各セッションのWrap-upとSession Packageで確認します。

セッション後のレポートを作成・更新する回は、評価値が変わらなくても正式アセットを再生成し、目視確認します。

```powershell
npm run report:assets
```

## 新しいセッション

1. 元の会話ログがある場合は全発話を順に保存し、公開不可部分だけを伏せる。ない場合は[coverage台帳](../learning-records/transcripts/coverage.json)に理由を残し、要約から全文を作らない。
2. `journal.md` のセッション一覧先頭へ `session-meta`、固定アンカー、本文を追加する。
3. Journalの目次、5分復習、成長説明、必要な学習バンクを更新する。
4. `progress.json`の6観点を独立に判断し、根拠不足はN/Aとする。
5. `npm run report:assets`で正式グラフと台帳のSHA-256を更新・確認する。
6. `npm run check`、統合Journal PDFの全ページ確認、メール送信を完了し、意図した差分だけをcommit / pushする。

raw transcriptは公開リポジトリへpushされます。検証コマンドは既知のメール・認証情報・勤務先名などを止めますが、機密情報をすべて検出できるわけではありません。元の発話、redaction範囲、coverageの`partial`理由を公開前に必ず確認します。

Journalの各セッションは同じメタデータと本文からGitHub表示とLearning Siteへ展開されます。生成ページを直接編集しません。

## 発音評価環境

```powershell
npm run pronunciation:status
npm run pronunciation:setup
```

録音、モデル、分析中間物は `tmp/` と `.venv-pronunciation/` に置き、GitやLearning Siteへ含めません。

## GitHub Pages

`.github/workflows/learning-site.yml` はpushとPull RequestでSite・raw transcript・Node依存の監査を検証し、Windows上でPDFの生成・機械検査も行います。初回公開、公開範囲変更、Pages設定変更、手動デプロイはYukiの明示承認後だけ行います。

手動実行で `publish` を有効にした場合だけ、検証済みの `site/` をPagesへ渡します。全ページの`noindex`は検索掲載を控える依頼であり、閲覧を防ぐ認証ではありません。正本リポジトリがPublicなら、サイトに載せないファイルや過去コミットも閲覧可能です。

## PC間同期

```powershell
git pull --rebase
npm run check
git status
git diff
```

未コミット変更を破棄せず、force pushを使いません。検証・pushの成功確認までをPC間共有完了とします。
