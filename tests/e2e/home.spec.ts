import { expect, test, type Page } from "@playwright/test";

type BrowserGuard = {
  consoleErrors: string[];
  externalRequests: string[];
  pageErrors: string[];
};

const guards = new WeakMap<Page, BrowserGuard>();

test.beforeEach(async ({ page }) => {
  const guard: BrowserGuard = { consoleErrors: [], externalRequests: [], pageErrors: [] };
  guards.set(page, guard);
  page.on("console", (message) => {
    if (message.type() === "error") guard.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => guard.pageErrors.push(error.message));
  page.on("request", (request) => {
    const url = new URL(request.url());
    if ((url.protocol === "http:" || url.protocol === "https:") && !url.hostname.match(/^(?:127\.0\.0\.1|localhost|::1)$/)) {
      guard.externalRequests.push(request.url());
    }
  });
});

test.afterEach(async ({ page }) => {
  const guard = guards.get(page);
  expect(guard?.consoleErrors ?? []).toEqual([]);
  expect(guard?.pageErrors ?? []).toEqual([]);
  expect(guard?.externalRequests ?? []).toEqual([]);
});

test("serves the approved home route and links both published Talks", async ({ page }) => {
  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-type"]).toContain("text/html");
  await expect(page.getByRole("heading", { name: "登壇ライブラリ" })).toBeVisible();
  await expect(page.getByText("西山朝子 / THA", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /会社に、もう一人の社長がいたら。/ })).toHaveAttribute(
    "href",
    "/talks/ai-president-intro/",
  );
  await expect(page.getByRole("link", { name: /御社らしさは、20年後も残るか。/ })).toHaveAttribute(
    "href",
    "/talks/long-lived-companies/",
  );
  await expect(page.getByText("新しいTalkは、公開前レビューを経て追加します。")).toBeVisible();
  await expect(page.getByRole("link")).toHaveCount(2);
});

test("returns the static server 404 for an unknown artifact", async ({ request }) => {
  const response = await request.get("/not-an-exported-route.txt");

  expect(response.status()).toBe(404);
  expect(await response.text()).toBe("Not Found\n");
});
