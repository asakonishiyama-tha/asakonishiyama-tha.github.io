import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { defaultFakeGasEndpoint, readFakeGas, resetFakeGas } from "./fixtures/fake-gas";

const talkPath = "/talks/long-lived-companies/";
const questPath = `${talkPath}quest/`;
const resultPath = `${talkPath}result/`;
const handoutPath = `${talkPath}handout/`;
const appOrigin = new URL(process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3100").origin;
const fakeGasOrigin = new URL(process.env.PLAYWRIGHT_FAKE_GAS_URL ?? defaultFakeGasEndpoint).origin;
const allowedOrigins = new Set([appOrigin, fakeGasOrigin]);

const sceneIds = [
  "hero", "opening-question", "three-facts", "not-accidental", "five-soils",
  "time-assets-photo", "change-to-protect", "case-toushirou", "case-ohga", "case-kikkoman",
  "evaporation-crisis", "two-risks", "company-is-people", "quest", "twenty-years-later", "lead",
] as const;

const stageJourneys = [
  { title: "原石発掘期", answers: ["社長や一部の人だけが語れる", "個人の経験や記憶に依存している", "特定の人がいないと判断できない"] },
  { title: "言語化期", answers: ["理念や社是の文章はある", "規程や手順書として残っている", "引き継ぎ資料や研修に頼っている"] },
  { title: "浸透期", answers: ["一部の社員が具体例と一緒に語れる", "成功・失敗事例と採否理由が共有されている", "若手が過去事例を参照し、自分で判断できる"] },
  { title: "継承資産期", answers: ["世代や部署を越えて、自分の言葉と実例で語れる", "日々の判断と振り返りから継続的に更新されている", "人とAIが判断資産を参照し、次の学びを会社へ残せる"] },
] as const;

const pdfs = [
  ["long-lived-companies-experiment.pdf", "1f70632d9d5d95292510c0b64b22ddbb9922cf2777125f9df77a41e311293680"],
  ["long-lived-companies-explore.pdf", "827e80ef3034f4882a979b10f5b4a9833b1f725a5c31ac065b6717d03db51d20"],
  ["long-lived-companies-handout.pdf", "e60dfbd48655e125ab4ec37e398cab66ed3625caca4a8d275b4c28e02cfae214"],
  ["long-lived-companies-integrate.pdf", "07a9f07ad7957e61389d04bece52670317a9adcfe430e9a8997d1151bbf19275"],
  ["long-lived-companies-systemize.pdf", "00909ae94eed37cc2f1921e19798a553337ec50280c2b32898f8d627cd2f19ed"],
  ["long-lived-companies-talk.pdf", "a995f8747bbe8891738501dc8d925ff413b5a9aba8fa9fd30abd5b802c32a3c4"],
] as const;

type Guard = { consoleErrors: string[]; externalRequests: string[]; pageErrors: string[] };
const guards = new WeakMap<Page, Guard>();

test.beforeEach(async ({ page }) => {
  const guard: Guard = { consoleErrors: [], externalRequests: [], pageErrors: [] };
  guards.set(page, guard);
  page.on("console", (message) => { if (message.type() === "error") guard.consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => guard.pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (["http:", "https:"].includes(url.protocol) && !allowedOrigins.has(url.origin)) guard.externalRequests.push(request.url());
  });
});

test.afterEach(async ({ page }) => {
  const guard = guards.get(page);
  expect(guard?.consoleErrors ?? []).toEqual([]);
  expect(guard?.pageErrors ?? []).toEqual([]);
  expect(guard?.externalRequests ?? []).toEqual([]);
});

async function answer(page: Page, answers: readonly string[]) {
  for (const label of answers) await page.getByRole("button", { name: label, exact: true }).click();
  await page.getByRole("link", { name: "診断結果を見る" }).click();
  await expect.poll(() => new URL(page.url()).pathname.replace(/\/$/, "")).toBe(resultPath.replace(/\/$/, ""));
}

async function expectNoOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

async function tabTo(page: Page, target: ReturnType<Page["getByRole"]>) {
  for (let attempt = 0; attempt < 24; attempt += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Keyboard focus did not reach the expected control.");
}

test("renders all 16 approved scenes with TIME MESH and the three-question entry point", async ({ page }) => {
  const response = await page.goto(talkPath);
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "御社らしさは、20年後も残るか。" })).toBeVisible();
  await expect(page.locator("main section[id]")).toHaveCount(16);
  for (const id of sceneIds) await expect(page.locator(`#${id}`)).toBeAttached();
  await expect(page.locator('[data-hero-atmosphere="timeMesh"]')).toBeAttached();
  await page.getByRole("link", { name: "60秒診断を始める" }).click();
  await expect(page.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "3");
  await expect(page.getByRole("heading", { name: "御社らしさを、社員は具体的な出来事と一緒に語れますか。" })).toBeVisible();
});

