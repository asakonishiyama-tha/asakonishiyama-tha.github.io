import { afterEach, describe, expect, it, vi } from "vitest";

import {
  GasAbortError,
  GasNotFoundError,
  GasTimeoutError,
  GasTransportError,
  submitAndConfirmLead,
} from "@/lib/forms/gas-client";

const submissionId = "6c686afa-3ad2-4dab-94a4-bd616198bbed";
const secondSubmissionId = "5a4dbfc8-ec77-4755-b509-1fde720caec6";
const endpoint = "https://script.google.com/macros/s/test/exec";
const consentedAt = "2026-08-23T00:00:00.000Z";

const validLead = {
  intent: "consultation" as const,
  companyName: "THA株式会社",
  name: "西山朝子",
  phone: "",
  email: "asako@example.com",
  consent: true as const,
  talkSlug: "ai-president-intro",
  eventName: "THA AI社長 登壇セッション",
  diagnosisStage: "experiment" as const,
  consultationTopic: "ai-president" as const,
  referrer: "https://tha-inc.com/talks/ai-president-intro/result/",
  utmSource: "newsletter",
  utmMedium: "email",
  utmCampaign: "launch",
};

type FetchRecord = {
  input: RequestInfo | URL;
  init?: RequestInit;
};

function createFetchRecorder(response: Promise<Response> = Promise.resolve(new Response(null, { status: 204 }))) {
  const records: FetchRecord[] = [];
  const fetchImpl = ((input: RequestInfo | URL, init?: RequestInit) => {
    records.push({ input, init });
    return response;
  }) as typeof fetch;

  return { fetchImpl, records };
}

function startSubmission(overrides: Partial<Parameters<typeof submitAndConfirmLead>[1]> = {}) {
  const recorder = createFetchRecorder();
  const promise = submitAndConfirmLead(validLead, {
    endpoint,
    fetchImpl: recorder.fetchImpl,
    documentObject: document,
    randomUUIDImpl: () => submissionId,
    now: () => new Date(consentedAt),
    ...overrides,
  });

  return { promise, ...recorder };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function currentScript() {
  await flushMicrotasks();
  const scripts = [...document.head.querySelectorAll("script")];
  expect(scripts).toHaveLength(1);
  return scripts[0]!;
}

function callbackNameFor(script: HTMLScriptElement) {
  const callback = new URL(script.src).searchParams.get("callback");
  expect(callback).toBeTruthy();
  return callback!;
}

function invokeCallback(script: HTMLScriptElement, payload: unknown) {
  const callbackName = callbackNameFor(script);
  const callback = (document.defaultView as unknown as Record<string, unknown>)[callbackName];
  expect(callback).toBeTypeOf("function");
  (callback as (value: unknown) => void)(payload);
  return callbackName;
}

function expectJsonpCleaned(script: HTMLScriptElement, callbackName: string) {
  expect(script.isConnected).toBe(false);
  expect(Object.prototype.hasOwnProperty.call(document.defaultView, callbackName)).toBe(false);
}

function documentFailingDuringSecondPoll(
  phase: "createElement" | "callbackRegistration" | "headAppend",
  message: string,
): Document {
  let createElementCalls = 0;
  let callbackRegistrations = 0;
  let headAppends = 0;
  const callbackTarget = new Proxy(document.defaultView!, {
    defineProperty(target, property, descriptor) {
      if (typeof property === "string" && property.startsWith("__thaGasReceipt_")) {
        callbackRegistrations += 1;
        if (phase === "callbackRegistration" && callbackRegistrations === 2) {
          Reflect.defineProperty(target, property, descriptor);
          throw new Error(message);
        }
      }
      return Reflect.defineProperty(target, property, descriptor);
    },
  });

  return {
    defaultView: callbackTarget,
    createElement(tagName: string) {
      if (tagName === "script") {
        createElementCalls += 1;
        if (phase === "createElement" && createElementCalls === 2) {
          throw new Error(message);
        }
      }
      return document.createElement(tagName);
    },
    head: {
      append(...nodes: (Node | string)[]) {
        headAppends += 1;
        if (phase === "headAppend" && headAppends === 2) {
          document.head.append(...nodes);
          throw new Error(message);
        }
        document.head.append(...nodes);
      },
    },
  } as unknown as Document;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.head.querySelectorAll("script").forEach((script) => script.remove());
  Object.getOwnPropertyNames(document.defaultView)
    .filter((property) => property.startsWith("__thaGasReceipt_"))
    .forEach((property) => { delete (document.defaultView as unknown as Record<string, unknown>)[property]; });
});

