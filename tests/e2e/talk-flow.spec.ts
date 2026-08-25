import { createHash } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

import {
  defaultFakeGasEndpoint,
  fakeGasControlPath,
  fakeGasControlToken,
  readFakeGas,
  resetFakeGas,
  setFakeGasMode,
} from "./fixtures/fake-gas";

const talkPath = "/talks/ai-president-intro/";
const questPath = `${talkPath}quest/`;
const resultPath = `${talkPath}result/`;
const handoutPath = `${talkPath}handout/`;
const appOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
const fakeGasEndpoint = process.env.PLAYWRIGHT_FAKE_GAS_URL ?? defaultFakeGasEndpoint;
const fakeGasOrigin = new URL(fakeGasEndpoint).origin;
const allowedBrowserOrigins = new Set([appOrigin, fakeGasOrigin]);
const companyName = "E2E株式会社";
const visitorName = "E2E訪問者";
const visitorEmail = "visitor@e2e-company.example";
const visitorPhone = "03-1234-5678";
const forbiddenBrowserText = [companyName, visitorName, visitorEmail, visitorPhone];

const stageJourneys = [
  {
    title: "探索期",
    answers: ["まだ利用していない", "再利用できるものは残っていない", "必要なときだけ各自で使う"],
  },
  {
    title: "実験期",
    answers: ["個人の業務効率化で利用している", "個人のプロンプトやメモが残っている", "推進する担当者がいる"],
  },
  {
    title: "仕組み化期",
    answers: ["部門の仕組みとして利用している", "チームで使える手順や知識が残っている", "共有ルールと定期的な振り返りがある"],
  },
  {
    title: "経営統合期",
    answers: ["経営判断にも利用している", "判断記録と採否理由が会社の資産として残っている", "経営指標と改善サイクルに組み込まれている"],
  },
] as const;

const pdfs = [
  {
    url: "/downloads/ai-philosophy-for-smb.pdf",
    sha256: "8fb7825ad1fe2fdd12c48d5d75453b17b59d7b8668f1ba60920f9625aff86850",
  },
  {
    url: "/downloads/tha-ai-management-action-sheet.pdf",
    sha256: "1daf899cd4a6fdffbf8439b456f9218a7b62ef6ca43f609a218e4ffad3e1db99",
  },
] as const;

type BrowserGuard = {
  consoleMessages: string[];
  consoleErrors: string[];
  externalRequests: string[];
  pageErrors: string[];
};

const guards = new WeakMap<Page, BrowserGuard>();

test.beforeEach(async ({ page, request }) => {
  await resetFakeGas(request, "saved");
  const guard: BrowserGuard = {
    consoleMessages: [],
    consoleErrors: [],
    externalRequests: [],
    pageErrors: [],
  };
  guards.set(page, guard);
  page.on("console", (message) => {
    guard.consoleMessages.push(message.text());
    if (message.type() === "error") guard.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => guard.pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && !allowedBrowserOrigins.has(url.origin)) {
      guard.externalRequests.push(request.url());
    }
  });
});

test.afterEach(async ({ page }) => {
  const guard = guards.get(page);
  expect(guard?.consoleErrors ?? []).toEqual([]);
  expect(guard?.pageErrors ?? []).toEqual([]);
  expect(guard?.externalRequests ?? []).toEqual([]);
  const browserDiagnostics = JSON.stringify(guard?.consoleMessages ?? []);
  for (const forbidden of forbiddenBrowserText) expect(browserDiagnostics).not.toContain(forbidden);
});

async function answerDiagnosis(page: Page, answers: readonly [string, string, string]) {
  for (const answer of answers) {
    await page.getByRole("button", { name: answer, exact: true }).click();
  }
  const resultLink = page.getByRole("link", { name: "診断結果を見る" });
  await expect(resultLink).toHaveAttribute("href", resultPath.slice(0, -1));
  await resultLink.click();
}

