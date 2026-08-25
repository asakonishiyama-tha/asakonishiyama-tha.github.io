# THA登壇サイト ローンチチェックリスト

この文書は、公開担当者が「次に何をしてよいか」「どこで止めるか」を判断するための手順書です。上から順番に進め、分からない項目や失敗が1つでもあれば止めて責任者へ相談してください。

## 公開先と現在地

- オーナー: `asakonishiyama-tha`
- リポジトリ: `asakonishiyama-tha/asakonishiyama-tha.github.io`
- 公開設定: `Public`
- 公開ブランチ: `main`
- 正規URL: `https://asakonishiyama-tha.github.io/`
- 公開Talk: `ai-president-intro` と `long-lived-companies`
- 現在: 公開リポジトリ、GitHub Pages、`main`公開、hosted確認まで完了しています（ゲート1〜5は実施済み）。本番GAS、Sheet、自動返信、Slackは未構成・未接続で、ゲート6〜10は未承認のままブロックします。

2つのTalkの `manifest.json` は承認済み公開物として `published: true` です。今後のTalk追加では、この値、ローカルcommit、テスト成功のどれも、新しいpushや公開の許可を意味しません。

## 作業を始める前の確認

- [ ] 公開候補builderと検証は、サポート対象のPOSIX互換macOSまたはLinuxで行う。Windowsではオーナー承認済みのPOSIX互換環境（例: WSL2）だけを使い、PowerShell/CMDへ手順を読み替えない。
- [ ] Node.js 24以降を使っている。
- [ ] 作業場所は既存のprivate/ローカル作業領域で、公開候補の中ではない。
- [ ] 下書きは既存のprivate/ローカル作業領域だけに置き、公開リポジトリや公開候補へコピーしない。
- [ ] 素材の出典と公開許可を確認した。確認できない写真、ロゴ、動画、PDF、顧客情報は使わない。
- [ ] `.env`、Sheet ID、Slack Webhook、メール設定、個人情報をソースへ入れていない。

Talkの追加・編集方法、8つのbundleファイル、素材の置き場所はREADMEの「CMSを使わないTalk編集」と「承認済み素材を置く場所」を参照してください。TinaCMSはこの公開版にありません。新規Talkは `published: false` の下書きとしてprivate/ローカル作業領域に保ち、承認前に公開境界へ加えません。

## ローカルプレビュー

初回または依存関係が変わった後は、プロジェクトのフォルダで次を実行します。

```bash
npm ci
npm run dev
```

`http://localhost:3000/talks/ai-president-intro/` と `http://localhost:3000/talks/long-lived-companies/` を開き、本文、3問診断、4結果、handoutへの導線を確認します。本番既定は `NEXT_PUBLIC_GAS_WEB_APP_URL` と `NEXT_PUBLIC_PRIVACY_POLICY_URL` の両方が空で、この組み合わせではフォームが「準備中」となり送信できないのが正しい状態です。片方だけ、または不正な値はfail closedです。確認後は `Ctrl+C` で止めます。

## 静的プレビュー

GitHub Pagesへ出す形式を確認します。

```bash
npm run build
npm run verify:static
npm run preview:static
```

`http://127.0.0.1:3000/talks/ai-president-intro/` と `http://127.0.0.1:3000/talks/long-lived-companies/` を開きます。`out/` を手作業で直してはいけません。確認後は `Ctrl+C` で止め、ポート3000にローカルサーバーが残っていないことを確認します。

## 公開候補を作る

次の3行は、元のprivate/ローカル作業領域で上から順に実行します。作成先は毎回新しい空の一時フォルダです。

```bash
tha_candidate_dir=$(mktemp -d /private/tmp/tha-public-candidate.XXXXXX)
npm run release:prepare -- --output "$tha_candidate_dir"
npm run release:scan -- "$tha_candidate_dir"
```

