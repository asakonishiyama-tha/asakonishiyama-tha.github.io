// @vitest-environment node

import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type HostedVerifierModule = typeof import("../../scripts/verify-hosted-deployment.mjs");
const verifierModuleUrl = new URL("../../scripts/verify-hosted-deployment.mjs", import.meta.url).href;

async function loadVerifier(): Promise<HostedVerifierModule | undefined> {
  return import(/* @vite-ignore */ verifierModuleUrl).catch(() => undefined);
}

const pdfs = {
  "/site/downloads/ai-philosophy-for-smb.pdf": await readFile(path.resolve(
    import.meta.dirname,
    "../../content/talks/ai-president-intro/assets/downloads/ai-philosophy-for-smb.pdf",
  )),
  "/site/downloads/tha-ai-management-action-sheet.pdf": await readFile(path.resolve(
    import.meta.dirname,
    "../../content/talks/ai-president-intro/assets/downloads/tha-ai-management-action-sheet.pdf",
  )),
  "/site/downloads/long-lived-companies-experiment.pdf": await readFile(path.resolve(import.meta.dirname, "../../content/talks/long-lived-companies/assets/downloads/long-lived-companies-experiment.pdf")),
  "/site/downloads/long-lived-companies-explore.pdf": await readFile(path.resolve(import.meta.dirname, "../../content/talks/long-lived-companies/assets/downloads/long-lived-companies-explore.pdf")),
  "/site/downloads/long-lived-companies-handout.pdf": await readFile(path.resolve(import.meta.dirname, "../../content/talks/long-lived-companies/assets/downloads/long-lived-companies-handout.pdf")),
  "/site/downloads/long-lived-companies-integrate.pdf": await readFile(path.resolve(import.meta.dirname, "../../content/talks/long-lived-companies/assets/downloads/long-lived-companies-integrate.pdf")),
  "/site/downloads/long-lived-companies-systemize.pdf": await readFile(path.resolve(import.meta.dirname, "../../content/talks/long-lived-companies/assets/downloads/long-lived-companies-systemize.pdf")),
  "/site/downloads/long-lived-companies-talk.pdf": await readFile(path.resolve(import.meta.dirname, "../../content/talks/long-lived-companies/assets/downloads/long-lived-companies-talk.pdf")),
} as const;

let server: Server | undefined;

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = undefined;
});

async function startFixture(mode: "success" | "bad-pdf" | "exposed-admin") {
  const successPaths = new Set([
    "/site/",
    "/site/talks/ai-president-intro/",
    "/site/talks/ai-president-intro/quest/",
    "/site/talks/ai-president-intro/result/",
    "/site/talks/ai-president-intro/handout/",
    "/site/talks/long-lived-companies/",
    "/site/talks/long-lived-companies/quest/",
    "/site/talks/long-lived-companies/result/",
    "/site/talks/long-lived-companies/handout/",
  ]);
  server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://fixture.invalid").pathname;
    const pdf = pdfs[pathname as keyof typeof pdfs];
    if (pdf) {
      response.writeHead(200, { "content-type": "application/pdf" });
      response.end(mode === "bad-pdf" && pathname.includes("ai-philosophy") ? "%PDF-altered" : pdf);
      return;
    }
    const exposedAdminPath = ["", "site", "admin", ""].join("/");
    if (successPaths.has(pathname) || (mode === "exposed-admin" && pathname === exposedAdminPath)) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><title>fixture</title>");
      return;
    }
    response.writeHead(404, { "content-type": "text/html; charset=utf-8" });
    response.end("not found");
  });
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture did not bind a TCP port");
  return `http://127.0.0.1:${address.port}/site/`;
}

describe("hosted verifier local HTTP integration fixture", () => {
  it("passes the complete deterministic hosted boundary", async () => {
    const verifier = await loadVerifier();
    expect(verifier?.verifyHostedDeployment).toBeTypeOf("function");
    if (!verifier) return;
    const fixtureUrl = await startFixture("success");

    await expect(verifier.verifyHostedDeployment({
      allowLoopbackHttp: true,
      attempts: 1,
      baseUrl: fixtureUrl,
      gasWebAppUrl: "",
      privacyPolicyUrl: "",
    })).resolves.toEqual({
      canonicalRoutes: 9,
      forbiddenRoutes: 7,
      pdfs: 8,
      privacy: "skipped",
      requests: 24,
    });
  });

  it.each(["bad-pdf", "exposed-admin"] as const)("fails closed for fixture mode %s", async (mode) => {
    const verifier = await loadVerifier();
    expect(verifier?.verifyHostedDeployment).toBeTypeOf("function");
    if (!verifier) return;
    const fixtureUrl = await startFixture(mode);

    await expect(verifier.verifyHostedDeployment({
      allowLoopbackHttp: true,
      attempts: 1,
      baseUrl: fixtureUrl,
      gasWebAppUrl: "",
      privacyPolicyUrl: "",
    })).rejects.toBeInstanceOf(verifier.HostedVerificationError);
  });
});