async function tabTo(page: Page, locator: ReturnType<Page["getByRole"]>) {
  for (let attempts = 0; attempts < 20; attempts += 1) {
    if (await locator.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Expected to reach the interactive control with Tab.");
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function expectRoute(page: Page, expectedPath: string) {
  const normalizedExpectedPath = expectedPath.replace(/\/$/, "");
  await expect.poll(() => new URL(page.url()).pathname.replace(/\/$/, "")).toBe(normalizedExpectedPath);
}

async function openResult(page: Page, journey = stageJourneys[1]) {
  await page.goto(questPath);
  await answerDiagnosis(page, journey.answers);
  await expectRoute(page, resultPath);
}

async function fillContactFields(page: Page) {
  await page.getByLabel("会社名").fill(companyName);
  await page.getByLabel("お名前").fill(visitorName);
  await page.getByLabel("メールアドレス").fill(visitorEmail);
  await page.getByLabel("電話番号（任意）").fill(visitorPhone);
  await page.getByLabel(/個人情報の取り扱いに同意する/).check();
}

function expectSafeCapturedSubmission(
  post: Awaited<ReturnType<typeof readFakeGas>>["posts"][number],
  intent: "download" | "consultation",
) {
  expect(post.contentType).toContain("application/x-www-form-urlencoded");
  expect(post.fields).toEqual(["submissionId", "payload"]);
  expect(post.submissionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(post.payload).toMatchObject({
    submissionId: post.submissionId,
    website: "",
    consentedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    lead: {
      intent,
      companyName,
      name: visitorName,
      email: visitorEmail,
      phone: visitorPhone,
      consent: true,
      talkSlug: "ai-president-intro",
      eventName: "THA AI社長 登壇セッション",
      diagnosisStage: "experiment",
      referrer: "",
      utmSource: "",
      utmMedium: "",
      utmCampaign: "",
    },
  });
  const serialized = JSON.stringify(post.payload);
  expect(serialized).not.toMatch(/answers|answerLabel|score|total/);
  for (const journey of stageJourneys) {
    for (const answer of journey.answers) expect(serialized).not.toContain(answer);
  }
}

function expectPrivateStatusQueries(snapshot: Awaited<ReturnType<typeof readFakeGas>>) {
  expect(snapshot.statusRequests.length).toBeGreaterThan(0);
  for (const statusRequest of snapshot.statusRequests) {
    expect(statusRequest.pathname).toBe("/exec");
    expect(statusRequest.fields).toEqual(["submissionId", "callback"]);
    expect(statusRequest.callback).toMatch(/^__thaGasReceipt_[A-Za-z0-9_]+$/);
    expect(statusRequest.submissionId).toMatch(/^[0-9a-f-]{36}$/i);
    const serialized = JSON.stringify(statusRequest);
    for (const forbidden of forbiddenBrowserText) expect(serialized).not.toContain(forbidden);
  }
}

async function expectFakeControlsAbsentFromPublicExport(request: APIRequestContext) {
  const controlRoute = await request.get(`${appOrigin}${fakeGasControlPath}/requests`, {
    headers: { "x-tha-fake-gas-token": fakeGasControlToken },
  });
  expect(controlRoute.status()).toBe(404);

  const documentResponse = await request.get(`${appOrigin}${resultPath}`);
  const html = await documentResponse.text();
  const scriptPaths = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((match) => match[1]!);
  const scripts = await Promise.all(scriptPaths.map(async (scriptPath) => {
    const response = await request.get(new URL(scriptPath, appOrigin).toString());
    expect(response.ok(), scriptPath).toBe(true);
    return response.text();
  }));
  const publicCode = [html, ...scripts].join("\n");
  expect(publicCode).not.toContain(fakeGasControlPath);
  expect(publicCode).not.toContain(fakeGasControlToken);
}

test("serves the published Talk route and its three-question entry point", async ({ page }) => {
  const response = await page.goto(talkPath);

  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "会社に、もう一人の社長がいたら。" })).toBeVisible();
  const questLink = page.getByRole("link", { name: "60秒診断を始める" });
  await expect.poll(async () => new URL(await questLink.getAttribute("href") ?? "", page.url()).pathname).toBe(questPath.slice(0, -1));
  await questLink.click();
  await expectRoute(page, questPath);
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "3");
  await expect(page.getByRole("heading", { name: "AIは、経営のどこまで入っていますか。" })).toBeVisible();
});

for (const journey of stageJourneys) {
  test(`maps an independent three-answer session to ${journey.title}`, async ({ page }) => {
    await page.goto(questPath);
    await answerDiagnosis(page, journey.answers);

    await expectRoute(page, resultPath);
    await expect(page.getByRole("heading", { name: journey.title, exact: true })).toBeVisible();
    await expect(page.getByText("YOUR AI MANAGEMENT STAGE")).toHaveCSS("color", "rgb(255, 233, 60)");
  });
}

