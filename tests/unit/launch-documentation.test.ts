import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

const publicLaunchDocuments = [
  "README.md",
  "docs/launch-checklist.md",
] as const;

const internalAuthoritativeLaunchDocuments = [
  "docs/superpowers/specs/2026-08-23-github-pages-launch-design.md",
  "docs/superpowers/plans/2026-08-23-gas-lead-pipeline.md",
  "docs/superpowers/plans/2026-08-23-pages-release.md",
  "docs/superpowers/plans/2026-08-23-static-site-migration.md",
] as const;

const publicFormVariableNames = [
  "NEXT_PUBLIC_GAS_WEB_APP_URL",
  "NEXT_PUBLIC_PRIVACY_POLICY_URL",
] as const;

const retiredPrivacyUrl = ["https://tha-inc.com", "privacy"].join("/");

const expectedTalkFiles = [
  "content/talks/ai-president-intro/manifest.json",
  "content/talks/ai-president-intro/presentation.json",
  "content/talks/ai-president-intro/handout.json",
  "content/talks/ai-president-intro/evidence.json",
  "content/talks/ai-president-intro/worksheets/explore.json",
  "content/talks/ai-president-intro/worksheets/experiment.json",
  "content/talks/ai-president-intro/worksheets/systemize.json",
  "content/talks/ai-president-intro/worksheets/integrate.json",
] as const;

const exactApprovalGates = [
  "公開リポジトリ作成",
  "Talk・公開対象ソース・正確な素材/PDF・`published: true`の公開許可",
  "公開ソースの初回push",
  "GitHub Pages有効化と保護された`github-pages` environment/reviewer設定",
  "レビュー済み`main`からの初回一般公開の承認・実行",
  "GAS Web App公開",
  "Sheet実接続・通知processor trigger設置/検証・repository variables設定・レビュー済み`main`だけのフォーム有効化deploy",
  "自動返信有効化",
  "Slack宛先・本文確定",
  "Slack Webhook有効化",
] as const;

const orderedQualityGates = [
  "npm run validate:content",
  "npm run validate:assets",
  "npm test",
  "npm run typecheck",
  "npm run build",
  "npm run verify:static",
  "npm run release:scan -- out",
  "npm run test:e2e",
] as const;

const requiredOperatorCommands = [
  "npm ci",
  "npm run dev",
  "npm run build",
  "npm run preview:static",
  "npm run verify:static",
  "npm run test:e2e",
  "tha_candidate_dir=$(mktemp -d /private/tmp/tha-public-candidate.XXXXXX)",
  "npm run release:prepare -- --output \"$tha_candidate_dir\"",
  "npm run release:scan -- \"$tha_candidate_dir\"",
] as const;

const expectedPdfHashes = {
  "ai-philosophy-for-smb.pdf": "8fb7825ad1fe2fdd12c48d5d75453b17b59d7b8668f1ba60920f9625aff86850",
  "tha-ai-management-action-sheet.pdf": "1daf899cd4a6fdffbf8439b456f9218a7b62ef6ca43f609a218e4ffad3e1db99",
} as const;

async function readRepositoryFile(relativePath: string): Promise<string> {
  try {
    return await readFile(path.join(repositoryRoot, relativePath), "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`Missing launch documentation: ${relativePath}`);
    }
    throw error;
  }
}

