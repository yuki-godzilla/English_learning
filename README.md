# English Learning

Yuki × Chappy の英会話学習記録・運用ルール・共有用アセットを、PC間で同期するためのリポジトリです。

## 収録対象

- `AGENTS.md`: Codexが直接参照する運用上の正本ルール
- `yuki-chappy-english-session-rules.md`: 別PC・別ツール向けの可搬版ルール
- `.codex/config.toml`: モデルと推論強度などのプロジェクト設定
- `english_progress_tracker.json`: 根拠付き英語力評価の履歴
- `generate_english_progress_chart.mjs`: 成長グラフの生成手順
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