公開候補に含まれてよいのは、公開用アプリ、`ai-president-intro` と `long-lived-companies` の各8つのJSON、参照中の8つのPDFと2つのWebP、GASソース、テスト、CI/Pages workflow、README、このチェックリスト、lockfile、release検査ツールです。過去履歴、内部計画、下書きTalk、未参照素材、`.env`、秘密情報、生成済み `out/` は入りません。

この時点ではまだローカルGitを作りません。`git init` より前の公開候補に、元の作業領域からコピーされた `.git` がないこと（不在）を確認します。もしあれば、その候補を使わず中止します。

`release/public-files.json` はこのチェックリストを正確な `docs/launch-checklist.md` だけで許可します。`docs` や `.github` フォルダ全体を許可してはいけません。

## クリーンルーム確認

「元の作業領域にしかないファイルへ偶然依存していない」ことを確かめるため、作った公開候補自身だけで確認します。ここで作るGitはローカル専用で、remoteを追加しません。

```bash
cd "$tha_candidate_dir"
npm run release:scan -- .
test ! -e .git
git init -b rehearsal-main
git remote -v
git add --all
npm ci
git check-ignore node_modules/
git ls-files node_modules
git status --short
git ls-files
```

候補自身のscanである `npm run release:scan -- .` は、外部ライブラリを入れる `npm ci` より前に実行し、検出0件を確認します。`test ! -e .git` は何も表示せず終了するのが正解で、元から `.git` があれば失敗します。その後だけローカルGitを初期化します。

ここで `git init` が作成する `.git` は、履歴を外からコピーしたものではなく、追跡一覧を調べるために意図して生成する正常なローカル専用メタデータです。生成後の `.git` は `git remote -v` が空（何も表示しない）の間だけ許可します。remoteを追加せず、commitもpushもしません。

`node_modules/` は公開ソースではなく、`.gitignore` でignoreされて追跡されない状態が正解です。`git check-ignore node_modules/` は `node_modules/` を表示し、`git ls-files node_modules` は何も表示しなければ合格です。`release/public-files.json` に `node_modules` はなく、公開候補を作るbuilderもコピーしません。`git status --short` と `git ls-files` を保存し、候補の全ソースが追跡対象になっていることも確認します。

## 順番を変えないリリースゲート

以下の8コマンドは、元の作業領域とクリーンルーム候補の両方で、必ずこの順番で実行します。前のコマンドが成功するまで次へ進みません。

```bash
npm run validate:content
npm run validate:assets
npm test
npm run typecheck
npm run build
npm run verify:static
npm run release:scan -- out
npm run test:e2e
```

公開候補の準備と候補自身の安全検査は、この8ゲートより前に必要です。`npm run build` は8つのPDFと2つのWebPを `public/` へ準備して静的サイトを `out/` へ書き出し、`npm run verify:static` と `npm run release:scan -- out` が静的出力を検査します。`npm run test:e2e` はloopbackのローカルサーバーとfake GASだけを使います。

## ブラウザQA

### 最初に安定した自動確認

手作業より先に、元の作業領域とクリーンルーム候補の両方で次を実行します。

```bash
npm run test:e2e
```

この自動確認が、両Talk、3問診断、4結果、handout、モバイルとプロジェクター幅、キーボード操作、reduced motion、8つのPDF、loopback fake GASの保存・timeout、横スクロールを毎回同じ条件で検査します。終了コードが0でない、または1件でも失敗したら、手作業で埋め合わせず中止して開発担当へ相談します。

### 手作業の画面確認

自動確認の後、ChromeまたはEdgeを使える担当者が次を上から行います。スクリーンショットと結果は公開候補や追跡対象ソースに入れず、承認担当者が指定した非公開の証跡フォルダへ保存します。