test("reveals both approved PDFs only after the separate fake GAS reports saved", async ({ page, request }) => {
  await resetFakeGas(request, "pending_saved");
  await page.addInitScript(() => { window.dataLayer = []; });
  await openResult(page);

  await page.getByRole("button", { name: "個別アクションシートを受け取る" }).click();
  await fillContactFields(page);
  await expect(page.getByRole("link", { name: /ダウンロード/ })).toHaveCount(0);
  await page.getByRole("button", { name: "資料を受け取る" }).click();

  await expect(page.getByRole("button", { name: "保存を確認中…" })).toBeDisabled();
  await expect(page.getByRole("link", { name: /ダウンロード/ })).toHaveCount(0);
  const actionSheet = page.getByRole("link", { name: "資料をダウンロード", exact: true });
  const talkDeck = page.getByRole("link", { name: "講演資料をダウンロード" });
  await expect(actionSheet).toBeVisible();
  await expect(actionSheet).toHaveAttribute("href", "/downloads/tha-ai-management-action-sheet.pdf");
  await expect(actionSheet).toHaveAttribute("download", "");
  await expect(talkDeck).toHaveAttribute("href", "/downloads/ai-philosophy-for-smb.pdf");
  await expect(talkDeck).toHaveAttribute("download", "");

  const snapshot = await readFakeGas(request);
  expect(snapshot.posts).toHaveLength(1);
  expectSafeCapturedSubmission(snapshot.posts[0]!, "download");
  expect(snapshot.statusRequests).toHaveLength(2);
  expectPrivateStatusQueries(snapshot);
  expect(new Set(snapshot.statusRequests.map((status) => status.submissionId)))
    .toEqual(new Set([snapshot.posts[0]!.submissionId]));

  const analytics = await page.evaluate(() => window.dataLayer ?? []);
  expect(analytics).toContainEqual({
    event: "download_submit_success",
    talkSlug: "ai-president-intro",
    resultStage: "experiment",
  });
  for (const event of analytics) {
    expect(Object.keys(event)).toEqual(expect.arrayContaining(["event", "talkSlug"]));
    expect(Object.keys(event).every((key) => ["event", "talkSlug", "resultStage"].includes(key))).toBe(true);
  }
  const serializedAnalytics = JSON.stringify(analytics);
  for (const forbidden of forbiddenBrowserText) expect(serializedAnalytics).not.toContain(forbidden);
  await expectFakeControlsAbsentFromPublicExport(request);

  for (const pdf of pdfs) {
    const response = await request.get(pdf.url);
    const body = await response.body();
    expect(response.status(), pdf.url).toBe(200);
    expect(response.headers()["content-type"], pdf.url).toBe("application/pdf");
    expect(body.subarray(0, 5).toString(), pdf.url).toBe("%PDF-");
    expect(createHash("sha256").update(body).digest("hex"), pdf.url).toBe(pdf.sha256);
  }
});

test("shows the Talk receipt for a saved consultation without claiming email or Slack delivery", async ({ page, request }) => {
  await openResult(page);
  await page.getByRole("button", { name: "AI活用を相談する" }).click();
  await fillContactFields(page);
  await page.getByLabel("AI社長について相談したい").check();
  await page.getByRole("button", { name: "相談を申し込む" }).click();

  const receipt = page.getByRole("status");
  await expect(receipt).toHaveText("お申し込みを受け付けました。");
  await expect(receipt).not.toContainText(/メール|Slack|通知済み|送信済み/);
  const snapshot = await readFakeGas(request);
  expect(snapshot.posts).toHaveLength(1);
  expectSafeCapturedSubmission(snapshot.posts[0]!, "consultation");
  expect(snapshot.posts[0]!.payload).toMatchObject({
    lead: { consultationTopic: "ai-president" },
  });
  expectPrivateStatusQueries(snapshot);
});

test("keeps downloads hidden after not_found and retries with a fresh receipt ID", async ({ page, request }) => {
  await resetFakeGas(request, "not_found");
  await openResult(page);
  await page.getByRole("button", { name: "個別アクションシートを受け取る" }).click();
  await fillContactFields(page);
  await page.getByRole("button", { name: "資料を受け取る" }).click();

  const alert = page.getByText(
    "保存を確認できませんでした。確認メールが届いていない場合は、もう一度お試しください。",
    { exact: true },
  );
  await expect(alert).toHaveAttribute("role", "alert");
  await expect(page.getByRole("link", { name: /ダウンロード/ })).toHaveCount(0);
  const firstSnapshot = await readFakeGas(request);
  expect(firstSnapshot.posts).toHaveLength(1);
  expectPrivateStatusQueries(firstSnapshot);

  await setFakeGasMode(request, "saved");
  await page.getByRole("button", { name: "資料を受け取る" }).click();
  await expect(page.getByRole("link", { name: "資料をダウンロード", exact: true })).toBeVisible();

  const retried = await readFakeGas(request);
  expect(retried.posts).toHaveLength(2);
  expect(retried.posts[1]!.submissionId).not.toBe(retried.posts[0]!.submissionId);
  expect(new Set(retried.posts.map((post) => post.submissionId)).size).toBe(2);
});