for (const journey of stageJourneys) {
  test(`maps an independent long-lived diagnosis to ${journey.title}`, async ({ page }) => {
    await page.goto(questPath);
    await answer(page, journey.answers);
    await expect(page.getByRole("heading", { name: journey.title, exact: true })).toBeVisible();
  });
}

test("submits the canonical long-lived Talk lead with required name and optional phone", async ({ page, request }) => {
  await resetFakeGas(request, "saved");
  await page.goto(questPath);
  await answer(page, stageJourneys[1].answers);
  await page.getByRole("button", { name: "個別アクションシートを受け取る" }).click();

  await page.getByLabel("会社名").fill("老舗E2E株式会社");
  await page.getByLabel("お名前").fill("老舗テスト担当者");
  await page.getByLabel("メールアドレス").fill("visitor@e2e-company.example");
  await page.getByLabel("電話番号（任意）").fill("03-9876-5432");
  await page.getByLabel(/個人情報の取り扱いに同意する/).check();
  await page.getByRole("button", { name: "資料を受け取る" }).click();

  await expect(page.getByRole("link", { name: "資料をダウンロード", exact: true })).toBeVisible();
  const snapshot = await readFakeGas(request);
  expect(snapshot.posts).toHaveLength(1);
  expect(snapshot.posts[0]?.payload).toMatchObject({
    website: "",
    lead: {
      intent: "download",
      companyName: "老舗E2E株式会社",
      name: "老舗テスト担当者",
      email: "visitor@e2e-company.example",
      phone: "03-9876-5432",
      talkSlug: "long-lived-companies",
      eventName: "THA 老舗企業と時間資産 登壇セッション",
      diagnosisStage: "experiment",
      consent: true,
    },
  });
});

test("serves the semantic handout and all six exact PDFs", async ({ page, request }) => {
  const response = await page.goto(handoutPath);
  expect(response?.status()).toBe(200);
  await expect(page.locator("[data-handout-document]")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "御社らしさは、20年後も残るか。" })).toBeVisible();
  for (const [filename, hash] of pdfs) {
    const pdf = await request.get(`/downloads/${filename}`);
    const body = await pdf.body();
    expect(pdf.status(), filename).toBe(200);
    expect(pdf.headers()["content-type"], filename).toBe("application/pdf");
    expect(body.subarray(0, 5).toString(), filename).toBe("%PDF-");
    expect(createHash("sha256").update(body).digest("hex"), filename).toBe(hash);
  }
});

test("supports a keyboard-only long-lived diagnosis", async ({ page }) => {
  await page.goto(questPath);
  for (const label of stageJourneys[1].answers) {
    const option = page.getByRole("button", { name: label, exact: true });
    await tabTo(page, option);
    await page.keyboard.press("Space");
  }
  const result = page.getByRole("link", { name: "診断結果を見る" });
  await tabTo(page, result);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "言語化期", exact: true })).toBeVisible();
});

test("is readable on mobile and projector and becomes static with reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(talkPath);
  await expectNoOverflow(page);
  await page.goto(questPath);
  await answer(page, stageJourneys[2].answers);
  await expectNoOverflow(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(talkPath);
  await expect(page.getByRole("heading", { name: "御社らしさは、20年後も残るか。" })).toBeVisible();
  await expectNoOverflow(page);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await expect(page.locator("main")).toHaveAttribute("data-reduced-motion", "true");
  await expect(page.locator("[data-scene-motion]").first()).toHaveAttribute("data-motion-state", "static");
  await expect(page.locator("[data-scroll-progress]")).toHaveCSS("transform", "none");
});

test("keeps case-study messages within a two-line mobile and projector hierarchy", async ({ page }) => {
  for (const viewport of [
    { label: "mobile", width: 390, height: 844 },
    { label: "projector", width: 1920, height: 1080 },
  ] as const) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto(talkPath);

    for (const sceneId of ["case-toushirou", "case-ohga", "case-kikkoman"] as const) {
      const scene = page.locator(`#${sceneId}`);
      const heading = scene.getByRole("heading", { level: 2 });
      await expect(heading).toBeVisible();

      const metrics = await heading.evaluate((element) => {
        const style = window.getComputedStyle(element);
        const lineHeight = Number.parseFloat(style.lineHeight);
        const fontSize = Number.parseFloat(style.fontSize);
        return {
          fontSize,
          lines: Math.round(element.getBoundingClientRect().height / lineHeight),
        };
      });

      expect(metrics.fontSize, `${viewport.label} ${sceneId} heading font size`).toBeLessThanOrEqual(64);
      expect(metrics.lines, `${viewport.label} ${sceneId} heading line count`).toBeLessThanOrEqual(2);
      if (viewport.label === "projector") {
        expect(await scene.evaluate((element) => element.getBoundingClientRect().height), `${sceneId} scene height`)
          .toBeLessThanOrEqual(1080);
      }
    }
  }
});