1. クリーンルーム候補で `npm run preview:static` を実行し、2つのTalk（`/talks/ai-president-intro/` と `/talks/long-lived-companies/`）を開きます。
2. 開発者ツールを `F12`（または右クリック→検証）で開き、端末ツールバーの `Responsive` を選びます。幅と高さを下表どおり数字で入力し、ズームは100%にします。
3. 各サイズでTalkを先頭から最後までスクロールし、「会社に、もう一人の社長がいたら。」、`01 / THE TURN`、`02 / KNOWLEDGE LOOP`、`03 / 60 SEC QUEST`、`NEXT / KEEP THE KNOWLEDGE` の5場面を1枚ずつ確認します。

| 用途 | 幅×高さ | 確認すること |
|---|---:|---|
| デスクトップ | `1440×900` | 見出し、本文、CTA、診断、結果、フォームが読みやすく、横スクロールや重なりがない |
| モバイル | `390×844` | 文字と操作部品が画面外へ出ず、タップ対象が重ならず、横スクロールがない |
| プロジェクター | `1920×1080` | 見出し、本文、CTAを離れた位置から読め、余白や改行が不自然でない |

4結果は `/talks/ai-president-intro/quest/` を毎回開き直し、次のように各列の選択肢を3つ選んで「診断結果を見る」を押します。

| 表示する結果 | 1問目 | 2問目 | 3問目 |
|---|---|---|---|
| `探索期` | まだ利用していない | 再利用できるものは残っていない | 必要なときだけ各自で使う |
| `実験期` | 個人の業務効率化で利用している | 個人のプロンプトやメモが残っている | 推進する担当者がいる |
| `仕組み化期` | 部門の仕組みとして利用している | チームで使える手順や知識が残っている | 共有ルールと定期的な振り返りがある |
| `経営統合期` | 経営判断にも利用している | 判断記録と採否理由が会社の資産として残っている | 経営指標と改善サイクルに組み込まれている |

キーボード確認ではマウスに触れず、`Tab` と `Shift+Tab` で戻る・進む、`Space` で選択、`Enter` でリンクやボタンを実行します。3問、結果、フォームを順に移動し、現在位置のfocus枠が常に見えることを確認します。通常の静的プレビューはGAS未設定なので、送信ボタンが無効なのが正解です。

reduced motionは開発者ツールの「More tools → Rendering」でCSS media featureを `prefers-reduced-motion: reduce` にし、再読み込み後に5場面をスクロールします。文字やCTAは表示されたまま、非本質的な移動・拡大アニメーションが止まることを確認します。

両Talkの `/handout/` を開いて内容が読めることを確認し、下表の8PDFを別々に開きます。すべてブラウザ内でPDFとして開き、白紙や破損表示にならないことを確認します。HTTP形式とSHA-256は自動ゲートと下表でも照合します。

開発者ツールの `Console` を空にして再読み込みし、赤いerrorが0件であることを確認します。次に `Network` を空にして再読み込みし、通常プレビューでは `127.0.0.1:3000` 以外のHTTP(S)通信がないことを確認します。実GAS、Sheet、メール、Slackへは接続しません。

fake GASの `saved` と `timeout` の実ブラウザ確認は、指定QA担当者が公開候補外の非公開QAハーネスで行います。`saved` は保存確認後だけ受付完了と2つのダウンロードを表示し、`timeout` は再試行案内を表示して成功・受付完了・ダウンロードを表示しないことを別々に確認します。許可する通信先は静的サイトとfake GASのloopback 2オリジンだけです。

指定QA担当者の非公開QAハーネス、設定、結果、スクリーンショットは公開候補や追跡対象ソースへ入れたりコピーしたりしないでください。通常担当者が開発者ツールを使えない、正確なviewportを作れない、`Console` / `Network` を判断できない、または非公開QAハーネスを利用できない場合は、公開作業を中止して指定QA担当者へエスカレーションします。近い画面サイズでの目視や実GAS接続で代用しません。

最後に `Ctrl+C` で静的プレビューを止め、ポート3000にlistenerが残っていないことを指定QA担当者が確認します。

