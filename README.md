# English Learning

Yuki × Chappy の英会話学習記録・運用ルール・共有用アセットを、PC間で同期するためのリポジトリです。

## 収録対象

- `AGENTS.md`: Codexが直接参照する運用上の正本ルール
- `yuki-chappy-english-session-rules.md`: 別PC・別ツール向けの可搬版ルール
- `.codex/config.toml`: モデルと推論強度などのプロジェクト設定
- `english_progress_tracker.json`: 根拠付き英語力評価の履歴
- `generate_english_progress_chart.mjs`: 成長グラフの生成手順
- `20xx-xx-xx-*-session-report.md`: セッションごとのMarkdown記録
- `20xx-xx-xx-*-session-report.html`: 共有用HTMLレポート
- `assets/`: グラフ・比較図などの再利用アセット

ルールの優先順位は `Yukiのその場の明示指示 → AGENTS.md → 可搬版ルール` です。Google Docs「Daily English Learning Notes by Yuki × Chappy」は学習記録の正本として継続利用します。

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

コミット対象は変更内容に応じて選び、`git add .` で個人資料を一括追加しない方針です。`tmp/`、`output/`、認証情報、個人情報を含む一時資料は同期対象外です。pushやPull Request作成は、Yukiが明示的に依頼した場合だけ行います。
