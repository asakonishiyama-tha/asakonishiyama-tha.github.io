import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolvePublicFormConfiguration } from "../lib/forms/public-form-config.js";

const canonicalRoutes = [
  "",
  "talks/ai-president-intro/",
  "talks/ai-president-intro/quest/",
  "talks/ai-president-intro/result/",
  "talks/ai-president-intro/handout/",
  "talks/long-lived-companies/",
  "talks/long-lived-companies/quest/",
  "talks/long-lived-companies/result/",
  "talks/long-lived-companies/handout/",
];

const approvedPdfs = [
  {
    path: "downloads/ai-philosophy-for-smb.pdf",
    sha256: "8fb7825ad1fe2fdd12c48d5d75453b17b59d7b8668f1ba60920f9625aff86850",
  },
  {
    path: "downloads/tha-ai-management-action-sheet.pdf",
    sha256: "1daf899cd4a6fdffbf8439b456f9218a7b62ef6ca43f609a218e4ffad3e1db99",
  },
  {
    path: "downloads/long-lived-companies-experiment.pdf",
    sha256: "1f70632d9d5d95292510c0b64b22ddbb9922cf2777125f9df77a41e311293680",
  },
  {
    path: "downloads/long-lived-companies-explore.pdf",
    sha256: "827e80ef3034f4882a979b10f5b4a9833b1f725a5c31ac065b6717d03db51d20",
  },
  {
    path: "downloads/long-lived-companies-handout.pdf",
    sha256: "e60dfbd48655e125ab4ec37e398cab66ed3625caca4a8d275b4c28e02cfae214",
  },
  {
    path: "downloads/long-lived-companies-integrate.pdf",
    sha256: "07a9f07ad7957e61389d04bece52670317a9adcfe430e9a8997d1151bbf19275",
  },
  {
    path: "downloads/long-lived-companies-systemize.pdf",
    sha256: "00909ae94eed37cc2f1921e19798a553337ec50280c2b32898f8d627cd2f19ed",
  },
  {
    path: "downloads/long-lived-companies-talk.pdf",
    sha256: "a995f8747bbe8891738501dc8d925ff413b5a9aba8fa9fd30abd5b802c32a3c4",
  },
];

const forbiddenRoutes = [
  "api/",
  "admin/",
  "live/",
  "presenter/",
  "__tha-hosted-verifier-unknown__/",
  "404/",
  "404.html",
];

