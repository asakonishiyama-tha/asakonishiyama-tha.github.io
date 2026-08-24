// @vitest-environment node

import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const baseUrl = "https://pages.example/site/";
const gasWebAppUrl = "https://script.google.com/macros/s/AKfycb_test-Deployment_123/exec";
const privacyPolicyUrl = "https://privacy.example/policy";
const pdfs = {
  "/site/downloads/ai-philosophy-for-smb.pdf": {
    bytes: await readFile(path.resolve(
      import.meta.dirname,
      "../../content/talks/ai-president-intro/assets/downloads/ai-philosophy-for-smb.pdf",
    )),
    sha256: "8fb7825ad1fe2fdd12c48d5d75453b17b59d7b8668f1ba60920f9625aff86850",
  },
  "/site/downloads/tha-ai-management-action-sheet.pdf": {
    bytes: await readFile(path.resolve(
      import.meta.dirname,
      "../../content/talks/ai-president-intro/assets/downloads/tha-ai-management-action-sheet.pdf",
    )),
    sha256: "1daf899cd4a6fdffbf8439b456f9218a7b62ef6ca43f609a218e4ffad3e1db99",
  },
  "/site/downloads/long-lived-companies-experiment.pdf": {
    bytes: await readFile(path.resolve(import.meta.dirname, "../../content/talks/long-lived-companies/assets/downloads/long-lived-companies-experiment.pdf")),
    sha256: "1f70632d9d5d95292510c0b64b22ddbb9922cf2777125f9df77a41e311293680",
  },
  "/site/downloads/long-lived-companies-explore.pdf": {
    bytes: await readFile(path.resolve(import.meta.dirname, "../../content/talks/long-lived-companies/assets/downloads/long-lived-companies-explore.pdf")),
    sha256: "827e80ef3034f4882a979b10f5b4a9833b1f725a5c31ac065b6717d03db51d20",
  },
  "/site/downloads/long-lived-companies-handout.pdf": {
    bytes: await readFile(path.resolve(import.meta.dirname, "../../content/talks/long-lived-companies/assets/downloads/long-lived-companies-handout.pdf")),
    sha256: "e60dfbd48655e125ab4ec37e398cab66ed3625caca4a8d275b4c28e02cfae214",
  },
  "/site/downloads/long-lived-companies-integrate.pdf": {
    bytes: await readFile(path.resolve(import.meta.dirname, "../../content/talks/long-lived-companies/assets/downloads/long-lived-companies-integrate.pdf")),
    sha256: "07a9f07ad7957e61389d04bece52670317a9adcfe430e9a8997d1151bbf19275",
  },
  "/site/downloads/long-lived-companies-systemize.pdf": {
    bytes: await readFile(path.resolve(import.meta.dirname, "../../content/talks/long-lived-companies/assets/downloads/long-lived-companies-systemize.pdf")),
    sha256: "00909ae94eed37cc2f1921e19798a553337ec50280c2b32898f8d627cd2f19ed",
  },
  "/site/downloads/long-lived-companies-talk.pdf": {
    bytes: await readFile(path.resolve(import.meta.dirname, "../../content/talks/long-lived-companies/assets/downloads/long-lived-companies-talk.pdf")),
    sha256: "a995f8747bbe8891738501dc8d925ff413b5a9aba8fa9fd30abd5b802c32a3c4",
  },
} as const;

type HostedVerifierModule = typeof import("../../scripts/verify-hosted-deployment.mjs");
const verifierModuleUrl = new URL("../../scripts/verify-hosted-deployment.mjs", import.meta.url).href;

async function loadVerifier(): Promise<HostedVerifierModule | undefined> {
  return import(/* @vite-ignore */ verifierModuleUrl).catch(() => undefined);
}

