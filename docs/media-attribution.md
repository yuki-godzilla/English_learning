# Media attribution and review

この一覧は、学習記録で使う画像の役割、作成者、出典、利用条件を管理するためのものです。画像を追加・差し替えた場合は、`docs/image-privacy-review.json` の視覚確認用ハッシュと併せて更新します。

## 学習画面に掲載する画像

| File | Role | Creator / source | Terms and notes |
|---|---|---|---|
| `assets/2026-08-27-microgrid-diagram.png` | Microgridの仕組みを復習する自作概念図 | Yuki × Chappy。概念の参考資料: [U.S. Department of Energy, Office of Electricity](https://www.energy.gov/oe/articles/microgrids-large-electric-loads-grid-support-how-leverage-microgrids-support-utilities) | 図そのものは本プロジェクトで作成。DOEによる推奨・承認を示さない。 |
| `learning-records/archive/assets/electricity-demand-chart.png` | 米国の用途別電力需要増加を確認するグラフ | [IEA (2026), *Electricity 2026 — Demand*](https://www.iea.org/reports/electricity-2026/demand) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。学習画面向けにトリミングした派生表示。次の免責文を画像直下に表示する: “This is a work derived by Yuki × Chappy from IEA material and Yuki × Chappy is solely liable and responsible for this derived work. The derived work is not endorsed by the IEA or its Member countries in any manner.” |
| `assets/2026-08-19-hybrid-ai-comparison.png` | Local / Cloud / Hybrid AIを比較する学習図 | Yuki × Chappy | 匿名化済み。固有の勤務先・製品名を入れない。 |
| `output/english-growth-evidence-dashboard.png` | 成長評価の要点 | リポジトリの評価JSONから自動生成 | 推定と直接測定を区別する。 |
| `output/english-test-score-estimate-trends.png` | 資格スコア目安 | リポジトリの評価JSONから自動生成 | 未測定技能を新しい測定値として扱わない。 |

## アーカイブにだけ残る第三者画像

| File | Source | Terms and notes |
|---|---|---|
| `learning-records/archive/assets/microgrid-data-center-grid.png` | [U.S. Department of Energy, Office of Electricity](https://www.energy.gov/oe/articles/microgrids-large-electric-loads-grid-support-how-leverage-microgrids-support-utilities) | Google Docs移行スナップショットの出典付き画像。DOE公式サイトのコンテンツは、別記がない限りパブリックドメインとする[公式再利用方針](https://www.energy.gov/cmei/systems/awardee-communications-support#reposting-and-remixing-content)を確認。新しい学習画面では自作概念図を使う。 |
| `assets/2026-08-27-doe-microgrid-data-center.png` | 同上 | 移行時の参照用。新しい学習画面には配信しない。 |

## 掲載ルール

- 画像は概念理解、比較、根拠データ、成長確認のいずれかに明確に役立つ場合だけ掲載する。
- 画像直下に短い説明、名前付き出典リンク、必要なライセンスと免責文を置く。
- 第三者画像より、本プロジェクトで作った概念図を優先する。
- 公開前に画像を目視し、個人名、勤務先、非公開の製品・案件名、メールアドレスなどが写っていないことを確認する。
- 画像の追加・差し替え時は `docs/image-privacy-review.json` のハッシュを更新し、`npm run site:check` を通す。