fake GASはloopbackだけで動き、実GAS、Sheet、メール、Slackへ接続しません。受付はメモリ内のテストデータで、終了時に消えます。これは本番保存や通知の確認ではありません。

### PDF SHA-256

| PDF | bundle内の正本 | `public/`へ生成後 | SHA-256 |
|---|---|---|---|
| `ai-philosophy-for-smb.pdf` | `content/talks/ai-president-intro/assets/downloads/ai-philosophy-for-smb.pdf` | `public/downloads/ai-philosophy-for-smb.pdf` | `8fb7825ad1fe2fdd12c48d5d75453b17b59d7b8668f1ba60920f9625aff86850` |
| `tha-ai-management-action-sheet.pdf` | `content/talks/ai-president-intro/assets/downloads/tha-ai-management-action-sheet.pdf` | `public/downloads/tha-ai-management-action-sheet.pdf` | `1daf899cd4a6fdffbf8439b456f9218a7b62ef6ca43f609a218e4ffad3e1db99` |
| `long-lived-companies-experiment.pdf` | `content/talks/long-lived-companies/assets/downloads/long-lived-companies-experiment.pdf` | `public/downloads/long-lived-companies-experiment.pdf` | `1f70632d9d5d95292510c0b64b22ddbb9922cf2777125f9df77a41e311293680` |
| `long-lived-companies-explore.pdf` | `content/talks/long-lived-companies/assets/downloads/long-lived-companies-explore.pdf` | `public/downloads/long-lived-companies-explore.pdf` | `827e80ef3034f4882a979b10f5b4a9833b1f725a5c31ac065b6717d03db51d20` |
| `long-lived-companies-handout.pdf` | `content/talks/long-lived-companies/assets/downloads/long-lived-companies-handout.pdf` | `public/downloads/long-lived-companies-handout.pdf` | `e60dfbd48655e125ab4ec37e398cab66ed3625caca4a8d275b4c28e02cfae214` |
| `long-lived-companies-integrate.pdf` | `content/talks/long-lived-companies/assets/downloads/long-lived-companies-integrate.pdf` | `public/downloads/long-lived-companies-integrate.pdf` | `07a9f07ad7957e61389d04bece52670317a9adcfe430e9a8997d1151bbf19275` |
| `long-lived-companies-systemize.pdf` | `content/talks/long-lived-companies/assets/downloads/long-lived-companies-systemize.pdf` | `public/downloads/long-lived-companies-systemize.pdf` | `00909ae94eed37cc2f1921e19798a553337ec50280c2b32898f8d627cd2f19ed` |
| `long-lived-companies-talk.pdf` | `content/talks/long-lived-companies/assets/downloads/long-lived-companies-talk.pdf` | `public/downloads/long-lived-companies-talk.pdf` | `a995f8747bbe8891738501dc8d925ff413b5a9aba8fa9fd30abd5b802c32a3c4` |

bundle内の正本、生成後の `public/downloads/`、静的出力 `out/downloads/` の3か所が同じSHA-256であることを毎回確認します。値が違えば公開を止めます。

## Git追跡対象と証跡

クリーンルーム候補でゲートが終わったら、追跡対象とremoteが変わっていないことをもう一度確認します。commit、remote、push、公開は行いません。

```bash
git status --short
git ls-files
git ls-files node_modules
git remote -v
```

元の作業領域とクリーンルームの結果は混ぜず、別々のログとして公開候補の外に保存し、承認画面に添付します。

- 公開候補の全ファイル一覧、件数、合計バイト数、全ファイルのSHA-256一覧と集約SHA-256
- `git status --short`、`git ls-files`、空だった `git remote -v`
- 8ゲートそれぞれのログ。各ログに、正確なコマンド、開始時刻、終了時刻、所要時間、終了コード、テスト件数などの主要出力を残す
- 候補自身のsource scanログと、生成した `out/` のscanログ（どちらも検出件数を残す）
- ブラウザQAの結果とスクリーンショット
- 8つのPDFについて、bundle、`public/`、`out/`それぞれのSHA-256
- オーナー、リポジトリ名、Public、`main`、正規URL、公開Talk

