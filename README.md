# English Learning

Yuki × Chappy の英会話学習記録・運用ルール・共有用アセットを、PC間で同期するためのリポジトリです。

## 収録対象

- `yuki-chappy-english-session-rules.md`: 運用の正本ルール
- `20xx-xx-xx-*-session-report.md`: セッションごとのMarkdown記録
- `20xx-xx-xx-*-session-report.html`: 共有用HTMLレポート
- `assets/`: グラフ・比較図などの再利用アセット

Google Docsは継続利用する正本ドキュメントです。編集後はこのリポジトリにも、ルール・セッション記録・必要なアセットを反映します。

## 別PCでの開始

```powershell
git clone https://github.com/yuki-godzilla/English_learning.git
cd English_learning
git pull --rebase
```

作業後は次の順で同期します。

```powershell
git pull --rebase
git add .
git commit -m "Update English learning records"
git push
```

`tmp/` と `output/` はPC固有または再生成可能なため同期対象外です。
