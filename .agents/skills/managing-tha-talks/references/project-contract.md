# THA Talk project contract

## リポジトリの役割

- 制作元候補: `github.com/THA-inc/ai_president_mock`
- Public mirror: `github.com/asakonishiyama-tha/asakonishiyama-tha.github.io`

ディレクトリ名だけで判定しない。credentialを含み得るraw remoteは表示せず、host/owner/repositoryだけへ正規化して報告する。README、`docs/launch-checklist.md`、現在のTalk schema、対象Talk、`package.json`を毎回読む。

Public mirrorには公開許可済みの内容だけを置く。未承認素材、新規Talkの下書き、内部メモを公開リポジトリへ入れない・pushしない。ローカルbranchも秘密保管庫ではないため、秘密情報や実顧客データは書かない。

## 相談から編集まで

ユーザーが非エンジニアなら、パス、port、JSON項目を先に質問しない。調べてから、対象者、変化、成功行動、根拠/素材、持ち帰りの次の未確定事項を一度に1問だけ聞く。

Createでは、A/Bの体験機構と利用する元資料/Talkを提示し、選択と元資料利用の承認後に編集する。新しいslug、イベント名、日付、登壇者、CTA、SEO、診断、素材、出典をコピー元のまま残さない。最初はローカル下書きとし、公開許可まではpublic candidateへ含めない。

Improveでは、最弱点、最も起きそうな離脱、優先改善3点を実画面から示し、範囲承認後に修正する。Review-onlyは評価だけで終わり、修正提案を編集権限と解釈しない。

## HookedとTHAデザイン

- 参加者の変化と成功行動を一つに絞る。
- Trigger → Action → Variable Reward → Investment → Next Triggerを、参加者が持ち帰る価値で接続する。
- ストーリーは問い → 危機 → 反転 → 根拠 → 次の一歩。
- 基本色はwhite、royal blue `#2360F0`、navy `#1F2A44`、yellow `#FFE93C`、support `#F2F6FC`。pink `#E5187D`は危機・警告だけ。
- 写真は共感・証拠・転換のどれか。動きは進行・因果・反応・予兆のどれか。ゲーム性は選択、進行、発見、持ち帰り資産の意味を持つ。
- `prefers-reduced-motion`でも意味と順序が残る。

根拠のない数字、顧客実績、引用、緊急性を作らない。事実、仮説、Unknownを分ける。

## 素材

写真/PDFは、形式・容量・見える機密・metadata・権利・公開表記・altを確認する。元ファイルは変更しない。加工、圧縮、metadata除去には別承認が必要。承認済み素材でも既存ファイルを上書きしない。

## 実画面QA

対象slugと起動portを観測するまでURLはUnknown。実際にserverを起動し、観測したloopback URLだけを報告する。

次を独立して確認する。

1. 内容: audience change、Hooked chain、根拠、倫理、CTA、持ち帰り価値。
2. 画面: desktop `1440×900`、mobile `390×844`、presentation `1920×1080`、reduced motion / `prefers-reduced-motion`。
3. 一連動作: 縦ストーリー、3問診断、4結果、handout、PDF、keyboard、フォームのdisabled/fake状態、外部通信とconsole error。

技術ゲートは順番を変えない。

```text
npm run validate:content
npm run validate:assets
npm test
npm run typecheck
npm run build
npm run verify:static
npm run release:scan -- out
npm run test:e2e
```

失敗または未観測の必須項目があれば公開不可。公開候補を作る場合は、候補自身を依存導入前にscanする。

## フォームと外部操作

既定のGAS/プライバシー設定は空のpairで、フォームは正直にdisabledとなる。実GAS、Sheet、通知trigger、メール、Slackを推測接続しない。診断回答やPIIをanalyticsへ送らない。

commit → push → Pages公開 → GAS → Sheet → メール/autoresponder → Slackは同じ許可ではない。正確な10ゲート、現在の完了状態、事故時対応は `docs/launch-checklist.md` を読む。常に次の未承認ゲートで止まり、対象・差分・検証・残余riskを示して明示承認を待つ。

Public mirrorへのreview branch pushでもソースは公開される。Talk・素材の公開許可がなければpushしない。`main` pushやworkflow dispatchはPages公開を起動し得るため、一般公開承認なしに実行しない。
