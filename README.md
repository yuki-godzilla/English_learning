# English Learning

Yuki × Chappy の英会話学習記録・運用ルール・共有用アセットを、PC間で同期するためのリポジトリです。

## 収録対象

- `AGENTS.md`: Codexが直接参照する運用上の正本ルール
- `yuki-chappy-english-session-rules.md`: 別PC・別ツール向けの可搬版ルール
- `.codex/config.toml`: モデルと推論強度などのプロジェクト設定
- `english_progress_tracker.json`: 根拠付き英語力評価の履歴
- `generate_english_progress_chart.mjs`: 成長グラフの生成手順
- `scripts/pronunciation-recording.ps1`: Windowsサウンド レコーダーの起動と新規録音の回収補助
- `scripts/setup-pronunciation.ps1`: PCごとのローカル音声分析環境の構築
- `scripts/analyze-pronunciation.py`: 録音のローカル音響・音声認識分析
- `requirements-pronunciation.txt` / `requirements-pronunciation.lock.txt`: ローカル音声分析の直接依存と再現用固定版
- `pronunciation-benchmark.md`: 発音評価用の約60秒共通音読課題
- `package.json` / `package-lock.json`: グラフ生成に必要なNode.js依存関係
- `.nvmrc`: 動作確認済みNode.js LTSバージョン
- `20xx-xx-xx-*-session-report.md`: セッションごとのMarkdown記録
- `20xx-xx-xx-*-session-report.html`: 共有用HTMLレポート
- `assets/`: グラフ・比較図などの再利用アセット

ルールの優先順位は `Yukiのその場の明示指示 → AGENTS.md → 可搬版ルール` です。Google Docs「Daily English Learning Notes by Yuki × Chappy」は学習記録の正本として継続利用します。

## グラフ生成環境

Node.js 24.19.0 LTSを動作確認基準とし、`sharp`を使って評価ダッシュボードを生成します。Node.jsを用意した後、次の順で実行します。

```powershell
npm ci
npm test
```

生成物は `output/english-growth-evidence-dashboard.png` です。`output/` は再生成可能な成果物としてGit管理しません。Node.js 20.9.0以上であれば現在の`sharp`の必要条件を満たしますが、別PCでは`.nvmrc`のLTS版を優先します。

## 発音評価の録音導線

Yukiが「発音を評価してほしい」と伝えた場合、ChappyはWindowsのサウンド レコーダーを開き、評価対象の英文を提示します。対象指定がなければ `pronunciation-benchmark.md` の共通音読課題を使います。録音開始・停止はYukiが操作し、停止後に「録音完了」と伝えます。その後、Chappyが新規録音の特定と回収を行います。

補助コマンドは次の5つです。通常はYukiではなくChappyが実行します。

```powershell
npm run pronunciation:setup
npm run pronunciation:status
npm run pronunciation:start
npm run pronunciation:collect
npm run pronunciation:analyze
```

`pronunciation:setup` はプロジェクト専用の `.venv-pronunciation/` を作成し、`faster-whisper small.en`、Praatによる音響分析、PyAVによる音声デコードをローカルへ準備します。モデルを含む依存関係は数百MB規模になるためGitへ入れず、各PCで初回だけ構築します。PyAVが録音形式を直接デコードするため、システム版FFmpegは必須ではありません。既存のデコーダーで読めない形式が確認された場合だけ、FFmpegを追加します。

容量や処理速度を優先する別PCでは、`scripts/setup-pronunciation.ps1 -Model base.en` または `-Model tiny.en` を指定できます。選択したモデルはGit対象外の環境状態に保存され、そのPCの `status` と `analyze` が同じモデルを使います。

録音の一時コピー、モデル、検出状態、分析結果は `tmp/pronunciation-recordings/` または `tmp/pronunciation-models/` に置き、Git管理しません。ローカル分析では録音品質、文字起こしに基づく明瞭度の補助指標、話速、ポーズ、ピッチ変化を実測します。音声認識の信頼度だけでは母音・子音、単語強勢、linking、native-likenessを確定評価せず、対応できない観点はN/Aにします。

### 別PC・機能不足時のフォールバック

- Windowsサウンド レコーダーがあるPCでは、従来どおり自動起動と新規録音の回収を使います。
- サウンド レコーダーがないPCでは、任意の録音アプリで保存したファイルを `tmp/pronunciation-recordings/inbox/` へ入れるか、`pronunciation-recording.ps1 -Action Collect -AudioPath <file>` で明示指定します。
- サウンド レコーダーがインストール済みでも使えない場合は、`-ForceManualCapture` で同じ手動回収へ切り替えられます。
- ローカル環境を構築できない場合も録音導線は維持し、直接分析できない観点は `N/A / 音声分析手段なし` とします。推測採点はしません。
- 外部の音声対応サービスは自動フォールバックにしません。録音の外部送信、費用、利用目的を説明し、Yukiがその都度明示承認した場合だけ使います。

## 情報管理

Gitで追跡するファイルには、個人メールアドレス、認証情報、所属を特定できる部署名、非公開の製品・案件名を記録しません。業務の学習文脈は `勤務先 / employer`、`企業向けIoTサービス / enterprise IoT service` のような匿名表現を使います。具体的な情報をアクセス制御されたGoogle Docsに残す場合は、会社の情報管理規程とYukiの判断を優先します。

## 別PCでの開始

```powershell
git clone https://github.com/yuki-godzilla/English_learning.git
cd English_learning
git pull --rebase
```

作業後は次の順で同期します。

```powershell
git pull --rebase
git status
git diff
git add AGENTS.md yuki-chappy-english-session-rules.md README.md
git commit -m "Update English learning records"
git push
```

コミット対象は変更内容に応じて選び、`git add .` で個人資料を一括追加しない方針です。`tmp/`、`output/`、`node_modules/`、認証情報、個人情報を含む一時資料は同期対象外です。pushやPull Request作成は、Yukiが明示的に依頼した場合だけ行います。