describe("GAS lead transport", () => {
  it.each([
    "http://gas.example/exec",
    "http://127.0.0.2:8787/exec",
    "http://sub.localhost:8787/exec",
    "http://2130706433:8787/exec",
    "http://0x7f000001:8787/exec",
    "http://127.1:8787/exec",
    "ftp://localhost/exec",
    "https://gas.example/macros/s/test/exec",
    "https://script.google.com.example/macros/s/test/exec",
    "https://www.script.google.com/macros/s/test/exec",
    "https://script.google.com:443/macros/s/test/exec",
    ["https://user:password", "script.google.com/macros/s/test/exec"].join("@"),
    "https://script.google.com/macros/s/test/exec?mode=prod",
    "https://script.google.com/macros/s/test/exec#prod",
    "https://script.google.com/macros/s/test/exec/",
    "https://script.google.com/macros/s/test%2Falias/exec",
    `https://script.google.com/macros/s/${"a".repeat(257)}/exec`,
    "not a URL",
  ])("rejects an insecure or invalid endpoint before network use: %s", async (candidate) => {
    vi.useFakeTimers();
    const { fetchImpl, records } = createFetchRecorder();
    const promise = submitAndConfirmLead(validLead, {
      endpoint: candidate,
      fetchImpl,
      documentObject: document,
      randomUUIDImpl: () => submissionId,
      now: () => new Date(consentedAt),
      timeoutMs: 1,
    });
    const rejection = promise.catch((error: unknown) => error);

    await vi.runAllTimersAsync();

    expect(await rejection).toBeInstanceOf(GasTransportError);
    expect(records).toHaveLength(0);
    expect(document.head.querySelectorAll("script")).toHaveLength(0);
  });

  it.each([
    "http://127.0.0.1:8787/exec",
    "http://localhost:8787/exec",
    "http://[::1]:8787/exec",
  ])("permits HTTP only for an explicit loopback hostname: %s", async (candidate) => {
    const { promise, records } = startSubmission({
      allowLoopbackEndpoint: true,
      endpoint: candidate,
    });
    const script = await currentScript();
    invokeCallback(script, { submissionId, status: "saved" });

    await expect(promise).resolves.toEqual({ submissionId, status: "saved" });
    expect(records).toHaveLength(1);
  });

  it("rejects a loopback endpoint unless the local/test caller opts in", async () => {
    vi.useFakeTimers();
    const { fetchImpl, records } = createFetchRecorder();
    const promise = submitAndConfirmLead(validLead, {
      endpoint: "http://127.0.0.1:8787/exec",
      fetchImpl,
      documentObject: document,
      randomUUIDImpl: () => submissionId,
      now: () => new Date(consentedAt),
      timeoutMs: 1,
    });
    const rejection = promise.catch((error: unknown) => error);

    await vi.runAllTimersAsync();

    expect(await rejection).toBeInstanceOf(GasTransportError);
    expect(records).toHaveLength(0);
  });

  it("rejects unavailable UUID generation before network use", async () => {
    vi.stubGlobal("crypto", {});
    const { fetchImpl, records } = createFetchRecorder();

    await expect(submitAndConfirmLead(validLead, {
      endpoint,
      fetchImpl,
      documentObject: document,
      now: () => new Date(consentedAt),
    })).rejects.toBeInstanceOf(GasTransportError);

    expect(records).toHaveLength(0);
  });

  it.each([
    { label: "throws", uuid: () => { throw new Error("sensitive generator detail"); } },
    { label: "returns malformed data", uuid: () => "predictable" },
  ])("rejects a UUID generator that $label before network use", async ({ uuid }) => {
    const { fetchImpl, records } = createFetchRecorder();

    await expect(submitAndConfirmLead(validLead, {
      endpoint,
      fetchImpl,
      documentObject: document,
      randomUUIDImpl: uuid,
      now: () => new Date(consentedAt),
    })).rejects.toBeInstanceOf(GasTransportError);

    expect(records).toHaveLength(0);
  });

  it("sends exactly one form-encoded no-CORS POST and waits for saved", async () => {
    const { promise, records } = startSubmission();
    const script = await currentScript();

    expect(records).toHaveLength(1);
    expect(String(records[0]!.input)).toBe(endpoint);
    expect(records[0]!.init?.method).toBe("POST");
    expect(records[0]!.init?.mode).toBe("no-cors");
    expect(records[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    expect(records[0]!.init?.body).toBeInstanceOf(URLSearchParams);

    const body = records[0]!.init?.body as URLSearchParams;
    expect([...body.keys()]).toEqual(["submissionId", "payload"]);
    expect(body.get("submissionId")).toBe(submissionId);
    expect(JSON.parse(body.get("payload")!)).toEqual({
      submissionId,
      website: "",
      consentedAt,
      lead: validLead,
    });

    let resolved = false;
    void promise.then(() => { resolved = true; });
    await flushMicrotasks();
    expect(resolved).toBe(false);

    invokeCallback(script, { submissionId, status: "saved" });
    await expect(promise).resolves.toEqual({ submissionId, status: "saved" });
    expect(records).toHaveLength(1);
  });

  it("enters confirmation only after the no-CORS POST completes", async () => {
    let resolvePost: (response: Response) => void = () => undefined;
    const recorder = createFetchRecorder(new Promise<Response>((resolve) => {
      resolvePost = resolve;
    }));
    const onConfirming = vi.fn();
    const promise = submitAndConfirmLead(validLead, {
      endpoint,
      fetchImpl: recorder.fetchImpl,
      documentObject: document,
      randomUUIDImpl: () => submissionId,
      now: () => new Date(consentedAt),
      onConfirming,
    });

    await flushMicrotasks();
    expect(onConfirming).not.toHaveBeenCalled();
    expect(document.head.querySelectorAll("script")).toHaveLength(0);

    resolvePost(new Response(null, { status: 204 }));
    const script = await currentScript();
    expect(onConfirming).toHaveBeenCalledOnce();

    invokeCallback(script, { submissionId, status: "saved" });
    await expect(promise).resolves.toEqual({ submissionId, status: "saved" });
  });

  it("normalizes a confirmation lifecycle callback failure before polling", async () => {
    const sensitiveMessage = `confirmation failed for ${validLead.email}`;
    const { fetchImpl } = createFetchRecorder();
    const promise = submitAndConfirmLead(validLead, {
      endpoint,
      fetchImpl,
      documentObject: document,
      randomUUIDImpl: () => submissionId,
      now: () => new Date(consentedAt),
      onConfirming: () => { throw new Error(sensitiveMessage); },
    });

    const error = await promise.catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GasTransportError);
    expect((error as Error).message).not.toContain(sensitiveMessage);
    expect(document.head.querySelectorAll("script")).toHaveLength(0);
    expect(Object.getOwnPropertyNames(document.defaultView)
      .filter((property) => property.startsWith("__thaGasReceipt_"))).toHaveLength(0);
  });

  it("puts only the encoded receipt ID and unique callback in status URLs", async () => {
    vi.useFakeTimers();
    const { promise } = startSubmission({ pollIntervalMs: 1_500 });
    const firstScript = await currentScript();
    const firstUrl = new URL(firstScript.src);
    const firstCallback = callbackNameFor(firstScript);
    expect(firstCallback).toMatch(/^__thaGasReceipt_[0-9a-f]{8}_[0-9a-f]{4}_4[0-9a-f]{3}_[89ab][0-9a-f]{3}_[0-9a-f]{12}_[a-z0-9]+$/);

    expect([...firstUrl.searchParams.keys()]).toEqual(["submissionId", "callback"]);
    expect(firstUrl.searchParams.get("submissionId")).toBe(submissionId);
    expect(firstCallback).toMatch(/^__thaGasReceipt_[A-Za-z0-9_]+$/);
    expect(firstScript.src).not.toContain(encodeURIComponent(validLead.email));
    expect(firstScript.src).not.toContain(encodeURIComponent(validLead.companyName));
    invokeCallback(firstScript, { submissionId, status: "pending" });

    await vi.advanceTimersByTimeAsync(1_499);
    expect(document.head.querySelectorAll("script")).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const secondScript = await currentScript();
    const secondCallback = callbackNameFor(secondScript);
    expect(secondCallback).not.toBe(firstCallback);

    invokeCallback(secondScript, { submissionId, status: "saved" });
    await expect(promise).resolves.toEqual({ submissionId, status: "saved" });
  });

  it("accepts saved only for the matching receipt and cleans the JSONP resources", async () => {
    const { promise } = startSubmission();
    const script = await currentScript();
    const callbackName = invokeCallback(script, { submissionId, status: "saved" });

    await expect(promise).resolves.toEqual({ submissionId, status: "saved" });
    expectJsonpCleaned(script, callbackName);
  });

  it("rejects not_found with a typed error and cleans the JSONP resources", async () => {
    const { promise } = startSubmission();
    const script = await currentScript();
    const callbackName = invokeCallback(script, { submissionId, status: "not_found" });

    await expect(promise).rejects.toBeInstanceOf(GasNotFoundError);
    expectJsonpCleaned(script, callbackName);
  });

  it("rejects a receipt for a different submission without exposing either ID", async () => {
    const { promise } = startSubmission();
    const script = await currentScript();
    const callbackName = invokeCallback(script, { submissionId: secondSubmissionId, status: "saved" });

    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GasTransportError);
    expect((error as Error).message).not.toContain(submissionId);
    expect((error as Error).message).not.toContain(secondSubmissionId);
    expectJsonpCleaned(script, callbackName);
  });

  it.each([
    { submissionId, status: "saved", email: validLead.email },
    { submissionId: "predictable", status: "saved" },
    { submissionId, status: "received" },
    null,
  ])("rejects malformed receipt payloads and cleans the JSONP resources", async (payload) => {
    const { promise } = startSubmission();
    const script = await currentScript();
    const callbackName = invokeCallback(script, payload);

    await expect(promise).rejects.toBeInstanceOf(GasTransportError);
    expectJsonpCleaned(script, callbackName);
  });

  it("rejects script transport errors and cleans the JSONP resources", async () => {
    const { promise } = startSubmission();
    const script = await currentScript();
    const callbackName = callbackNameFor(script);

    script.dispatchEvent(new Event("error"));

    await expect(promise).rejects.toBeInstanceOf(GasTransportError);
    expectJsonpCleaned(script, callbackName);
  });

  it("rejects POST transport errors without creating JSONP resources or leaking details", async () => {
    const sensitiveMessage = `failed for ${validLead.email}`;
    const recorder = createFetchRecorder(Promise.reject(new Error(sensitiveMessage)));
    const promise = submitAndConfirmLead(validLead, {
      endpoint,
      fetchImpl: recorder.fetchImpl,
      documentObject: document,
      randomUUIDImpl: () => submissionId,
      now: () => new Date(consentedAt),
    });

    const error = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GasTransportError);
    expect((error as Error).message).not.toContain(validLead.email);
    expect(document.head.querySelectorAll("script")).toHaveLength(0);
  });

  it("normalizes a synchronous POST failure and clears its lifecycle resources", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const sensitiveMessage = `failed for ${validLead.email}`;
    const fetchImpl = (() => {
      throw new Error(sensitiveMessage);
    }) as typeof fetch;

    const error = await submitAndConfirmLead(validLead, {
      endpoint,
      signal: controller.signal,
      fetchImpl,
      documentObject: document,
      randomUUIDImpl: () => submissionId,
      now: () => new Date(consentedAt),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GasTransportError);
    expect((error as Error).message).not.toContain(sensitiveMessage);
    expect(removeListener).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts before network use with a typed error", async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetchImpl, records } = createFetchRecorder();

    await expect(submitAndConfirmLead(validLead, {
      endpoint,
      signal: controller.signal,
      fetchImpl,
      documentObject: document,
      randomUUIDImpl: () => submissionId,
      now: () => new Date(consentedAt),
    })).rejects.toBeInstanceOf(GasAbortError);

    expect(records).toHaveLength(0);
  });

  it.each(["randomUUID", "now"] as const)(
    "does not lose an abort triggered while evaluating %s",
    async (phase) => {
      vi.useFakeTimers();
      const controller = new AbortController();
      const { fetchImpl, records } = createFetchRecorder();
      const promise = submitAndConfirmLead(validLead, {
        endpoint,
        signal: controller.signal,
        fetchImpl,
        documentObject: document,
        randomUUIDImpl: () => {
          if (phase === "randomUUID") {
            controller.abort();
          }
          return submissionId;
        },
        now: () => {
          if (phase === "now") {
            controller.abort();
          }
          return new Date(consentedAt);
        },
        timeoutMs: 1,
      });
      const rejection = promise.catch((caught: unknown) => caught);

      await vi.advanceTimersByTimeAsync(1);

      expect(await rejection).toBeInstanceOf(GasAbortError);
      expect(records).toHaveLength(0);
      expect(document.head.querySelectorAll("script")).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("abort wins a callback race and removes callbacks, scripts, timers, and listeners", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const removeListener = vi.spyOn(controller.signal, "removeEventListener");
    const { promise } = startSubmission({ signal: controller.signal });
    const script = await currentScript();
    const callbackName = callbackNameFor(script);
    const callback = (document.defaultView as unknown as Record<string, unknown>)[callbackName] as (value: unknown) => void;

    controller.abort();
    callback({ submissionId, status: "saved" });

    await expect(promise).rejects.toBeInstanceOf(GasAbortError);
    expectJsonpCleaned(script, callbackName);
    expect(removeListener).toHaveBeenCalled();
    await vi.runAllTimersAsync();
    expect(document.head.querySelectorAll("script")).toHaveLength(0);
  });

  it("abort removes the timer waiting between pending polls", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const { promise } = startSubmission({ signal: controller.signal });
    const rejection = expect(promise).rejects.toBeInstanceOf(GasAbortError);
    const script = await currentScript();
    const callbackName = invokeCallback(script, { submissionId, status: "pending" });

    controller.abort();

    await rejection;
    expectJsonpCleaned(script, callbackName);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(document.head.querySelectorAll("script")).toHaveLength(0);
  });

  it.each(["createElement", "callbackRegistration", "headAppend"] as const)(
    "normalizes a synchronous %s failure while setting up a retry poll",
    async (phase) => {
      vi.useFakeTimers();
      const sensitiveMessage = `${phase} failed for ${validLead.email}`;
      const { promise } = startSubmission({
        documentObject: documentFailingDuringSecondPoll(phase, sensitiveMessage),
      });
      const rejection = promise.catch((caught: unknown) => caught);
      const firstScript = await currentScript();
      invokeCallback(firstScript, { submissionId, status: "pending" });

      await vi.advanceTimersByTimeAsync(1_500);

      const error = await rejection;
      expect(error).toBeInstanceOf(GasTransportError);
      expect((error as Error).message).not.toContain(sensitiveMessage);
      expect(document.head.querySelectorAll("script")).toHaveLength(0);
      expect(Object.getOwnPropertyNames(document.defaultView)
        .filter((property) => property.startsWith("__thaGasReceipt_"))).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("uses the 20-second default deadline and cleans a stalled poll", async () => {
    vi.useFakeTimers();
    const { promise } = startSubmission();
    const rejection = expect(promise).rejects.toBeInstanceOf(GasTimeoutError);
    const script = await currentScript();
    const callbackName = callbackNameFor(script);

    await vi.advanceTimersByTimeAsync(19_999);
    expect(script.isConnected).toBe(true);
    await vi.advanceTimersByTimeAsync(1);

    await rejection;
    expectJsonpCleaned(script, callbackName);
  });

  it("stops after exactly 10 pending polls at the 1.5-second default interval", async () => {
    vi.useFakeTimers();
    const { promise } = startSubmission();
    const rejection = expect(promise).rejects.toBeInstanceOf(GasTimeoutError);
    const callbackNames = new Set<string>();

    for (let poll = 1; poll <= 10; poll += 1) {
      const script = await currentScript();
      callbackNames.add(callbackNameFor(script));
      invokeCallback(script, { submissionId, status: "pending" });
      if (poll < 10) {
        await vi.advanceTimersByTimeAsync(1_499);
        expect(document.head.querySelectorAll("script")).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(1);
      }
    }

    await rejection;
    expect(callbackNames).toHaveLength(10);
    await vi.runAllTimersAsync();
    expect(document.head.querySelectorAll("script")).toHaveLength(0);
    for (const callbackName of callbackNames) {
      expect(Object.prototype.hasOwnProperty.call(document.defaultView, callbackName)).toBe(false);
    }
  });
});