ログに秘密情報、個人情報、実GAS URL、Sheet ID、Slack Webhookを含めません。ログやスクリーンショットを公開候補や追跡対象ソースへ入れたり保存したりしないでください。

証跡を候補外へ保存できた後だけ、一時候補の絶対パスが `/private/tmp/tha-public-candidate.` で始まることを目視確認し、その候補だけを削除します。パスが空、異なる、分からない場合は削除せず責任者へ相談します。

## 止める・相談する条件

次のどれか1つでも当てはまれば、その場で中止し、公開責任者または開発担当へエスカレーションします。

- コマンドの終了コードが0でない、テストが1件でも失敗した、またはscanが1件でも検出した。
- `git init` より前の公開候補に、コピー済みの `.git` があれば中止して相談する。
- `git init` 後に `git remote -v` が空でない表示になった、または意図しない履歴・remoteがある。
- PDFのSHA-256、ファイル件数、追跡対象一覧が証跡と一致しない。
- 対象repo/visibility/branch/URLが予定と違う。
- ブラウザにコンソール/page error、未承認通信、focus不良、横スクロール、重なり、読みにくさがある。
- 実GAS、Sheet、メール、Slack、GitHubへ接続・書き込みしないと先へ進めない。
- 写真・ロゴ・文言・個人情報・ライセンスの公開許可が分からない。
- 一時候補の削除対象パスを確信できない。

不具合をその場しのぎで `out/` や公開候補へ直接修正せず、private/ローカルの正本へ戻って修正し、公開候補の作成からやり直します。

## ロールバック（元に戻す）

### まだ外部公開していない場合

1. その場で止め、pushや設定変更をしない。
2. エディタの履歴、または開発担当による通常のrevert commitで、private/ローカルの正本を直前の確認済み状態へ戻す。
3. 新しい空の公開候補を作り直し、候補自身のscanと8ゲートを最初から行う。
4. 新しい証跡を提示し、必要な外部承認を改めて待つ。

### 将来GitHub Pages公開後に問題が見つかった場合

通常の製品不具合・コード回帰では、開発担当が通常のrevertまたは修正commitを作り、候補scanと8ゲートをすべて通し、保護された`github-pages` environmentのreviewer承認を含む必要な外部承認を得てから`main`へ反映します。履歴を書き換えるforce pushは使いません。

秘密情報（secret）または個人情報（PII）が疑われる場合は通常ロールバックとして扱いません。pushを直ちに停止し、漏えいしたcredentialを最初にrotate（更新）またはrevoke（失効）し、セキュリティ担当とprivacy（プライバシー）担当の両方へ通知します。通常のrevertはGit historyから秘密情報を消さないため、それだけで解決済みにしてはいけません。

影響確認中のcontainment（封じ込め）やPagesの非公開化・公開停止は、対象と影響を提示した明示的な最終承認を得てから行います。その後、GitHubの公式手順に従って履歴をremediationし、clone（クローン）、fork（フォーク）、cache（キャッシュ）、Pull Request参照への残存と再流入を調整します。

- GitHub公式: <https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository>
- GitHub公式: <https://docs.github.com/en/code-security/tutorials/remediate-leaked-secrets/remediating-a-leaked-secret>

公開repoとPagesは構成済みです。実GAS、Sheet、メール、Slackは未構成なので、それらを含むホスト済みロールバック動作はまだ検証していません。

## 依存関係セキュリティの公開保留

2026-08-24時点の`npm audit`は3 High / 0 Criticalです。脆弱ノードは `next@15.5.23` → `postcss@8.4.31` と `next@15.5.23` → `sharp@0.34.5` で、直接dev依存の`sharp@0.35.3`やVitest/Vite側の`postcss@8.5.26`とは別です。

