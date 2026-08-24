import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("development server build isolation", () => {
  it("runs the Playwright server in an isolated workspace", async () => {
    vi.stubEnv("PLAYWRIGHT_BASE_URL", "http://127.0.0.1:3199");

    const { default: playwrightConfig } = await import("../../playwright.config");
    const webServer = Array.isArray(playwrightConfig.webServer)
      ? playwrightConfig.webServer[0]
      : playwrightConfig.webServer;

    expect(webServer?.command).toBe(
      "node scripts/start-e2e-server.mjs --hostname 127.0.0.1 --port 3199",
    );
    expect(webServer?.gracefulShutdown).toEqual({ signal: "SIGTERM", timeout: 5_000 });
  });
});
