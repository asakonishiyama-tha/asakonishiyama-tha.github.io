import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as vm from "node:vm";

export const GAS_HEADERS = [
  "receivedAt",
  "submissionId",
  "intent",
  "talkSlug",
  "eventName",
  "company",
  "name",
  "email",
  "consultationTopic",
  "consultationMessage",
  "resultStage",
  "referrer",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "consentedAt",
  "slackStatus",
  "slackNotifiedAt",
  "slackRetryCount",
  "phone",
  "deleteAfter",
] as const;

export const DEFAULT_GAS_PROPERTIES = {
  THA_SHEET_ID: "test-sheet-id",
  THA_SHEET_NAME: "Leads",
  THA_STATUS_TTL_HOURS: "24",
  THA_SLACK_WEBHOOK_URL: "",
  THA_SLACK_SHEET_URL: "",
  THA_AUTOREPLY_ENABLED: "false",
  THA_AUTOREPLY_SENDER_NAME: "",
  THA_AUTOREPLY_REPLY_TO: "",
  THA_AUTOREPLY_SUBJECT: "",
  THA_AUTOREPLY_BODY: "",
} satisfies Record<string, string>;

type GasEvent = {
  parameter?: Record<string, string>;
  parameters?: Record<string, string[]>;
};

export type FakeTextOutput = {
  getContent(): string;
  getMimeType(): string;
  setMimeType(mimeType: string): FakeTextOutput;
};

type GasEntrypoints = {
  doGet(event: GasEvent): FakeTextOutput;
  doPost(event: GasEvent): FakeTextOutput;
  notifySlack(row: unknown[]): unknown;
  processPendingLeadNotifications?: () => void;
  retryFailedSlackNotifications(): void;
  sendAutoreply(submissionId: string): unknown;
};

export type FakeUrlFetchCall = {
  url: string;
  params: Record<string, unknown>;
};

export type FakeMailCall = {
  to: string;
  subject: string;
  body: string;
  name?: string;
  replyTo?: string;
};

export type FakeAdapterCall = {
  adapter: "UrlFetchApp.fetch" | "MailApp.sendEmail";
  implementation: "in-memory GAS VM fake";
  lockHeld: boolean;
};

export type GasRuntimeOptions = {
  now?: string;
  properties?: Record<string, string>;
  rows?: readonly (readonly unknown[])[];
  notes?: Readonly<Record<string, string>>;
  failOpen?: boolean;
  missingSheet?: boolean;
  failRead?: boolean;
  failHeaderWrite?: boolean;
  failAppend?: boolean;
  failFlush?: boolean;
  failLock?: boolean;
  failRangeWrite?: boolean;
  fetchResponses?: readonly (number | Error)[];
  fetchDelayMs?: number;
  failMail?: boolean;
  mailDelayMs?: number;
  uuidValues?: readonly string[];
};

export type GasRuntimeState = {
  nowMs: number;
  properties: Record<string, string>;
  rows: unknown[][];
  notes: Record<string, string>;
  logs: string[];
  openedSheetIds: string[];
  requestedSheetNames: string[];
  propertyReads: number;
  jsonParseLengths: number[];
  digestCalls: number;
  lockAttempts: number;
  lockAcquisitions: number;
  lockReleases: number;
  appendAttempts: number;
  headerWrites: number;
  flushCalls: number;
  rangeWrites: number;
  fetchCalls: FakeUrlFetchCall[];
  fetchLockStates: boolean[];
  mailCalls: FakeMailCall[];
  mailLockStates: boolean[];
  adapterCalls: FakeAdapterCall[];
  uuidCalls: number;
  operations: string[];
  htmlOutputs: number;
  failOpen: boolean;
  missingSheet: boolean;
  failRead: boolean;
  failHeaderWrite: boolean;
  failAppend: boolean;
  failFlush: boolean;
  failLock: boolean;
  failRangeWrite: boolean;
  failMail: boolean;
  beforeAppend?: () => void;
  beforeFetch?: () => void;
  beforeMail?: () => void;
};

const projectRoot = path.resolve(import.meta.dirname, "../..");
const sourceFiles = [
  "Config.gs",
  "Validation.gs",
  "Repository.gs",
  "Slack.gs",
  "Mail.gs",
  "Code.gs",
];

function cloneRows(rows: readonly (readonly unknown[])[]): unknown[][] {
  return rows.map((row) => [...row]);
}