async function repositoryPathExists(relativePath: string): Promise<boolean> {
  try {
    await access(path.join(repositoryRoot, relativePath));
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function markdownSection(source: string, heading: string): string {
  const start = source.indexOf(`${heading}\n`);
  if (start === -1) throw new Error(`Missing markdown section: ${heading}`);
  const rest = source.slice(start + heading.length + 1);
  const nextHeading = rest.search(/^## /m);
  return nextHeading === -1 ? rest : rest.slice(0, nextHeading);
}

function shellCommands(source: string): string[] {
  return [...source.matchAll(/^```(?:bash|text)?\n([\s\S]*?)^```$/gm)]
    .flatMap((match) => match[1]!.split("\n"))
    .map((line) => line.trim())
    .filter(Boolean);
}

function documentedQualityGateCommands(source: string): string[] {
  return shellCommands(source);
}

function publicFormAssignmentBlocks(source: string): Array<Record<string, string>> {
  return [...source.matchAll(/^```[^\n]*\n([\s\S]*?)^```$/gm)]
    .map((match) => Object.fromEntries(
      [...match[1]!.matchAll(/^(NEXT_PUBLIC_(?:GAS_WEB_APP_URL|PRIVACY_POLICY_URL))=(.*)$/gm)]
        .map((assignment) => [assignment[1]!, assignment[2]!.trim()]),
    ))
    .filter((assignments) => publicFormVariableNames.some((name) => name in assignments));
}

describe("non-engineer launch documentation", () => {
  it("explains how to edit and preview the only approved Talk without a CMS", async () => {
    const readme = await readRepositoryFile("README.md");

    expect(readme).toContain("https://asakonishiyama-tha.github.io/");
    expect(readme).toMatch(/公開対象(?:のTalk)?は[^\n]*`ai-president-intro`[^\n]*(?:だけ|のみ)/);
    expect(readme).toMatch(/TinaCMS[^\n]*(?:使いません|ありません|利用しません)/);
    expect(readme).toMatch(/CMS[^\n]*(?:使わず|なし|不要)/);
    for (const file of expectedTalkFiles) expect(readme).toContain(`\`${file}\``);
    expect(readme).toContain("`content/talks/ai-president-intro/assets/`");
    expect(readme).toMatch(/`public\/`[^\n]*(?:直接|手作業)[^\n]*(?:置か|追加し|コピーし).*ない/);
    for (const command of ["npm ci", "npm run dev", "npm run build", "npm run preview:static"]) {
      expect(readme).toContain(command);
    }
    expect(readme).toMatch(/NEXT_PUBLIC_GAS_WEB_APP_URL[^\n]*(?:空|未設定)[^\n]*(?:送信|フォーム)[^\n]*(?:無効|できません)/);
    expect(readme).toMatch(/npm run test:e2e[^\n]*(?:loopback|ループバック)[^\n]*fake GAS/i);
    expect(readme).toMatch(/fake GAS[^\n]*(?:saved|保存済み)[^\n]*(?:timeout|タイムアウト)/i);
  });

  it("lists the exact target and all ten separately blocked approvals in order", async () => {
    const checklist = await readRepositoryFile("docs/launch-checklist.md");
    const approvalSection = markdownSection(checklist, "## 10個の外部承認ゲート");
    const approvalLines = [...approvalSection.matchAll(/^(\d+)\. \[ \] \*\*(.+)\*\*$/gm)]
      .map((match) => ({ number: Number(match[1]), title: match[2] }));

    expect(checklist).toContain("`asakonishiyama-tha/asakonishiyama-tha.github.io`");
    expect(checklist).toContain("`https://asakonishiyama-tha.github.io/`");
    expect(checklist).toContain("公開設定: `Public`");
    expect(checklist).toContain("公開ブランチ: `main`");
    expect(checklist).toMatch(/初回(?:公開)?Talk:[^\n]*`ai-president-intro`[^\n]*(?:だけ|のみ)/);
    expect(approvalLines).toEqual(exactApprovalGates.map((title, index) => ({
      number: index + 1,
      title,
    })));
    expect(checklist).toMatch(/今回[^\n]*承認[^\n]*ゲート1[^\n]*(?:だけ|のみ)/);
    expect(checklist).toMatch(/ゲート2(?:〜|～|-)10[^\n]*(?:未承認|ブロック)/);
    expect(checklist).toMatch(/commit[^\n]*(?:外部操作|push|公開)[^\n]*(?:一切承認しません|承認になりません)/i);
  });

  it("assigns activation and notification ownership to gates 7 through 10 without an implicit action", async () => {
    const checklist = await readRepositoryFile("docs/launch-checklist.md");

    expect(checklist).toMatch(/ゲート7[^\n]*(?:Sheet|シート)[^\n]*(?:processPendingLeadNotifications|通知processor)/i);
    expect(checklist).toMatch(/ゲート7[^\n]*(?:trigger|トリガー)[^\n]*(?:設置|追加)[^\n]*(?:検証|確認)/i);
    expect(checklist).toMatch(/ゲート7[^\n]*(?:repository variables|リポジトリ変数)[^\n]*(?:NEXT_PUBLIC_GAS_WEB_APP_URL|GAS)/i);
    expect(checklist).toMatch(/ゲート7[^\n]*`main`[^\n]*(?:workflow_dispatch|手動)[^\n]*(?:deploy|デプロイ)/i);
    expect(checklist).toMatch(/ゲート8[^\n]*(?:自動返信|autoresponder)[^\n]*(?:だけ|のみ)/i);
    expect(checklist).toMatch(/ゲート9[^\n]*Slack[^\n]*(?:宛先|target)[^\n]*(?:本文|body)/i);
    expect(checklist).toMatch(/ゲート10[^\n]*Slack[^\n]*Webhook/i);
    expect(checklist).toMatch(/ゲートN[^\n]*(?:N\+1|次のゲート)[^\n]*(?:承認しない|承認にならない|推測しない)/i);
  });

  it("gives copy-pasteable preparation, ordered verification, rollback, and escalation steps", async () => {
    const checklist = await readRepositoryFile("docs/launch-checklist.md");
    const gateSection = markdownSection(checklist, "## 順番を変えないリリースゲート");
    const cleanRoomSection = markdownSection(checklist, "## クリーンルーム確認");
    const gateCommands = documentedQualityGateCommands(gateSection);
    const cleanRoomCommands = shellCommands(cleanRoomSection);

    for (const command of requiredOperatorCommands) expect(checklist).toContain(command);
    expect(gateCommands).toEqual(orderedQualityGates);
    expect(cleanRoomCommands).toEqual([
      "cd \"$tha_candidate_dir\"",
      "npm run release:scan -- .",
      "test ! -e .git",
      "git init -b rehearsal-main",
      "git remote -v",
      "git add --all",
      "npm ci",
      "git check-ignore node_modules/",
      "git ls-files node_modules",
      "git status --short",
      "git ls-files",
    ]);
    expect(cleanRoomSection).toMatch(/候補自身[^\n]*scan[^\n]*`npm ci`[^\n]*前/);
    expect(cleanRoomSection).toMatch(/`node_modules\/`[^\n]*(?:ignore|無視)[^\n]*(?:追跡されない|追跡対象外)/i);
    expect(checklist).toMatch(/候補[^\n]*(?:内|自身)[^\n]*(?:release:scan|scan-release-safety)/);
    expect(checklist).toMatch(/ロールバック|元に戻す/);
    expect(checklist).toMatch(/中止|止める/);
    expect(checklist).toMatch(/エスカレーション|責任者[^\n]*相談/);
    expect(checklist).toMatch(/下書き[^\n]*(?:非公開|private|ローカル)[^\n]*(?:公開リポジトリ|公開候補)[^\n]*(?:入れ|コピーし).*ない/i);
  });

  it("separates ordinary rollback from secret or PII incident containment", async () => {
    const checklist = await readRepositoryFile("docs/launch-checklist.md");
    const rollbackSection = markdownSection(checklist, "## ロールバック（元に戻す）");

    expect(rollbackSection).toMatch(/通常の(?:製品|コード)[^\n]*(?:不具合|回帰)[\s\S]*(?:revert|修正commit)[\s\S]*8ゲート[\s\S]*(?:承認|reviewer|レビュー)/i);
    expect(rollbackSection).toMatch(/秘密情報|secret|個人情報|PII/i);
    expect(rollbackSection).toMatch(/(?:push|プッシュ)[^\n]*(?:直ちに|ただちに|即時)[^\n]*(?:止め|停止)/i);
    expect(rollbackSection).toMatch(/(?:contain|封じ込め|非公開化|公開停止)[^\n]*(?:明示|最終)[^\n]*承認/i);
    expect(rollbackSection).toMatch(/(?:rotate|ローテーション|更新)[^\n]*(?:revoke|失効|無効化)|(?:revoke|失効|無効化)[^\n]*(?:rotate|ローテーション|更新)/i);
    expect(rollbackSection).toMatch(/(?:セキュリティ|security)[^\n]*(?:privacy|プライバシー)/i);
    expect(rollbackSection).toMatch(/(?:通常の)?revert[^\n]*(?:履歴|history)[^\n]*(?:消さ|除去し|削除し).*ない/i);
    expect(rollbackSection).toContain("https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository");
    expect(rollbackSection).toContain("https://docs.github.com/en/code-security/tutorials/remediate-leaked-secrets/remediating-a-leaked-secret");
    expect(rollbackSection).toMatch(/(?:clone|クローン)[^\n]*(?:fork|フォーク)[^\n]*(?:cache|キャッシュ)/i);
  });

  it("rejects an unexpected command interleaved with the eight quality gates", async () => {
    const checklist = await readRepositoryFile("docs/launch-checklist.md");
    const gateSection = markdownSection(checklist, "## 順番を変えないリリースゲート");
    const withUnexpectedCommand = gateSection.replace(
      "npm test\n",
      "npm test\nnpm run unexpected:gate\n",
    );

    expect(documentedQualityGateCommands(withUnexpectedCommand)).not.toEqual(orderedQualityGates);
  });

  it("distinguishes forbidden copied Git metadata from intentional local rehearsal metadata", async () => {
    const checklist = await readRepositoryFile("docs/launch-checklist.md");
    const candidateSection = markdownSection(checklist, "## 公開候補を作る");
    const cleanRoomSection = markdownSection(checklist, "## クリーンルーム確認");
    const stopSection = markdownSection(checklist, "## 止める・相談する条件");

    expect(candidateSection).toMatch(/`git init`[^\n]*(?:前|より前)[^\n]*`\.git`[^\n]*(?:ない|不在)/i);
    expect(cleanRoomSection).toMatch(/`git init`[^\n]*(?:作成|生成)[^\n]*`\.git`[^\n]*(?:正常|許可|意図)/i);
    expect(cleanRoomSection).toMatch(/`\.git`[^\n]*`git remote -v`[^\n]*(?:空|何も表示しない)/i);
    expect(stopSection).not.toMatch(/公開候補に[^\n]*`\.git`[^\n]*ある/);
    expect(stopSection).toMatch(/`git init`[^\n]*(?:前|より前)[^\n]*`\.git`[^\n]*(?:中止|止め|相談)/i);
    expect(stopSection).toMatch(/`git init`[^\n]*(?:後|した後)[^\n]*`git remote -v`[^\n]*(?:表示|空でない)/i);
  });

  it("requires separately inspectable source and clean-room gate logs", async () => {
    const checklist = await readRepositoryFile("docs/launch-checklist.md");
    const evidenceSection = markdownSection(checklist, "## Git追跡対象と証跡");

    expect(evidenceSection).toMatch(/元の作業領域[^\n]*クリーンルーム[^\n]*別々/);
    for (const field of ["正確なコマンド", "開始時刻", "終了時刻", "所要時間", "終了コード"]) {
      expect(evidenceSection).toContain(field);
    }
    expect(evidenceSection).toMatch(/候補自身[^\n]*(?:source|ソース)?scan[^\n]*ログ/i);
    expect(evidenceSection).toMatch(/`out\/`[^\n]*scan[^\n]*ログ/i);
    expect(evidenceSection).toMatch(/ログ[^\n]*(?:公開候補|追跡対象ソース)[^\n]*(?:入れ|保存し).*ない/);
  });

  it("gives a reproducible browser procedure and an explicit designated-QA fallback", async () => {
    const checklist = await readRepositoryFile("docs/launch-checklist.md");
    const qaSection = markdownSection(checklist, "## ブラウザQA");
    const automaticIndex = qaSection.indexOf("npm run test:e2e");
    const manualIndex = qaSection.indexOf("### 手作業の画面確認");

    expect(automaticIndex).toBeGreaterThanOrEqual(0);
    expect(manualIndex).toBeGreaterThan(automaticIndex);
    expect(qaSection).toMatch(/(?:F12|開発者ツール)[^\n]*(?:Responsive|レスポンシブ)/i);
    for (const viewport of ["1440×900", "390×844", "1920×1080"]) expect(qaSection).toContain(viewport);
    for (const key of ["Tab", "Shift+Tab", "Enter", "Space"]) expect(qaSection).toContain(`\`${key}\``);
    expect(qaSection).toContain("prefers-reduced-motion: reduce");
    for (const stage of ["探索期", "実験期", "仕組み化期", "経営統合期"]) expect(qaSection).toContain(stage);
    for (const tool of ["Console", "Network"]) expect(qaSection).toContain(`\`${tool}\``);
    expect(qaSection).toMatch(/指定QA担当者[^\n]*非公開QAハーネス/);
    expect(qaSection).toMatch(/非公開QAハーネス[^\n]*(?:公開候補|追跡対象ソース)[^\n]*(?:入れ|コピーし).*ない/);
    expect(qaSection).toMatch(/開発者ツール[^\n]*(?:できない|使えない)[^\n]*(?:中止|止め)[^\n]*指定QA担当者/);
    expect(qaSection).toMatch(/fake GAS[^\n]*saved[^\n]*timeout[^\n]*指定QA担当者/i);
  });

  it("records truthful fake-GAS, QA, PDF, and licensing boundaries", async () => {
    const checklist = await readRepositoryFile("docs/launch-checklist.md");

    expect(checklist).toMatch(/fake GAS[^\n]*(?:loopback|ループバック)/i);
    expect(checklist).toMatch(/fake GAS[^\n]*(?:実GAS|本番GAS|Google Apps Script)[^\n]*(?:接続しません|接続ではありません|保存しません)/i);
    expect(checklist).toMatch(/saved[^\n]*(?:受付完了|ダウンロード)/i);
    expect(checklist).toMatch(/timeout[^\n]*(?:成功|受付完了|ダウンロード)[^\n]*(?:表示しない|しない)/i);
    for (const viewport of ["1440×900", "390×844", "1920×1080"]) expect(checklist).toContain(viewport);
    for (const stage of ["探索期", "実験期", "仕組み化期", "経営統合期"]) expect(checklist).toContain(stage);
    for (const requirement of ["キーボード", "reduced-motion", "handout", "コンソール", "横スクロール"]) {
      expect(checklist).toContain(requirement);
    }
    for (const [filename, hash] of Object.entries(expectedPdfHashes)) {
      expect(checklist).toContain(filename);
      expect(checklist).toContain(hash);
      const source = await readFile(
        path.join(repositoryRoot, "content/talks/ai-president-intro/assets/downloads", filename),
      );
      expect(createHash("sha256").update(source).digest("hex")).toBe(hash);
    }
    expect(checklist).toMatch(/`package\.json`[^\n]*`ISC`/);
    expect(checklist).toMatch(/(?:standalone|単独|別途)[^\n]*(?:license|ライセンス)[^\n]*(?:オーナー|法務|legal)[^\n]*(?:判断|決定)/i);
    expect(checklist).toMatch(/(?:未構成|未設定|未接続|未作成)[^\n]*(?:GitHub|Pages|GAS|Sheet|自動返信|Slack)/);
  });

  it("documents the supported release host, disabled form defaults, scaling risk, and dependency hold", async () => {
    const readme = await readRepositoryFile("README.md");
    const checklist = await readRepositoryFile("docs/launch-checklist.md");
    const gasReadme = await readRepositoryFile("gas/README.md");

    expect(readme).toMatch(/(?:POSIX)[^\n]*(?:macOS|Linux)[^\n]*(?:Windows)[^\n]*(?:承認|approved|互換環境)/i);
    expect(checklist).toMatch(/(?:POSIX)[^\n]*(?:macOS|Linux)[^\n]*(?:Windows)[^\n]*(?:承認|approved|互換環境)/i);
    expect(readme).toMatch(/NEXT_PUBLIC_PRIVACY_POLICY_URL[^\n]*(?:空|blank)/i);
    expect(readme).toMatch(/NEXT_PUBLIC_GAS_WEB_APP_URL[^\n]*(?:空|blank)/i);
    expect(readme).not.toContain("https://tha-inc.com/privacy");
    expect(gasReadme).toMatch(/(?:将来|future)[^\n]*(?:batch|バッチ|件数|scale|スケール)[^\n]*(?:risk|リスク|上限|cursor|カーソル)/i);
    expect(checklist).toMatch(/3[^\n]*(?:High|high)[^\n]*0[^\n]*(?:Critical|critical)/);
    expect(checklist).toMatch(/next@15\.5\.23[^\n]*postcss@8\.4\.31/);
    expect(checklist).toMatch(/next@15\.5\.23[^\n]*sharp@0\.34\.5/);
    expect(checklist).toMatch(/next@16\.3\.2[^\n]*(?:major|メジャー)/i);
    expect(checklist).toMatch(/(?:公開|publication)[^\n]*(?:保留|hold|ブロック)[^\n]*(?:security|セキュリティ)[^\n]*(?:受容|accept|upgrade|アップグレード)/i);
  });

  it("keeps every authoritative launch document on the blank-or-approved-pair form contract", async () => {
    const hasInternalDocumentation = await repositoryPathExists("docs/superpowers");
    const authoritativeLaunchDocuments = hasInternalDocumentation
      ? [...publicLaunchDocuments, ...internalAuthoritativeLaunchDocuments]
      : publicLaunchDocuments;
    const documents = await Promise.all(authoritativeLaunchDocuments.map(async (relativePath) => ({
      relativePath,
      source: await readRepositoryFile(relativePath),
    })));

    for (const { relativePath, source } of documents) {
      expect(source, `${relativePath} must not prescribe the retired privacy URL`)
        .not.toContain(retiredPrivacyUrl);

      for (const assignments of publicFormAssignmentBlocks(source)) {
        expect(
          publicFormVariableNames.every((name) => name in assignments),
          `${relativePath} contains a partial public form configuration block`,
        ).toBe(true);
        expect(
          Boolean(assignments.NEXT_PUBLIC_GAS_WEB_APP_URL),
          `${relativePath} must document both public form values as blank or both as populated`,
        ).toBe(Boolean(assignments.NEXT_PUBLIC_PRIVACY_POLICY_URL));
      }
    }

    if (!hasInternalDocumentation) {
      for (const relativePath of internalAuthoritativeLaunchDocuments) {
        expect(await repositoryPathExists(relativePath)).toBe(false);
      }
      return;
    }

    const staticMigration = documents.find(({ relativePath }) => (
      relativePath.endsWith("2026-08-23-static-site-migration.md")
    ))!.source;
    expect(staticMigration).toContain([
      "NEXT_PUBLIC_SITE_URL=http://localhost:3000",
      "NEXT_PUBLIC_PRIVACY_POLICY_URL=",
      "NEXT_PUBLIC_GAS_WEB_APP_URL=",
    ].join("\n"));
    expect(staticMigration).toMatch(
      /(?:approved[^\n]*(?:pair|both)[^\n]*(?:simultaneously|together)|承認済み[^\n]*(?:2つ|両方|ペア)[^\n]*(?:同時|ペア))/i,
    );
  });

  it("publishes the checklist by exact file path without widening public directories", async () => {
    const manifest = JSON.parse(await readRepositoryFile("release/public-files.json")) as {
      directories: string[];
      files: string[];
    };

    expect(manifest.files.filter((file) => file === "docs/launch-checklist.md")).toEqual([
      "docs/launch-checklist.md",
    ]);
    expect(manifest.directories).not.toContain("docs");
    expect(manifest.directories).not.toContain(".github");
  });
});
