# THA Hooked Presentation

THAの登壇体験を、縦方向に物語が進むWebページとして提供するNext.jsプロジェクトです。スマートフォン向けの3問診断、4段階の診断結果、登壇コンテンツ、配布資料を静的ファイルとして書き出します。

## 現在地

- 正規URLの予定は `https://asakonishiyama-tha.github.io/` です。公開リポジトリとGitHub PagesのActions設定は作成済みですが、`main`からの一般公開と正規URLのhosted確認はまだ承認・実行していません。
- 公開対象のTalkは `ai-president-intro` だけです。
- 資料請求・相談フォームは、GASが未設定の通常のローカル確認と現在の公開用ビルドでは送信できません。
- 本番GAS、Sheet、通知trigger、自動返信、Slackは未接続です。ローカルの検証完了やreview branchへのpushは、`main`公開や外部接続を許可しません。
- 詳しい公開手順と承認の境界は [`docs/launch-checklist.md`](docs/launch-checklist.md) にあります。

## 西山社長がCodex / Claude Codeへ頼む方法

技術用語は不要です。自然な日本語で、たとえば次のように依頼します。

```text
$managing-tha-talks を使って、次の地域企業向け登壇を相談したい。
対象者と、聞いた後に起こしたい行動から一緒に整理して。
```

skillは一度に1問だけ確認し、A/Bの体験案、Hookedの流れ、THAらしい色・写真・動き、必要な素材と根拠を整理します。相談、素材追加、新規作成、既存改善、厳格レビューを区別し、commit、push、Pages公開、フォーム有効化を自動的に同じ承認として扱いません。

- Codex共通skill: `.agents/skills/managing-tha-talks/`
- Claude Code入口: `.claude/skills/managing-tha-talks/`

新しいTalkや未承認素材は、ローカルの下書きとして扱います。公開許可前にこのPublicリポジトリへpushしません。

## 最初のローカル確認

必要なものはNode.js 24以降です。初回は、プロジェクトのフォルダで次を上から順にコピーして実行します。

公開候補builderと検証コマンドのサポート対象はPOSIX互換のmacOSまたはLinuxです。Windowsでは、オーナーが承認したPOSIX互換環境（例: WSL2）だけを使用し、PowerShell/CMDへ手順を読み替えて公開しません。

```bash
npm ci
npm run dev
```

ブラウザで `http://localhost:3000/talks/ai-president-intro/` を開きます。確認が終わったら、コマンドを実行した画面へ戻って `Ctrl+C` を押し、ローカルサーバーを止めます。

## CMSを使わないTalk編集

この公開版ではTinaCMSを使いません。CMSなしで、既存のprivate/ローカル作業領域にあるTalk bundleのJSONをテキストエディタで編集します。下書きを公開リポジトリへ直接置かないでください。

`ai-president-intro` の正本は次の8ファイルです。すべての `slug` はフォルダ名と同じ値にします。

- `content/talks/ai-president-intro/manifest.json` — タイトル、登壇者、3問、4結果、フォームとPDFへのリンク
- `content/talks/ai-president-intro/presentation.json` — 縦スクロールで表示する登壇本文
- `content/talks/ai-president-intro/handout.json` — 読み物版の本文
- `content/talks/ai-president-intro/evidence.json` — 根拠と確認日
- `content/talks/ai-president-intro/worksheets/explore.json` — 探索期のアクションシート
- `content/talks/ai-president-intro/worksheets/experiment.json` — 実験期のアクションシート
- `content/talks/ai-president-intro/worksheets/systemize.json` — 仕組み化期のアクションシート
- `content/talks/ai-president-intro/worksheets/integrate.json` — 経営統合期のアクションシート

編集するときは次の順番で進めます。

1. 既存のprivate/ローカル作業領域で対象JSONを開きます。
2. 事実、数値、ロゴ、写真は、出典と公開許可が確認できたものだけを使います。確認できない内容は推測で補いません。
3. JSONの二重引用符とカンマを崩さないように保存します。
4. 下の「静的版の確認」を行い、エラーが1件でも出たら公開準備を止めます。