test("times out without a fake GAS status response and never reveals a download", async ({ page, request }) => {
  test.setTimeout(40_000);
  await resetFakeGas(request, "timeout");
  await openResult(page);
  await page.getByRole("button", { name: "個別アクションシートを受け取る" }).click();
  await fillContactFields(page);
  await page.getByRole("button", { name: "資料を受け取る" }).click();

  await expect(page.getByRole("button", { name: "保存を確認中…" })).toBeDisabled();
  const alert = page.getByText(
    "保存を確認できませんでした。確認メールが届いていない場合は、もう一度お試しください。",
    { exact: true },
  );
  await expect(alert).toHaveAttribute("role", "alert", { timeout: 25_000 });
  await expect(page.getByRole("link", { name: /ダウンロード/ })).toHaveCount(0);
  const snapshot = await readFakeGas(request);
  expect(snapshot.posts).toHaveLength(1);
  expect(snapshot.statusRequests).toHaveLength(1);
  expectPrivateStatusQueries(snapshot);
});

test("coalesces two same-tick browser submits into one POST and one receipt ID", async ({ page, request }) => {
  await openResult(page);
  await page.getByRole("button", { name: "個別アクションシートを受け取る" }).click();
  await fillContactFields(page);
  const form = page.getByRole("button", { name: "資料を受け取る" }).locator("xpath=ancestor::form");

  await form.evaluate((element) => {
    element.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
  });

  await expect(page.getByRole("link", { name: "資料をダウンロード", exact: true })).toBeVisible();
  const snapshot = await readFakeGas(request);
  expect(snapshot.posts).toHaveLength(1);
  expect(new Set(snapshot.posts.map((post) => post.submissionId)).size).toBe(1);
  expectPrivateStatusQueries(snapshot);
});

test("serves the reading handout route as a semantic document", async ({ page }) => {
  const response = await page.goto(handoutPath);

  expect(response?.status()).toBe(200);
  await expect(page.locator("[data-handout-document]")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "会社に、もう一人の社長がいたら。" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(["探索期", "実験期", "仕組み化期", "経営統合期"]);
  await expect(page.getByRole("note", { name: "7日以内の行動" })).toBeVisible();
});

test("supports a keyboard-only diagnosis and saved download journey", async ({ page, request }) => {
  await page.goto(questPath);

  for (const answer of stageJourneys[1].answers) {
    const answerButton = page.getByRole("button", { name: answer, exact: true });
    await tabTo(page, answerButton);
    await page.keyboard.press("Space");
  }
  const resultLink = page.getByRole("link", { name: "診断結果を見る" });
  await tabTo(page, resultLink);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "実験期", exact: true })).toBeVisible();

  const downloadAction = page.getByRole("button", { name: "個別アクションシートを受け取る" });
  await tabTo(page, downloadAction);
  await page.keyboard.press("Enter");

  const company = page.getByLabel("会社名");
  await tabTo(page, company);
  await page.keyboard.type(companyName);
  const name = page.getByLabel("お名前");
  await tabTo(page, name);
  await page.keyboard.type(visitorName);
  const email = page.getByLabel("メールアドレス");
  await tabTo(page, email);
  await page.keyboard.type(visitorEmail);
  const phone = page.getByLabel("電話番号（任意）");
  await tabTo(page, phone);
  await page.keyboard.type(visitorPhone);
  const consent = page.getByLabel(/個人情報の取り扱いに同意する/);
  await tabTo(page, consent);
  await page.keyboard.press("Space");
  const submit = page.getByRole("button", { name: "資料を受け取る" });
  await tabTo(page, submit);
  await page.keyboard.press("Enter");

  await expect(page.getByRole("link", { name: "資料をダウンロード", exact: true })).toBeVisible();
  const snapshot = await readFakeGas(request);
  expect(snapshot.posts).toHaveLength(1);
  expectSafeCapturedSubmission(snapshot.posts[0]!, "download");
});

test("has no horizontal overflow through the full mobile journey", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(talkPath);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("link", { name: "60秒診断を始める" }).click();
  await expectRoute(page, questPath);
  await expectNoHorizontalOverflow(page);
  await answerDiagnosis(page, stageJourneys[2].answers);
  await expectNoHorizontalOverflow(page);
  await page.getByRole("button", { name: "AI活用を相談する" }).click();
  await expectNoHorizontalOverflow(page);
});

test("keeps the Talk readable at projector width", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(talkPath);

  await expect(page.getByRole("heading", { name: "会社に、もう一人の社長がいたら。" })).toBeVisible();
  await expect(page.getByRole("link", { name: "60秒診断を始める" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("removes transform animation when reduced motion is requested", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(talkPath);

  const motion = await page.locator("[data-motion-marker]").evaluate((marker) => {
    const orbit = document.querySelector("[data-scroll-progress]");
    const markerStyle = getComputedStyle(marker);
    const orbitStyle = orbit ? getComputedStyle(orbit) : null;
    return {
      markerTransform: markerStyle.transform,
      markerAnimation: markerStyle.animationName,
      orbitTransform: orbitStyle?.transform,
      orbitAnimation: orbitStyle?.animationName,
    };
  });

  expect(motion).toEqual({
    markerTransform: "none",
    markerAnimation: "none",
    orbitTransform: "none",
    orbitAnimation: "none",
  });
});