function stringifyLogPart(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function createTextOutput(content = "", initialMimeType = "text/plain"): FakeTextOutput {
  let mimeType = initialMimeType;
  return {
    getContent: () => content,
    getMimeType: () => mimeType,
    setMimeType(nextMimeType: string) {
      mimeType = nextMimeType;
      return this;
    },
  };
}

export function createGasEvent(values: Record<string, string | string[]>): GasEvent {
  const parameter: Record<string, string> = {};
  const parameters: Record<string, string[]> = {};

  Object.entries(values).forEach(([key, rawValue]) => {
    const entries = Array.isArray(rawValue) ? [...rawValue] : [rawValue];
    parameters[key] = entries;
    if (entries[0] !== undefined) parameter[key] = entries[0];
  });

  return { parameter, parameters };
}

export function createGasRuntime(options: GasRuntimeOptions = {}) {
  const initialNow = options.now ?? "2026-08-24T03:04:05.678Z";
  const initialNowMs = Date.parse(initialNow);
  if (!Number.isFinite(initialNowMs)) throw new Error("The fake GAS clock must be an ISO date.");

  const state: GasRuntimeState = {
    nowMs: initialNowMs,
    properties: { ...DEFAULT_GAS_PROPERTIES, ...options.properties },
    rows: cloneRows(options.rows ?? []),
    notes: { ...options.notes },
    logs: [],
    openedSheetIds: [],
    requestedSheetNames: [],
    propertyReads: 0,
    jsonParseLengths: [],
    digestCalls: 0,
    lockAttempts: 0,
    lockAcquisitions: 0,
    lockReleases: 0,
    appendAttempts: 0,
    headerWrites: 0,
    flushCalls: 0,
    rangeWrites: 0,
    fetchCalls: [],
    fetchLockStates: [],
    mailCalls: [],
    mailLockStates: [],
    adapterCalls: [],
    uuidCalls: 0,
    operations: [],
    htmlOutputs: 0,
    failOpen: options.failOpen ?? false,
    missingSheet: options.missingSheet ?? false,
    failRead: options.failRead ?? false,
    failHeaderWrite: options.failHeaderWrite ?? false,
    failAppend: options.failAppend ?? false,
    failFlush: options.failFlush ?? false,
    failLock: options.failLock ?? false,
    failRangeWrite: options.failRangeWrite ?? false,
    failMail: options.failMail ?? false,
  };

  let lockHeld = false;
  const fetchResponses = [...(options.fetchResponses ?? [])];
  const fetchDelayMs = options.fetchDelayMs ?? 0;
  const mailDelayMs = options.mailDelayMs ?? 0;
  const uuidValues = [...(options.uuidValues ?? [])];
  let generatedUuidSequence = 1;
  const pendingSheetWrites: Array<() => void> = [];
  const releaseWaiters: Array<() => void> = [];

  class FixedDate extends Date {
    constructor(value?: string | number) {
      super(value === undefined ? state.nowMs : value);
    }

    static override now() {
      return state.nowMs;
    }
  }

  const readRange = (row: number, column: number, rowCount: number, columnCount: number) => {
    state.operations.push("sheet:values:read");
    if (state.failRead) throw new Error("fake sheet read failed");
    return Array.from({ length: rowCount }, (_, rowOffset) =>
      Array.from({ length: columnCount }, (_, columnOffset) =>
        state.rows[row - 1 + rowOffset]?.[column - 1 + columnOffset] ?? ""));
  };

  const noteKey = (row: number, column: number) => `${row}:${column}`;

  const readNote = (row: number, column: number) => {
    state.operations.push("sheet:note:read");
    if (state.failRead) throw new Error("fake sheet read failed");
    return state.notes[noteKey(row, column)] ?? "";
  };

  const writeNote = (row: number, column: number, note: string) => {
    if (state.failRangeWrite) throw new Error("fake sheet write failed");
    if (typeof note !== "string") throw new Error("fake note must be a string");
    const key = noteKey(row, column);
    state.operations.push("sheet:note:queue");
    pendingSheetWrites.push(() => {
      if (note.length === 0) delete state.notes[key];
      else state.notes[key] = note;
      state.rangeWrites += 1;
    });
  };

  const writeRange = (
    row: number,
    column: number,
    rowCount: number,
    columnCount: number,
    values: unknown[][],
  ) => {
    const isHeaderWrite = row === 1
      && column === 1
      && rowCount === 1
      && columnCount === GAS_HEADERS.length;
    if ((isHeaderWrite && state.failHeaderWrite) || (!isHeaderWrite && state.failRangeWrite)) {
      throw new Error("fake sheet write failed");
    }
    if (values.length !== rowCount || values.some((valueRow) => valueRow.length !== columnCount)) {
      throw new Error("fake range shape mismatch");
    }

    const queuedValues = values.map((valueRow) => [...valueRow]);
    state.operations.push(isHeaderWrite ? "sheet:header:queue" : "sheet:range:queue");
    pendingSheetWrites.push(() => {
      queuedValues.forEach((valueRow, rowOffset) => {
        const targetRow = row - 1 + rowOffset;
        state.rows[targetRow] ??= [];
        valueRow.forEach((value, columnOffset) => {
          state.rows[targetRow][column - 1 + columnOffset] = value;
        });
      });
      if (isHeaderWrite) state.headerWrites += 1;
      else state.rangeWrites += 1;
    });
  };

  const sheet = {
    getLastRow() {
      return state.rows.length;
    },
    getLastColumn() {
      return state.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0);
    },
    getRange(row: number, column: number, rowCount = 1, columnCount = 1) {
      if (![row, column, rowCount, columnCount].every(Number.isInteger)
        || row < 1 || column < 1 || rowCount < 1 || columnCount < 1) {
        throw new Error("fake invalid range");
      }
      const range = {
        getValues: () => readRange(row, column, rowCount, columnCount),
        setValues: (values: unknown[][]) => {
          writeRange(row, column, rowCount, columnCount, values);
          return range;
        },
        getNote: () => {
          if (rowCount !== 1 || columnCount !== 1) throw new Error("fake getNote requires one cell");
          return readNote(row, column);
        },
        setNote: (note: string) => {
          if (rowCount !== 1 || columnCount !== 1) throw new Error("fake setNote requires one cell");
          writeNote(row, column, note);
          return range;
        },
      };
      return range;
    },
    appendRow(row: unknown[]) {
      state.appendAttempts += 1;
      state.operations.push("sheet:append:attempt");
      const beforeAppend = state.beforeAppend;
      state.beforeAppend = undefined;
      beforeAppend?.();
      if (state.failAppend) throw new Error("fake append failed");
      const queuedRow = [...row];
      state.operations.push("sheet:append:queue");
      pendingSheetWrites.push(() => state.rows.push(queuedRow));
      return this;
    },
  };

  const captureLog = (...values: unknown[]) => {
    state.logs.push(values.map(stringifyLogPart).join(" "));
  };

  const sandbox = {
    Date: FixedDate,
    JSON: Object.freeze({
      parse(value: string) {
        state.jsonParseLengths.push(value.length);
        return JSON.parse(value);
      },
      stringify(value: unknown) {
        return JSON.stringify(value);
      },
    }),
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperties() {
            state.propertyReads += 1;
            return { ...state.properties };
          },
          getProperty(key: string) {
            state.propertyReads += 1;
            return Object.hasOwn(state.properties, key) ? state.properties[key] : null;
          },
          setProperty() {
            throw new Error("The Task 4 fake does not permit Script Property writes.");
          },
        };
      },
    },
    SpreadsheetApp: {
      flush() {
        state.flushCalls += 1;
        state.operations.push("sheet:flush:start");
        if (state.failFlush) {
          pendingSheetWrites.splice(0);
          state.operations.push("sheet:flush:fail");
          throw new Error("fake spreadsheet flush failed");
        }
        const writes = pendingSheetWrites.splice(0);
        writes.forEach((write) => write());
        state.operations.push("sheet:flush:commit");
      },
      openById(sheetId: string) {
        state.openedSheetIds.push(sheetId);
        if (state.failOpen) throw new Error("fake spreadsheet open failed");
        return {
          getSheetByName(sheetName: string) {
            state.requestedSheetNames.push(sheetName);
            return state.missingSheet ? null : sheet;
          },
        };
      },
    },
    LockService: {
      getScriptLock() {
        return {
          tryLock(timeoutMs: number) {
            if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
              throw new Error("fake lock timeout must be positive");
            }
            state.lockAttempts += 1;
            if (state.failLock || lockHeld) return false;
            lockHeld = true;
            state.lockAcquisitions += 1;
            state.operations.push("lock:acquire");
            return true;
          },
          releaseLock() {
            if (!lockHeld) throw new Error("fake lock was not held");
            lockHeld = false;
            state.lockReleases += 1;
            state.operations.push("lock:release");
            const waiter = releaseWaiters.shift();
            waiter?.();
          },
        };
      },
    },
    Utilities: Object.freeze({
      Charset: Object.freeze({ UTF_8: "UTF_8" }),
      DigestAlgorithm: Object.freeze({ SHA_256: "SHA_256" }),
      computeDigest(algorithm: string, value: string, charset: string) {
        if (algorithm !== "SHA_256" || charset !== "UTF_8" || typeof value !== "string") {
          throw new Error("The Task 4 fake implements only SHA-256 over UTF-8 text.");
        }
        state.digestCalls += 1;
        return Array.from(createHash("sha256").update(value, "utf8").digest(), (byte) => (
          byte > 127 ? byte - 256 : byte
        ));
      },
      formatDate(date: Date, timeZone: string, pattern: string) {
        if (timeZone === "UTC" && pattern === "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'") {
          return new Date(date).toISOString();
        }
        if (timeZone === "Asia/Tokyo" && pattern === "yyyy-MM-dd HH:mm:ss 'JST'") {
          const jstIso = new Date(new Date(date).getTime() + 9 * 60 * 60 * 1_000).toISOString();
          return `${jstIso.slice(0, 10)} ${jstIso.slice(11, 19)} JST`;
        }
        throw new Error("The fake implements only the approved UTC and JST date formats.");
      },
      getUuid() {
        state.uuidCalls += 1;
        const configured = uuidValues.shift();
        if (configured !== undefined) return configured;
        const suffix = generatedUuidSequence.toString(16).padStart(12, "0");
        generatedUuidSequence += 1;
        return `00000000-0000-4000-8000-${suffix}`;
      },
    }),
    UrlFetchApp: {
      fetch(url: string, params: Record<string, unknown>) {
        state.fetchCalls.push({ url, params: { ...params } });
        state.fetchLockStates.push(lockHeld);
        state.adapterCalls.push({
          adapter: "UrlFetchApp.fetch",
          implementation: "in-memory GAS VM fake",
          lockHeld,
        });
        state.operations.push("url-fetch:start");
        state.nowMs += fetchDelayMs;
        const response = fetchResponses.shift() ?? 200;
        const beforeFetch = state.beforeFetch;
        state.beforeFetch = undefined;
        beforeFetch?.();
        if (response instanceof Error) {
          state.operations.push("url-fetch:throw");
          throw response;
        }
        state.operations.push(`url-fetch:response:${response}`);
        return {
          getResponseCode() {
            return response;
          },
          getContentText() {
            return "fake response body";
          },
        };
      },
    },
    MailApp: {
      sendEmail(message: FakeMailCall) {
        state.mailCalls.push({ ...message });
        state.mailLockStates.push(lockHeld);
        state.adapterCalls.push({
          adapter: "MailApp.sendEmail",
          implementation: "in-memory GAS VM fake",
          lockHeld,
        });
        state.operations.push("mail:send");
        state.nowMs += mailDelayMs;
        const beforeMail = state.beforeMail;
        state.beforeMail = undefined;
        beforeMail?.();
        if (state.failMail) throw new Error("fake mail send failed");
      },
    },
    ContentService: {
      MimeType: Object.freeze({
        JAVASCRIPT: "application/javascript",
        TEXT: "text/plain",
      }),
      createTextOutput(content = "") {
        return createTextOutput(content);
      },
    },
    HtmlService: {
      createHtmlOutput(content = "") {
        state.htmlOutputs += 1;
        return createTextOutput(content, "text/html");
      },
    },
    console: Object.freeze({
      debug: captureLog,
      error: captureLog,
      info: captureLog,
      log: captureLog,
      warn: captureLog,
    }),
    Logger: Object.freeze({ log: captureLog }),
  };

  const context = vm.createContext(sandbox) as vm.Context & GasEntrypoints;
  sourceFiles.forEach((fileName) => {
    const absolutePath = path.join(projectRoot, "gas", fileName);
    const source = readFileSync(absolutePath, "utf8");
    new vm.Script(source, { filename: absolutePath }).runInContext(context);
  });

  return {
    context,
    state,
    queueAfterRelease(callback: () => void) {
      releaseWaiters.push(callback);
    },
    advanceHours(hours: number) {
      state.nowMs += hours * 60 * 60 * 1_000;
    },
    advanceMilliseconds(milliseconds: number) {
      state.nowMs += milliseconds;
    },
  };
}