新しいTalkの下書きを作る場合は、まず管理者と英小文字・数字・ハイフンだけのslugを決めます。既存bundleをprivate/ローカル作業領域内で複製し、8ファイルすべての `slug` を新しいフォルダ名へ変更して、`manifest.json` の `published` を `false` にします。`published: false` は秘密保持機能ではないため、その下書きを公開候補や公開リポジトリへコピーしてはいけません。新しいTalkを公開対象へ加える作業は、Talk公開の個別承認と開発者による公開境界の更新が必要です。

## 承認済み素材を置く場所

承認済み素材は `content/talks/ai-president-intro/assets/` の中だけへ置きます。

- PDF: `content/talks/ai-president-intro/assets/downloads/`
- 画像・短い動画: `content/talks/ai-president-intro/assets/media/`

JSONからは `/downloads/ファイル名.pdf` または `/media/ファイル名.拡張子` として参照します。`public/` へ直接ファイルを追加しないでください。`npm run dev` と `npm run build` の前処理が、公開Talkから実際に参照される承認済み素材だけを `public/` に作り直します。参照されない素材、シンボリックリンク、許可外形式、容量超過素材がある場合は検証が止まります。

素材の上限は次のとおりです。

- 画像: 横幅2,400px以下、1.5MB以下
- 背景動画: 12秒以下、15MB以下
- 配布PDF: 20MB以下

## 静的版の確認

編集後は、ローカルの開発画面だけでなく、GitHub Pagesへ出すものと同じ静的ファイルも確認します。

```bash
npm run build
npm run verify:static
npm run preview:static
```

ブラウザで `http://127.0.0.1:3000/talks/ai-president-intro/` を開きます。確認が終わったら `Ctrl+C` で静的プレビューを止めます。`out/` は生成物なので手作業で編集しません。

## フォームとローカルfake GAS

本番既定値は `NEXT_PUBLIC_GAS_WEB_APP_URL` と `NEXT_PUBLIC_PRIVACY_POLICY_URL` の両方が空です。この空の組み合わせではフォーム送信を無効にし、「受付機能は準備中です」と正直に表示します。片方だけ、または形式が不正な組み合わせはbuildを失敗させ、ブラウザでもfail closedにします。プライバシーURLを推測・創作してはいけません。

本番で許可するGAS URLは、`https://script.google.com/macros/s/<承認済みの安全なdeployment-id>/exec` と完全一致する形式だけです。別origin、`www` alias、credential、query、fragment、末尾slashは拒否します。HTTPはローカル/testのliteral loopbackだけで許可し、ローカル確認のために実GASのURLを入れないでください。

`npm run test:e2e` は別ポートのloopbackだけで動くfake GASを自動起動し、テスト終了時に止めます。fake GASは実GAS、Sheet、メール、Slackへ接続せず、テスト用の受付をメモリ内だけに保持します。fake GASでは `saved`（保存確認後だけ受付完了とPDFを表示）と `timeout`（成功やPDFを表示しない）の両方を確認します。

```bash
npm run test:e2e
```

## 環境設定

`.env.example` には、ブラウザへ公開してよい次の3項目だけを置きます。

- `NEXT_PUBLIC_SITE_URL`: パス・クエリ・フラグメントを含まない公開サイトのHTTP(S)オリジン
- `NEXT_PUBLIC_PRIVACY_POLICY_URL`: 既定は空（blank）。ゲート7で承認された絶対HTTPSプライバシーURLだけを設定
- `NEXT_PUBLIC_GAS_WEB_APP_URL`: 既定は空（blank）。ゲート7で承認された正確なGoogle Apps Script Web App URLだけを設定

GASの公開URL自体は秘密情報ではありません。Google Sheet ID、Slack Webhook、メール送信設定などの秘密情報は、このリポジトリや公開環境変数へ置かず、将来承認されたGASのScript Propertiesだけで管理します。

GitHub Pagesのフォーム有効化は、ゲート7で2つのrepository variablesを同時に設定し、レビュー済み`main`の`workflow_dispatch`を実行して8ゲートとhosted verifierを通す場合だけ行います。通常のbuild、片方だけの設定、非`main` dispatchに有効化経路はありません。

## 計測

画面計測は個人情報を送りません。イベント名、Talk ID、必要な診断ステージだけを使い、同じタブの同じセッションでは同一イベントを一度だけ記録します。流入情報は外部参照元のオリジンとパス、`utm_source`、`utm_medium`、`utm_campaign`だけを保持し、会社名・氏名・メールアドレスはブラウザへ保存しません。