const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const loopbackHttpBase = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?\/(?:[^\s?#]*\/)?$/;
const loopbackHostnames = new Set(["127.0.0.1", "localhost", "[::1]"]);
const maximumUrlLength = 2_048;
const maximumHtmlBytes = 2 * 1024 * 1024;
const maximumPdfBytes = 20 * 1024 * 1024;
const maximumRedirects = 3;
const maximumAttempts = 3;
const maximumRequests = 256;
const maximumTimeoutMs = 30_000;
const maximumRetryDelayMs = 2_000;

export class HostedVerificationError extends Error {
  constructor(code) {
    super("Hosted deployment verification failed.");
    this.name = "HostedVerificationError";
    this.code = code;
  }
}

function fail(code) {
  throw new HostedVerificationError(code);
}

function parseBoundedInteger(value, fallback, maximum, code) {
  const candidate = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > maximum) fail(code);
  return candidate;
}

function parseBaseUrl(value, allowLoopbackHttp) {
  if (typeof value !== "string"
      || value.length === 0
      || value.length > maximumUrlLength
      || /[\u0000-\u0020\u007f]/.test(value)) {
    return fail("configuration");
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return fail("configuration");
  }

  const permittedHttps = parsed.protocol === "https:";
  const permittedLoopback = allowLoopbackHttp === true
    && loopbackHttpBase.test(value)
    && parsed.protocol === "http:"
    && loopbackHostnames.has(parsed.hostname);
  if ((!permittedHttps && !permittedLoopback)
      || parsed.username !== ""
      || parsed.password !== ""
      || parsed.search !== ""
      || parsed.hash !== ""
      || !parsed.pathname.endsWith("/")) {
    return fail("configuration");
  }
  return parsed;
}

function assertSiteScope(candidate, baseUrl) {
  if (candidate.origin !== baseUrl.origin
      || !candidate.pathname.startsWith(baseUrl.pathname)
      || candidate.username !== ""
      || candidate.password !== ""
      || candidate.search !== ""
      || candidate.hash !== "") {
    fail("redirect_scope");
  }
}

function assertPrivacyScope(candidate, approvedOrigin) {
  if (candidate.protocol !== "https:"
      || candidate.origin !== approvedOrigin
      || candidate.username !== ""
      || candidate.password !== ""
      || candidate.href.length > maximumUrlLength) {
    fail("redirect_scope");
  }
}

function responseLength(response, limit) {
  const header = response.headers.get("content-length");
  if (header === null) return;
  if (!/^\d+$/.test(header)) fail("response_length");
  const length = Number(header);
  if (!Number.isSafeInteger(length) || length > limit) fail("response_too_large");
}

async function cancelBody(response) {
  if (!response.body) return;
  try {
    await response.body.cancel();
  } catch {
    // The response is already bounded by headers and is intentionally discarded.
  }
}

async function readBoundedBody(response, limit, signal) {
  try {
    responseLength(response, limit);
  } catch (error) {
    await cancelBody(response);
    throw error;
  }
  if (!response.body) return new Uint8Array();

  const reader = response.body.getReader();
  if (signal.aborted) {
    void reader.cancel().catch(() => undefined);
    fail("timeout");
  }
  const chunks = [];
  let length = 0;
  let abortListener;
  const abortPromise = new Promise((_, reject) => {
    abortListener = () => {
      void reader.cancel().catch(() => undefined);
      reject(new HostedVerificationError("timeout"));
    };
    signal.addEventListener("abort", abortListener, { once: true });
  });
  try {
    while (true) {
      const { done, value } = await Promise.race([reader.read(), abortPromise]);
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel().catch(() => undefined);
        fail("response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", abortListener);
    try {
      reader.releaseLock();
    } catch {
      // An aborted stream can retain a pending read until cancellation settles.
    }
  }

  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function timedFetch(url, context, signal) {
  if (context.requests >= maximumRequests) fail("request_limit");
  context.requests += 1;
  try {
    return await context.fetchImpl(url.toString(), { redirect: "manual", signal });
  } catch {
    if (signal.aborted) fail("timeout");
    fail("request_failed");
  }
}

async function requestWithRedirects(initialUrl, context, scope, signal) {
  const approvedPrivacyOrigin = scope === "privacy" ? initialUrl.origin : undefined;
  let currentUrl = initialUrl;
  for (let redirectCount = 0; redirectCount <= maximumRedirects; redirectCount += 1) {
    const response = await timedFetch(currentUrl, context, signal);
    if (!redirectStatuses.has(response.status)) return response;

    const location = response.headers.get("location");
    await cancelBody(response);
    if (location === null || redirectCount === maximumRedirects) fail("redirect_limit");

    let redirected;
    try {
      redirected = new URL(location, currentUrl);
    } catch {
      fail("redirect_scope");
    }
    if (scope === "site") assertSiteScope(redirected, context.baseUrl);
    else assertPrivacyScope(redirected, approvedPrivacyOrigin);
    currentUrl = redirected;
  }
  return fail("redirect_limit");
}

async function waitBeforeRetry(delayMs) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function runBoundedAttempt(context, operation) {
  const controller = new AbortController();
  let timedOut = false;
  let timeout;
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new HostedVerificationError("timeout"));
    }, context.timeoutMs);
  });

  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      timeoutPromise,
    ]);
  } catch (error) {
    if (timedOut || (error instanceof HostedVerificationError && error.code === "timeout")) {
      fail("timeout");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

async function withRetry(context, operation) {
  let lastError;
  for (let attempt = 1; attempt <= context.attempts; attempt += 1) {
    try {
      return await runBoundedAttempt(context, operation);
    } catch (error) {
      lastError = error instanceof HostedVerificationError
        ? error
        : new HostedVerificationError("verification_failed");
      if (attempt < context.attempts) await waitBeforeRetry(context.retryDelayMs);
    }
  }
  throw lastError;
}

async function verifyCanonicalRoute(relativePath, context) {
  return withRetry(context, async (signal) => {
    const response = await requestWithRedirects(
      new URL(relativePath, context.baseUrl),
      context,
      "site",
      signal,
    );
    if (response.status !== 200) {
      await cancelBody(response);
      fail("route_status");
    }
    await readBoundedBody(response, maximumHtmlBytes, signal);
  });
}

async function verifyPdf(approvedPdf, context) {
  return withRetry(context, async (signal) => {
    const response = await requestWithRedirects(
      new URL(approvedPdf.path, context.baseUrl),
      context,
      "site",
      signal,
    );
    if (response.status !== 200) {
      await cancelBody(response);
      fail("pdf_status");
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
    if (contentType !== "application/pdf") {
      await cancelBody(response);
      fail("pdf_content_type");
    }
    const bytes = await readBoundedBody(response, maximumPdfBytes, signal);
    if (bytes.length < 5 || new TextDecoder("ascii").decode(bytes.subarray(0, 5)) !== "%PDF-") {
      fail("pdf_magic");
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== approvedPdf.sha256) fail("pdf_hash");
  });
}

async function verifyForbiddenRoute(relativePath, context) {
  return withRetry(context, async (signal) => {
    const response = await requestWithRedirects(
      new URL(relativePath, context.baseUrl),
      context,
      "site",
      signal,
    );
    if (response.status < 400 || response.status >= 500) {
      await cancelBody(response);
      fail("forbidden_status");
    }
    await readBoundedBody(response, maximumHtmlBytes, signal);
  });
}

async function verifyPrivacyPage(privacyPolicyUrl, context) {
  return withRetry(context, async (signal) => {
    const initialUrl = new URL(privacyPolicyUrl);
    assertPrivacyScope(initialUrl, initialUrl.origin);
    const response = await requestWithRedirects(initialUrl, context, "privacy", signal);
    if (response.status < 200 || response.status >= 300) {
      await cancelBody(response);
      fail("privacy_status");
    }
    await readBoundedBody(response, maximumHtmlBytes, signal);
  });
}

export async function verifyHostedDeployment(options) {
  if (options === null || typeof options !== "object") fail("configuration");
  const baseUrl = parseBaseUrl(options.baseUrl, options.allowLoopbackHttp);
  const attempts = parseBoundedInteger(options.attempts, 3, maximumAttempts, "configuration");
  const timeoutMs = parseBoundedInteger(options.timeoutMs, 10_000, maximumTimeoutMs, "configuration");
  const retryDelayMs = parseBoundedInteger(
    options.retryDelayMs,
    1_000,
    maximumRetryDelayMs,
    "configuration",
  );
  if (options.fetchImpl !== undefined && typeof options.fetchImpl !== "function") fail("configuration");
  if (options.logger !== undefined && typeof options.logger !== "function") fail("configuration");

  let formConfiguration;
  try {
    formConfiguration = resolvePublicFormConfiguration({
      gasWebAppUrl: options.gasWebAppUrl ?? "",
      privacyPolicyUrl: options.privacyPolicyUrl ?? "",
    });
  } catch {
    fail("configuration");
  }

  const context = {
    attempts,
    baseUrl,
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    requests: 0,
    retryDelayMs,
    timeoutMs,
  };
  if (typeof context.fetchImpl !== "function") fail("configuration");

  for (const route of canonicalRoutes) await verifyCanonicalRoute(route, context);
  for (const pdf of approvedPdfs) await verifyPdf(pdf, context);
  for (const route of forbiddenRoutes) await verifyForbiddenRoute(route, context);
  if (formConfiguration.enabled) {
    await verifyPrivacyPage(formConfiguration.privacyPolicyUrl, context);
  }

  const result = Object.freeze({
    canonicalRoutes: canonicalRoutes.length,
    forbiddenRoutes: forbiddenRoutes.length,
    pdfs: approvedPdfs.length,
    privacy: formConfiguration.enabled ? "verified" : "skipped",
    requests: context.requests,
  });
  options.logger?.(
    `Hosted verification passed (${result.canonicalRoutes} routes, ${result.pdfs} PDFs, ${result.forbiddenRoutes} forbidden paths; privacy ${result.privacy}).`,
  );
  return result;
}

function parseArguments(argv) {
  const accepted = new Set(["--base-url", "--gas-web-app-url", "--privacy-policy-url"]);
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!accepted.has(key) || values.has(key) || index + 1 >= argv.length) fail("arguments");
    values.set(key, argv[index + 1]);
  }
  if (!values.has("--base-url")) fail("arguments");
  return {
    baseUrl: values.get("--base-url"),
    gasWebAppUrl: values.get("--gas-web-app-url") ?? "",
    privacyPolicyUrl: values.get("--privacy-policy-url") ?? "",
    logger: console.log,
  };
}

async function main() {
  try {
    await verifyHostedDeployment(parseArguments(process.argv.slice(2)));
  } catch (error) {
    const code = error instanceof HostedVerificationError ? error.code : "unexpected";
    console.error(`Hosted verification failed (${code}).`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