提案される修復先は `next@16.3.2` でsemver-major（メジャー）です。自動または無審査でupgradeしません。2026-08-25に、フォーム無効・静的配信だけの公開について3 High / 0 Criticalの既知リスクを受容して公開しました。依存更新は別作業でレビューし、フォーム有効化時には再評価します。

## ライセンスの境界

既存の `package.json` のlicenseメタデータは `ISC` のままです。standalone LICENSEや単独のライセンス文書は存在せず、新設・変更していません。公開前に別の法的文書が必要かどうかは、オーナー/法務による別途の判断です。ローカル検証やrepo作成承認から法的判断を推測しません。

## 10個の外部承認ゲート

次の10件は今後も再利用する承認テンプレートです。現在地は上の「公開先と現在地」を正とし、それぞれ別の最終承認として前の承認から次を推測しません。

1. [ ] **公開リポジトリ作成**
2. [ ] **Talk・公開対象ソース・正確な素材/PDF・`published: true`の公開許可**
3. [ ] **公開ソースの初回push**
4. [ ] **GitHub Pages有効化と保護された`github-pages` environment/reviewer設定**
5. [ ] **レビュー済み`main`からの初回一般公開の承認・実行**
6. [ ] **GAS Web App公開**
7. [ ] **Sheet実接続・通知processor trigger設置/検証・repository variables設定・レビュー済み`main`だけのフォーム有効化deploy**
8. [ ] **自動返信有効化**
9. [ ] **Slack宛先・本文確定**
10. [ ] **Slack Webhook有効化**

ゲート7では新しい空の21列Sheetタブ（末尾は`phone,deleteAfter`）を実接続し、大島を暫定データ責任者として、1年後の`deleteAfter`を月次確認・手動削除する運用を確認します。自動削除は設定しません。削除依頼窓口は`info@tha-inc.com`です。続いて`processPendingLeadNotifications`のtime-driven triggerを設置して検証します。ゲート7では承認済みrepository variablesとして`NEXT_PUBLIC_GAS_WEB_APP_URL`と`NEXT_PUBLIC_PRIVACY_POLICY_URL=https://ai-syacho.com/policy`を同時に設定します。ゲート7のフォーム有効化はレビュー済み`main`の`workflow_dispatch`によるdeployだけで行い、非`main` refは全jobがskipします。フォーム有効化前に依存監査の3 High / 0 Criticalを改めて評価し、オーナーの受容またはレビュー済み更新判断を記録します。

ゲート8は自動返信（autoresponder）の有効化だけです。実行直前に、宛先ルール、送信者`THA / AI社長`、reply-to `info@tha-inc.com`、件名と本文全文を提示して最終承認を得ます。ゲート9はSlack宛先`tha_問い合わせフォーム通知`と、会社名・氏名・Talk・診断結果・相談テーマ・受付日時・Sheetリンクだけを含む本文の再確認です。メールと電話番号は含めません。ゲート10はSlack Webhookの有効化です。ゲートNはN+1（次のゲート）を承認しないため、完了から次の操作を推測しません。

commitやローカル検証は、外部操作を一切承認しません。repo作成、Talk/素材公開、push、Pages、一般公開、GAS、Sheet/trigger/repository variables、フォーム、自動返信、Slackは、該当ゲートの対象と変更内容を提示して明示的な最終承認を得るまで実行しません。

## 引き継ぎ時の承認依頼

ゲート1〜5は実施済みです。次に外部接続を行う場合も、ゲート6〜10を個別に承認し、フォームを有効にするゲート7ではGASとプライバシーURLを同時に設定してhosted verifierを通します。

## 今回確認できないこと

ホスト済みGitHub Pagesの表示は確認済みです。実GAS Web App、実Sheet保存、実メール自動返信、実Slack通知は確認していません。これらを「確認済み」と報告しません。
