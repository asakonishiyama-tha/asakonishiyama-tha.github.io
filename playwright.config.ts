import { defineConfig } from "@playwright/test";

const defaultBaseUrl = "http://127.0.0.1:3100";
const defaultFakeGasUrl = "http://127.0.0.1:3201/exec";
const requestedBaseUrl = process.env.PLAYWRIGHT_BASE_URL ?? defaultBaseUrl;
const requestedFakeGasUrl = process.env.PLAYWRIGHT_FAKE_GAS_URL ?? defaultFakeGasUrl;
const parsedBaseUrl = new URL(requestedBaseUrl);
const parsedFakeGasUrl = new URL(requestedFakeGasUrl);
const localHostnames = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

if (parsedBaseUrl.protocol !== "http:" || !localHostnames.has(parsedBaseUrl.hostname) || parsedBaseUrl.pathname !== "/" || parsedBaseUrl.search || parsedBaseUrl.hash) {
  throw new Error("PLAYWRIGHT_BASE_URL must be a loopback http origin without a path, query, or fragment.");
}
if (
  parsedFakeGasUrl.protocol !== "http:"
  || !localHostnames.has(parsedFakeGasUrl.hostname)
  || parsedFakeGasUrl.pathname !== "/exec"
  || parsedFakeGasUrl.search
  || parsedFakeGasUrl.hash
  || parsedFakeGasUrl.username
  || parsedFakeGasUrl.password
  || !parsedFakeGasUrl.port
) {
  throw new Error("PLAYWRIGHT_FAKE_GAS_URL must be an explicit loopback http /exec URL with a port.");
}
if (parsedFakeGasUrl.origin === parsedBaseUrl.origin) {
  throw new Error("PLAYWRIGHT_FAKE_GAS_URL must use a separate loopback origin.");
}

const serverPort = parsedBaseUrl.port || "80";
const fakeGasPort = parsedFakeGasUrl.port;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: parsedBaseUrl.origin,
    viewport: { width: 1440, height: 900 },
  },
  webServer: [
    {
      command: `node scripts/start-e2e-server.mjs --hostname ${parsedBaseUrl.hostname} --port ${serverPort}`,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      url: parsedBaseUrl.origin,
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        ...process.env,
        E2E_GAS_WEB_APP_URL: parsedFakeGasUrl.toString(),
        NEXT_PUBLIC_SITE_URL: parsedBaseUrl.origin,
      },
    },
    {
      command: `node --experimental-strip-types tests/e2e/fixtures/fake-gas.ts --hostname ${parsedFakeGasUrl.hostname} --port ${fakeGasPort}`,
      gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
      url: `${parsedFakeGasUrl.origin}/_fake-gas-control/v1/health`,
      reuseExistingServer: false,
      timeout: 10_000,
      env: {
        ...process.env,
        PLAYWRIGHT_FAKE_GAS_URL: parsedFakeGasUrl.toString(),
      },
    },
  ],
});