function siteResponse(url: URL): Response {
  const pdf = pdfs[url.pathname as keyof typeof pdfs];
  if (pdf) {
    return new Response(pdf.bytes, {
      headers: { "content-type": "application/pdf" },
      status: 200,
    });
  }
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
  if (successPaths.has(url.pathname)) {
    return new Response("<!doctype html><title>THA</title>", {
      headers: { "content-type": "text/html; charset=utf-8" },
      status: 200,
    });
  }
  return new Response("not found", {
    headers: { "content-type": "text/html; charset=utf-8" },
    status: url.pathname.endsWith("/404/") ? 410 : 404,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("hosted deployment verifier", () => {
  it("checks nine routes, eight exact PDFs, seven forbidden paths, and a redirected HTTPS privacy page", async () => {
    const verifier = await loadVerifier();
    expect(verifier?.verifyHostedDeployment).toBeTypeOf("function");
    if (!verifier) return;
    const requests: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requests.push(url.toString());
      if (url.toString() === privacyPolicyUrl) {
        return new Response(null, { headers: { location: "/notice" }, status: 302 });
      }
      if (url.toString() === "https://privacy.example/notice") {
        return new Response(null, { status: 204 });
      }
      return siteResponse(url);
    }) as typeof fetch;
    const events: string[] = [];

    const result = await verifier.verifyHostedDeployment({
      baseUrl,
      fetchImpl,
      gasWebAppUrl,
      privacyPolicyUrl,
      attempts: 1,
      logger: (message) => events.push(message),
    });

    expect(result).toEqual({
      canonicalRoutes: 9,
      forbiddenRoutes: 7,
      pdfs: 8,
      privacy: "verified",
      requests: 26,
    });
    expect(requests).toHaveLength(26);
    expect(requests.every((request) => request.startsWith(baseUrl)
      || request.startsWith("https://privacy.example/"))).toBe(true);
    expect(requests).toContain(`${baseUrl}api/`);
    expect(requests).toContain(`${baseUrl}404.html`);
    expect(requests).toContain(`${baseUrl}talks/long-lived-companies/`);
    expect(events.join("\n")).not.toContain(baseUrl);
    expect(events.join("\n")).not.toContain(gasWebAppUrl);
    expect(events.join("\n")).not.toContain(privacyPolicyUrl);
  });

  it("reports a truthful privacy skip when both approved form values are blank", async () => {
    const verifier = await loadVerifier();
    expect(verifier?.verifyHostedDeployment).toBeTypeOf("function");
    if (!verifier) return;
    const fetchImpl = (async (input: RequestInfo | URL) => siteResponse(new URL(String(input)))) as typeof fetch;

    await expect(verifier.verifyHostedDeployment({
      baseUrl,
      fetchImpl,
      gasWebAppUrl: "",
      privacyPolicyUrl: "",
      attempts: 1,
    })).resolves.toMatchObject({ privacy: "skipped", requests: 24 });
  });

  it.each([
    ["PDF content type", () => new Response(pdfs["/site/downloads/ai-philosophy-for-smb.pdf"].bytes, {
      headers: { "content-type": "application/octet-stream" }, status: 200,
    })],
    ["PDF magic", () => new Response(Buffer.from("not-a-pdf"), {
      headers: { "content-type": "application/pdf" }, status: 200,
    })],
    ["PDF hash", () => new Response(Buffer.from("%PDF-altered"), {
      headers: { "content-type": "application/pdf" }, status: 200,
    })],
  ])("rejects an invalid exact PDF boundary: %s", async (_label, replacement) => {
    const verifier = await loadVerifier();
    expect(verifier?.verifyHostedDeployment).toBeTypeOf("function");
    if (!verifier) return;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/site/downloads/ai-philosophy-for-smb.pdf") return replacement();
      return siteResponse(url);
    }) as typeof fetch;

    await expect(verifier.verifyHostedDeployment({
      baseUrl,
      fetchImpl,
      gasWebAppUrl: "",
      privacyPolicyUrl: "",
      attempts: 1,
    })).rejects.toBeInstanceOf(verifier.HostedVerificationError);
  });

  it("rejects a forbidden route that returns success", async () => {
    const verifier = await loadVerifier();
    expect(verifier?.verifyHostedDeployment).toBeTypeOf("function");
    if (!verifier) return;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === ["", "site", "admin", ""].join("/")) {
        return new Response("admin", { status: 200 });
      }
      return siteResponse(url);
    }) as typeof fetch;

    await expect(verifier.verifyHostedDeployment({
      baseUrl,
      fetchImpl,
      gasWebAppUrl: "",
      privacyPolicyUrl: "",
      attempts: 1,
    })).rejects.toMatchObject({ code: "forbidden_status" });
  });

  it("retries a transient route failure within the configured bound", async () => {
    const verifier = await loadVerifier();
    expect(verifier?.verifyHostedDeployment).toBeTypeOf("function");
    if (!verifier) return;
    let rootAttempts = 0;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/site/" && rootAttempts++ === 0) {
        return new Response("unavailable", { status: 503 });
      }
      return siteResponse(url);
    }) as typeof fetch;

    const result = await verifier.verifyHostedDeployment({
      baseUrl,
      fetchImpl,
      gasWebAppUrl: "",
      privacyPolicyUrl: "",
      attempts: 2,
      retryDelayMs: 1,
    });

    expect(rootAttempts).toBe(2);
    expect(result.requests).toBe(25);
  });

  it("bounds redirect requests and rejects a redirect outside the deployed base", async () => {
    const verifier = await loadVerifier();
    expect(verifier?.verifyHostedDeployment).toBeTypeOf("function");
    if (!verifier) return;
    const requests: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      requests.push(String(input));
      return new Response(null, {
        headers: { location: "https://outside.example/landing" },
        status: 302,
      });
    }) as typeof fetch;

    await expect(verifier.verifyHostedDeployment({
      baseUrl,
      fetchImpl,
      gasWebAppUrl: "",
      privacyPolicyUrl: "",
      attempts: 1,
    })).rejects.toMatchObject({ code: "redirect_scope" });
    expect(requests).toHaveLength(1);
  });

  it("rejects an HTTPS privacy redirect that downgrades to HTTP", async () => {
    const verifier = await loadVerifier();
    expect(verifier?.verifyHostedDeployment).toBeTypeOf("function");
    if (!verifier) return;
    const requests: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requests.push(url.toString());
      if (url.origin === "https://privacy.example") {
        return new Response(null, { headers: { location: "http://privacy.example/insecure" }, status: 302 });
      }
      return siteResponse(url);
    }) as typeof fetch;

    await expect(verifier.verifyHostedDeployment({
      baseUrl,
      fetchImpl,
      gasWebAppUrl,
      privacyPolicyUrl,
      attempts: 1,
    })).rejects.toMatchObject({ code: "redirect_scope" });
    expect(requests).not.toContain("http://privacy.example/insecure");
  });

  it("keeps privacy redirects on the approved privacy origin", async () => {
    const verifier = await loadVerifier();
    expect(verifier?.verifyHostedDeployment).toBeTypeOf("function");
    if (!verifier) return;
    const requests: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      requests.push(url.toString());
      if (url.origin === "https://privacy.example") {
        return new Response(null, {
          headers: { location: "https://redirected.example/policy" },
          status: 302,
        });
      }
      return siteResponse(url);
    }) as typeof fetch;

    await expect(verifier.verifyHostedDeployment({
      baseUrl,
      fetchImpl,
      gasWebAppUrl,
      privacyPolicyUrl,
      attempts: 1,
    })).rejects.toMatchObject({ code: "redirect_scope" });
    expect(requests).not.toContain("https://redirected.example/policy");
  });

  it("aborts timed-out requests and clears timeout resources", async () => {
    const verifier = await loadVerifier();
    expect(verifier?.verifyHostedDeployment).toBeTypeOf("function");
    if (!verifier) return;
    vi.useFakeTimers();
    let aborts = 0;
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        aborts += 1;
        reject(new DOMException("sensitive timeout detail", "AbortError"));
      }, { once: true });
    })) as typeof fetch;
    const promise = verifier.verifyHostedDeployment({
      baseUrl,
      fetchImpl,
      gasWebAppUrl: "",
      privacyPolicyUrl: "",
      attempts: 1,
      timeoutMs: 10,
    });
    const rejection = promise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(10);

    expect(await rejection).toMatchObject({ code: "timeout" });
    expect(aborts).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a response body that stalls after its headers arrive", async () => {
    const verifier = await loadVerifier();
    expect(verifier?.verifyHostedDeployment).toBeTypeOf("function");
    if (!verifier) return;
    vi.useFakeTimers();
    let cancellations = 0;
    const stalledBody = new ReadableStream<Uint8Array>({
      cancel() {
        cancellations += 1;
      },
    });
    const fetchImpl = (async () => new Response(stalledBody, {
      headers: { "content-type": "text/html; charset=utf-8" },
      status: 200,
    })) as typeof fetch;
    let outcome: unknown;
    void verifier.verifyHostedDeployment({
      baseUrl,
      fetchImpl,
      gasWebAppUrl: "",
      privacyPolicyUrl: "",
      attempts: 1,
      timeoutMs: 10,
    }).catch((error: unknown) => {
      outcome = error;
    });

    await vi.advanceTimersByTimeAsync(10);
    await Promise.resolve();

    expect(outcome).toMatchObject({ code: "timeout" });
    expect(cancellations).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a stalled body delivered at the timeout boundary", async () => {
    const verifier = await loadVerifier();
    expect(verifier?.verifyHostedDeployment).toBeTypeOf("function");
    if (!verifier) return;
    vi.useFakeTimers();
    let cancellations = 0;
    const stalledBody = new ReadableStream<Uint8Array>({
      cancel() {
        cancellations += 1;
      },
    });
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve) => {
      init?.signal?.addEventListener("abort", () => {
        resolve(new Response(stalledBody, { status: 200 }));
      }, { once: true });
    })) as typeof fetch;
    let outcome: unknown;
    void verifier.verifyHostedDeployment({
      baseUrl,
      fetchImpl,
      gasWebAppUrl: "",
      privacyPolicyUrl: "",
      attempts: 1,
      timeoutMs: 10,
    }).catch((error: unknown) => {
      outcome = error;
    });

    await vi.advanceTimersByTimeAsync(10);
    await vi.advanceTimersByTimeAsync(0);

    expect(outcome).toMatchObject({ code: "timeout" });
    expect(cancellations).toBe(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects oversized responses before buffering their body", async () => {
    const verifier = await loadVerifier();
    expect(verifier?.verifyHostedDeployment).toBeTypeOf("function");
    if (!verifier) return;
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/site/") {
        return new Response("small", { headers: { "content-length": "999999999" }, status: 200 });
      }
      return siteResponse(url);
    }) as typeof fetch;

    await expect(verifier.verifyHostedDeployment({
      baseUrl,
      fetchImpl,
      gasWebAppUrl: "",
      privacyPolicyUrl: "",
      attempts: 1,
    })).rejects.toMatchObject({ code: "response_too_large" });
  });

  it("redacts fetch failures and approved form values from errors and logs", async () => {
    const verifier = await loadVerifier();
    expect(verifier?.verifyHostedDeployment).toBeTypeOf("function");
    if (!verifier) return;
    const sensitiveMarker = "do-not-echo-marker";
    const approvedGas = `https://script.google.com/macros/s/${sensitiveMarker}/exec`;
    const approvedPrivacy = `https://privacy.example/${sensitiveMarker}`;
    const events: string[] = [];
    const fetchImpl = (async () => { throw new Error(`network ${sensitiveMarker}`); }) as typeof fetch;

    const error = await verifier.verifyHostedDeployment({
      baseUrl,
      fetchImpl,
      gasWebAppUrl: approvedGas,
      privacyPolicyUrl: approvedPrivacy,
      attempts: 1,
      logger: (message) => events.push(message),
    }).catch((caught: unknown) => caught);
    const serialized = `${String(error)}\n${events.join("\n")}`;

    expect(error).toBeInstanceOf(verifier.HostedVerificationError);
    expect(serialized).not.toContain(sensitiveMarker);
    expect(serialized).not.toContain(approvedGas);
    expect(serialized).not.toContain(approvedPrivacy);
  });
});
