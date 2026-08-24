import type { ValidatedLead } from "@/lib/validation/lead-schema";
import {
  parseLeadSubmission,
  parseReceiptStatus,
  type SavedReceipt,
} from "@/lib/forms/submission-types";
import {
  parseGasWebAppUrl,
  PublicFormConfigurationError,
} from "@/lib/forms/public-form-config.js";

const DEFAULT_POLL_INTERVAL_MS = 1_500;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_POLLS = 10;

export type GasClientErrorCode = "transport" | "timeout" | "not_found" | "aborted";

export class GasClientError extends Error {
  readonly code: GasClientErrorCode;

  constructor(code: GasClientErrorCode, message: string) {
    super(message);
    this.name = "GasClientError";
    this.code = code;
  }
}

export class GasTransportError extends GasClientError {
  constructor() {
    super("transport", "Lead persistence could not be confirmed.");
    this.name = "GasTransportError";
  }
}

export class GasTimeoutError extends GasClientError {
  constructor() {
    super("timeout", "Lead persistence confirmation timed out.");
    this.name = "GasTimeoutError";
  }
}

export class GasNotFoundError extends GasClientError {
  constructor() {
    super("not_found", "Lead persistence was not found.");
    this.name = "GasNotFoundError";
  }
}

export class GasAbortError extends GasClientError {
  constructor() {
    super("aborted", "Lead persistence confirmation was aborted.");
    this.name = "GasAbortError";
  }
}

export type SubmitAndConfirmLeadOptions = {
  endpoint: string;
  allowLoopbackEndpoint?: boolean;
  signal?: AbortSignal;
  pollIntervalMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  documentObject?: Document;
  randomUUIDImpl?: () => string;
  now?: () => Date;
  onConfirming?: () => void;
};

let callbackSequence = 0;

function parseEndpoint(endpoint: string, allowLoopbackEndpoint: boolean): URL {
  try {
    return new URL(parseGasWebAppUrl(endpoint, { allowLoopback: allowLoopbackEndpoint }));
  } catch (error) {
    if (!(error instanceof PublicFormConfigurationError)) throw error;
    throw new GasTransportError();
  }
}

function requirePositiveDuration(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new GasTransportError();
  }
  return value;
}

function createSubmission(
  lead: ValidatedLead,
  randomUUIDImpl: (() => string) | undefined,
  now: (() => Date) | undefined,
) {
  const uuidGenerator = randomUUIDImpl ?? globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
  if (uuidGenerator === undefined) {
    throw new GasTransportError();
  }

  try {
    return parseLeadSubmission({
      submissionId: uuidGenerator(),
      website: "",
      consentedAt: (now?.() ?? new Date()).toISOString(),
      lead,
    });
  } catch {
    throw new GasTransportError();
  }
}

function createCallbackName(submissionId: string): string {
  callbackSequence += 1;
  return `__thaGasReceipt_${submissionId.replaceAll("-", "_")}_${callbackSequence.toString(36)}`;
}

export async function submitAndConfirmLead(
  lead: ValidatedLead,
  options: SubmitAndConfirmLeadOptions,
): Promise<SavedReceipt> {
  if (options.signal?.aborted) {
    throw new GasAbortError();
  }

  const endpointUrl = parseEndpoint(options.endpoint, options.allowLoopbackEndpoint === true);
  const pollIntervalMs = requirePositiveDuration(options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  const timeoutMs = requirePositiveDuration(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const submission = createSubmission(lead, options.randomUUIDImpl, options.now);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const documentObject = options.documentObject ?? globalThis.document;
  const callbackTarget = documentObject?.defaultView as unknown as Record<string, unknown> | null;

  if (typeof fetchImpl !== "function" || documentObject?.head === undefined || callbackTarget === null) {
    throw new GasTransportError();
  }

  const postBody = new URLSearchParams({
    submissionId: submission.submissionId,
    payload: JSON.stringify(submission),
  });

  return new Promise<SavedReceipt>((resolve, reject) => {
    const requestController = new AbortController();
    let settled = false;
    let pollCount = 0;
    let activeScript: HTMLScriptElement | undefined;
    let activeCallbackName: string | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;

    const cleanupCurrentPoll = () => {
      if (activeScript !== undefined) {
        activeScript.onerror = null;
        activeScript.remove();
        activeScript = undefined;
      }
      if (activeCallbackName !== undefined) {
        delete callbackTarget[activeCallbackName];
        activeCallbackName = undefined;
      }
    };

    const cleanup = () => {
      cleanupCurrentPoll();
      if (pollTimer !== undefined) {
        clearTimeout(pollTimer);
        pollTimer = undefined;
      }
      clearTimeout(deadlineTimer);
      options.signal?.removeEventListener("abort", handleAbort);
      requestController.abort();
    };

    const finish = (result: SavedReceipt | GasClientError) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (result instanceof GasClientError) {
        reject(result);
      } else {
        resolve(result);
      }
    };

    const handleAbort = () => {
      finish(new GasAbortError());
    };

    const deadlineTimer = setTimeout(() => {
      finish(new GasTimeoutError());
    }, timeoutMs);

    const poll = () => {
      if (settled) {
        return;
      }

      try {
        pollCount += 1;
        const callbackName = createCallbackName(submission.submissionId);
        const script = documentObject.createElement("script");
        const statusUrl = new URL(endpointUrl.toString());
        statusUrl.search = "";
        statusUrl.hash = "";
        statusUrl.searchParams.set("submissionId", submission.submissionId);
        statusUrl.searchParams.set("callback", callbackName);
        script.src = statusUrl.toString();
        script.async = true;

        activeScript = script;
        activeCallbackName = callbackName;
        let callbackUsed = false;

        Object.defineProperty(callbackTarget, callbackName, {
          configurable: true,
          enumerable: false,
          writable: false,
          value: (payload: unknown) => {
            if (settled || callbackUsed) {
              return;
            }
            callbackUsed = true;
            cleanupCurrentPoll();

            let receipt;
            try {
              receipt = parseReceiptStatus(payload);
            } catch {
              finish(new GasTransportError());
              return;
            }

            if (receipt.submissionId !== submission.submissionId) {
              finish(new GasTransportError());
              return;
            }

            if (receipt.status === "saved") {
              finish({ submissionId: receipt.submissionId, status: "saved" });
              return;
            }
            if (receipt.status === "not_found") {
              finish(new GasNotFoundError());
              return;
            }
            if (pollCount >= MAX_POLLS) {
              finish(new GasTimeoutError());
              return;
            }

            pollTimer = setTimeout(() => {
              pollTimer = undefined;
              poll();
            }, pollIntervalMs);
          },
        });

        script.onerror = () => {
          if (settled) {
            return;
          }
          cleanupCurrentPoll();
          finish(new GasTransportError());
        };
        documentObject.head.append(script);
      } catch {
        finish(new GasTransportError());
      }
    };

    options.signal?.addEventListener("abort", handleAbort, { once: true });
    if (options.signal?.aborted) {
      handleAbort();
      return;
    }

    let postRequest: Promise<Response>;
    try {
      postRequest = Promise.resolve(fetchImpl(endpointUrl.toString(), {
        method: "POST",
        mode: "no-cors",
        body: postBody,
        signal: requestController.signal,
      }));
    } catch {
      finish(new GasTransportError());
      return;
    }

    void postRequest.then(() => {
      if (settled) return;
      try {
        options.onConfirming?.();
      } catch {
        finish(new GasTransportError());
        return;
      }
      if (!settled) poll();
    }).catch(() => {
      if (!settled) {
        finish(new GasTransportError());
      }
    });
  });
}
