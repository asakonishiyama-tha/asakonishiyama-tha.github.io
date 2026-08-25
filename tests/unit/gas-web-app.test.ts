import { createHash } from "node:crypto";
import * as vm from "node:vm";

import { describe, expect, it } from "vitest";

import {
  createGasEvent,
  createGasRuntime,
  DEFAULT_GAS_PROPERTIES,
  GAS_HEADERS,
  type FakeTextOutput,
} from "@/tests/fixtures/gas-runtime";

const SUBMISSION_ID = "2f8a1f6b-7a1e-4ed8-9b4c-8a5d345d9c21";
const OTHER_SUBMISSION_ID = "1beec3b2-d782-41a8-9ae8-9bda184b58f1";
const THIRD_SUBMISSION_ID = "8c6076a7-904a-44bc-a483-528088a1f23d";
const FOURTH_SUBMISSION_ID = "f3134c2d-6be0-42c4-8fc8-cd37191e1234";
const FIFTH_SUBMISSION_ID = "aa4cfa52-d47f-46ae-b1a1-a0d3d49e5678";
const RECEIVED_AT = "2026-08-24T03:04:05.678Z";
const CONSENTED_AT = "2026-08-23T00:00:00.000Z";
const CANONICAL_EVENT_NAME = "THA AI社長 登壇セッション";
const LONG_LIVED_EVENT_NAME = "THA 老舗企業と時間資産 登壇セッション";
const GENERATED_CALLBACK = "__thaGasReceipt_2f8a1f6b_7a1e_4ed8_9b4c_8a5d345d9c21_1";
const FORMULA_PREFIXES = ["=", "+", "-", "@"] as const;
const EXCLUDED_DRAFT_SLUG = ["long", "lived", "companies"].join("-");
const FORMULA_CONTROLLED_FIELDS = [
  "companyName",
  "name",
  "email",
  "referrer",
  "utmSource",
  "utmMedium",
  "utmCampaign",
] as const;

function rejectedFreeMailAddress(): string {
  return ["private", [["g", "mail"].join(""), "com"].join(".")].join("@");
}

type SubmissionOverrides = Record<string, unknown>;
type LeadOverrides = Record<string, unknown>;
type Runtime = ReturnType<typeof createGasRuntime>;

function downloadSubmission(
  leadOverrides: LeadOverrides = {},
  submissionOverrides: SubmissionOverrides = {},
): Record<string, unknown> {
  return {
    submissionId: SUBMISSION_ID,
    website: "",
    consentedAt: CONSENTED_AT,
    ...submissionOverrides,
    lead: {
      intent: "download",
      companyName: "THA株式会社",
      name: "西山 朝子",
      email: "person@example.com",
      phone: "",
      consent: true,
      talkSlug: "ai-president-intro",
      eventName: CANONICAL_EVENT_NAME,
      diagnosisStage: "experiment",
      referrer: "https://example.com/source",
      utmSource: "newsletter",
      utmMedium: "email",
      utmCampaign: "launch",
      ...leadOverrides,
    },
  };
}

function consultationSubmission(
  leadOverrides: LeadOverrides = {},
  submissionOverrides: SubmissionOverrides = {},
): Record<string, unknown> {
  return downloadSubmission({
    intent: "consultation",
    consultationTopic: "ai-president",
    ...leadOverrides,
  }, submissionOverrides);
}

function postEvent(
  payload: Record<string, unknown>,
  formOverrides: Record<string, string | string[]> = {},
) {
  return createGasEvent({
    submissionId: String(payload.submissionId),
    payload: JSON.stringify(payload),
    ...formOverrides,
  });
}

function statusEvent(submissionId = SUBMISSION_ID, callback = GENERATED_CALLBACK) {
  return createGasEvent({ submissionId, callback });
}

function expectGenericPostOutput(output: FakeTextOutput) {
  expect(output.getMimeType()).toBe("text/plain");
  expect(output.getContent()).toBe("accepted");
}

function executeJsonp(output: FakeTextOutput, callback = GENERATED_CALLBACK) {
  expect(output.getMimeType()).toBe("application/javascript");
  const received: unknown[] = [];
  const sandbox = Object.create(null) as Record<string, unknown>;
  sandbox[callback] = (payload: unknown) => received.push(payload);
  const context = vm.createContext(sandbox);

  new vm.Script(output.getContent(), { filename: "gas-receipt.jsonp.js" }).runInContext(context, { timeout: 100 });

  expect(received).toHaveLength(1);
  return JSON.parse(JSON.stringify(received[0])) as Record<string, unknown>;
}

function post(runtime: Runtime, payload: Record<string, unknown>) {
  return runtime.context.doPost(postEvent(payload));
}

function receipt(runtime: Runtime, submissionId = SUBMISSION_ID) {
  return executeJsonp(runtime.context.doGet(statusEvent(submissionId)));
}

function storedRow(overrides: Partial<Record<(typeof GAS_HEADERS)[number], unknown>> = {}) {
  const values: Record<(typeof GAS_HEADERS)[number], unknown> = {
    receivedAt: RECEIVED_AT,
    submissionId: SUBMISSION_ID,
    intent: "download",
    talkSlug: "ai-president-intro",
    eventName: CANONICAL_EVENT_NAME,
    company: "THA株式会社",
    name: "",
    email: "person@example.com",
    consultationTopic: "",
    consultationMessage: "",
    resultStage: "experiment",
    referrer: "https://example.com/source",
    utmSource: "newsletter",
    utmMedium: "email",
    utmCampaign: "launch",
    consentedAt: CONSENTED_AT,
    slackStatus: "pending",
    slackNotifiedAt: "",
    slackRetryCount: 0,
    phone: "",
    deleteAfter: "2027-08-24T03:04:05.678Z",
    ...overrides,
  };
  return GAS_HEADERS.map((header) => values[header]);
}

function expectNoSavedRow(runtime: Runtime) {
  expect(runtime.state.rows.filter((row) => row[1] === SUBMISSION_ID)).toHaveLength(0);
}

describe("GAS lead storage", () => {
  it("initializes the exact header and maps a normalized download submission to all 21 columns", () => {
    const runtime = createGasRuntime();
    const payload = downloadSubmission({
      companyName: "  THA株式会社  ",
      name: "  西山 朝子  ",
      email: "  PERSON@EXAMPLE.COM  ",
      phone: "  +81 (3) 1234-5678  ",
      eventName: `  ${CANONICAL_EVENT_NAME}  `,
      referrer: "  https://example.com/source  ",
      utmSource: "  newsletter  ",
    });

    expectGenericPostOutput(post(runtime, payload));

    expect(runtime.state.rows).toEqual([
      [
        "receivedAt", "submissionId", "intent", "talkSlug", "eventName", "company", "name", "email",
        "consultationTopic", "consultationMessage", "resultStage", "referrer", "utmSource", "utmMedium",
        "utmCampaign", "consentedAt", "slackStatus", "slackNotifiedAt", "slackRetryCount",
        "phone", "deleteAfter",
      ],
      [
        RECEIVED_AT, SUBMISSION_ID, "download", "ai-president-intro", CANONICAL_EVENT_NAME, "THA株式会社",
        "西山 朝子", "person@example.com", "", "", "experiment", "https://example.com/source", "newsletter",
        "email", "launch", CONSENTED_AT, "pending", "", 0,
        "'+81 (3) 1234-5678", "2027-08-24T03:04:05.678Z",
      ],
    ]);
    expect(runtime.state.headerWrites).toBe(1);
    expect(runtime.state.openedSheetIds).toEqual(["test-sheet-id"]);
    expect(runtime.state.requestedSheetNames).toEqual(["Leads"]);
    expect(receipt(runtime)).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });
  });

  it("accepts both canonical Talk/event pairs and rejects a cross-Talk forged event", () => {
    const accepted = createGasRuntime();
    expectGenericPostOutput(post(accepted, downloadSubmission({
      talkSlug: "long-lived-companies",
      eventName: LONG_LIVED_EVENT_NAME,
    })));
    expect(accepted.state.rows[1]?.[3]).toBe("long-lived-companies");
    expect(accepted.state.rows[1]?.[4]).toBe(LONG_LIVED_EVENT_NAME);

    const forged = createGasRuntime();
    expectGenericPostOutput(post(forged, downloadSubmission({
      talkSlug: "long-lived-companies",
      eventName: CANONICAL_EVENT_NAME,
    })));
    expectNoSavedRow(forged);
  });

  it("requires a name and validates the optional phone at the GAS boundary", () => {
    for (const invalidLead of [
      { name: "" },
      { phone: "03-ABCD-5678" },
      { phone: "123456" },
      { phone: "=03-1234-5678" },
    ]) {
      const runtime = createGasRuntime();
      post(runtime, downloadSubmission(invalidLead));
      expectNoSavedRow(runtime);
    }
  });

  it("clamps a leap-day one-year deletion deadline to February 28", () => {
    const runtime = createGasRuntime({ now: "2028-02-29T12:34:56.789Z" });

    post(runtime, downloadSubmission());

    expect(runtime.state.rows[1]?.[20]).toBe("2029-02-28T12:34:56.789Z");
  });

  it.each([
    "ai-president",
    "smb-ai",
    "adoption",
    "succession",
    "time-assets",
    "other",
  ])("stores allowed consultation topic %s and always leaves consultationMessage empty", (topic) => {
    const runtime = createGasRuntime();
    const payload = consultationSubmission({ consultationTopic: topic });

    expectGenericPostOutput(post(runtime, payload));

    expect(runtime.state.rows[1]?.[2]).toBe("consultation");
    expect(runtime.state.rows[1]?.[8]).toBe(topic);
    expect(runtime.state.rows[1]?.[9]).toBe("");
    expect(receipt(runtime)).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });
  });

  it.each(["explore", "experiment", "systemize", "integrate"])(
    "maps allowed diagnosis stage %s to resultStage",
    (stage) => {
      const runtime = createGasRuntime();
      post(runtime, downloadSubmission({ diagnosisStage: stage }));

      expect(runtime.state.rows[1]?.[10]).toBe(stage);
    },
  );

  it("stores an omitted optional diagnosisStage as an empty resultStage", () => {
    const runtime = createGasRuntime();
    const payload = downloadSubmission();
    delete (payload.lead as Record<string, unknown>).diagnosisStage;

    post(runtime, payload);

    expect(runtime.state.rows[1]?.[10]).toBe("");
  });

  it("defaults omitted acquisition fields exactly as the TypeScript schema does", () => {
    const runtime = createGasRuntime();
    const payload = downloadSubmission();
    const lead = payload.lead as Record<string, unknown>;
    delete lead.referrer;
    delete lead.utmSource;
    delete lead.utmMedium;
    delete lead.utmCampaign;

    post(runtime, payload);

    expect(runtime.state.rows[1]?.slice(6, 7)).toEqual(["西山 朝子"]);
    expect(runtime.state.rows[1]?.slice(11, 15)).toEqual(["", "", "", ""]);
  });
});

describe("strict GAS validation", () => {
  it.each([
    ["companyName", 160, "界"],
    ["name", 120, "名"],
    ["referrer", 2_048, "r"],
    ["utmSource", 200, "s"],
    ["utmMedium", 200, "m"],
    ["utmCampaign", 200, "c"],
  ] as const)("accepts %s at %i characters and rejects the next character", (field, maximum, character) => {
    const boundaryRuntime = createGasRuntime();
    post(boundaryRuntime, downloadSubmission({ [field]: character.repeat(maximum) }));
    expect(receipt(boundaryRuntime)).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });

    const overflowRuntime = createGasRuntime();
    post(overflowRuntime, downloadSubmission({ [field]: character.repeat(maximum + 1) }));
    expectNoSavedRow(overflowRuntime);
  });

  it("accepts a 254-character business email and rejects 255 characters", () => {
    const suffix = "@corp.example";
    const boundaryEmail = `${"a".repeat(254 - suffix.length)}${suffix}`;
    const overflowEmail = `${"a".repeat(255 - suffix.length)}${suffix}`;
    const boundaryRuntime = createGasRuntime();
    post(boundaryRuntime, downloadSubmission({ email: boundaryEmail }));
    expect(receipt(boundaryRuntime)).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });

    const overflowRuntime = createGasRuntime();
    post(overflowRuntime, downloadSubmission({ email: overflowEmail }));
    expectNoSavedRow(overflowRuntime);
  });

  it.each([
    "person$tag@corp.example",
    ".person@corp.example",
    "person..tag@corp.example",
    "person@corp.12",
  ])("rejects email syntax that the current Zod business-email schema rejects: %s", (email) => {
    const runtime = createGasRuntime();
    post(runtime, downloadSubmission({ email }));
    expectNoSavedRow(runtime);
  });

  it.each([
    "person+tag@corp.example",
    "person@corp-.example",
  ])("accepts email syntax that the current Zod business-email schema accepts: %s", (email) => {
    const runtime = createGasRuntime();
    post(runtime, downloadSubmission({ email }));
    expect(receipt(runtime)).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });
  });

  it.each([
    "2026-08-23T00:00Z",
    "2026-08-23T00:00:00.1234567890Z",
  ])("accepts ISO consent time precision accepted by the current Zod datetime schema: %s", (consentedAt) => {
    const runtime = createGasRuntime();
    post(runtime, downloadSubmission({}, { consentedAt }));
    expect(receipt(runtime)).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });
  });

  it.each([
    "gmail.com",
    "googlemail.com",
    "icloud.com",
    "me.com",
    "mac.com",
    "outlook.com",
    "hotmail.com",
    "live.com",
    "msn.com",
    "yahoo.com",
    "aol.com",
    "proton.me",
    "protonmail.com",
  ])("rejects the free email domain %s after trim and case normalization", (domain) => {
    const runtime = createGasRuntime();
    post(runtime, downloadSubmission({ email: `  PERSON@${domain.toUpperCase()}  ` }));
    expectNoSavedRow(runtime);
  });

  it.each([
    ["empty company", { companyName: "   " }],
    ["company control character", { companyName: "THA\n株式会社" }],
    ["name control character", { name: "西山\t朝子" }],
    ["acquisition control character", { utmCampaign: "launch\u007fnow" }],
    ["invalid email", { email: "not-an-email" }],
    ["forged Talk", { talkSlug: EXCLUDED_DRAFT_SLUG }],
    ["forged event", { eventName: "THA AI社長 非公開セッション" }],
    ["unknown intent", { intent: "preview" }],
    ["unknown topic", { intent: "consultation", consultationTopic: "sales" }],
    ["unknown stage", { diagnosisStage: "master" }],
    ["false consent", { consent: false }],
  ])("rejects %s", (_label, leadOverrides) => {
    const runtime = createGasRuntime();
    post(runtime, downloadSubmission(leadOverrides));
    expectNoSavedRow(runtime);
  });

  it.each(FORMULA_CONTROLLED_FIELDS.flatMap((field) => FORMULA_PREFIXES.map((prefix) => [
    field,
    prefix,
    `  ${prefix}${field === "email" ? "person@example.com" : "formula"}`,
  ] as const)))("rejects normalized field %s beginning with formula prefix %s without appending a Sheet formula", (
    field,
    _prefix,
    value,
  ) => {
    const runtime = createGasRuntime();
    post(runtime, downloadSubmission({ [field]: value }));

    expect(runtime.state.appendAttempts).toBe(0);
    expectNoSavedRow(runtime);
    const storedText = runtime.state.rows.flat().filter((cell): cell is string => typeof cell === "string");
    expect(storedText.some((cell) => /^[=+\-@]/.test(cell.trim()))).toBe(false);
  });

  it("requires consultationTopic only for consultation intent", () => {
    const consultationRuntime = createGasRuntime();
    const consultation = consultationSubmission();
    delete (consultation.lead as Record<string, unknown>).consultationTopic;
    post(consultationRuntime, consultation);
    expectNoSavedRow(consultationRuntime);

    const downloadRuntime = createGasRuntime();
    post(downloadRuntime, downloadSubmission({ consultationTopic: "ai-president" }));
    expectNoSavedRow(downloadRuntime);
  });

  it.each(["answers", "score", "choiceIds", "resultStage", "ipAddress", "clientId"])(
    "rejects forbidden lead property %s",
    (field) => {
      const runtime = createGasRuntime();
      post(runtime, downloadSubmission({ [field]: field === "score" ? 3 : ["forbidden"] }));
      expectNoSavedRow(runtime);
    },
  );

  it.each(["receivedAt", "status", "requestId"])("rejects extra submission property %s", (field) => {
    const runtime = createGasRuntime();
    const payload = downloadSubmission({}, { [field]: "forbidden" });
    post(runtime, payload);
    expectNoSavedRow(runtime);
  });

  it("requires an empty honeypot, a valid UUID, and a real ISO consent timestamp", () => {
    const cases = [
      downloadSubmission({}, { website: "bot" }),
      downloadSubmission({}, { submissionId: "predictable" }),
      downloadSubmission({}, { consentedAt: "2026-02-30T00:00:00.000Z" }),
      downloadSubmission({}, { consentedAt: "2026-08-23" }),
    ];

    cases.forEach((payload) => {
      const runtime = createGasRuntime();
      post(runtime, payload);
      expectNoSavedRow(runtime);
    });
  });

  it.each([
    "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "01890f2e-7c5b-7cc4-98c0-123456789abc",
    "00000000-0000-0000-0000-000000000000",
    "ffffffff-ffff-ffff-ffff-ffffffffffff",
  ])("rejects non-crypto.randomUUID ID %s for both POST and receipt GET", (submissionId) => {
    const runtime = createGasRuntime();
    const payload = downloadSubmission({}, { submissionId });

    expectGenericPostOutput(post(runtime, payload));
    expect(runtime.state.appendAttempts).toBe(0);
    const output = runtime.context.doGet(statusEvent(submissionId));
    expect(output.getMimeType()).toBe("text/plain");
    expect(output.getContent()).toBe("invalid request");
  });

  it("rejects mismatched outer and payload submission IDs", () => {
    const runtime = createGasRuntime();
    const payload = downloadSubmission();

    expectGenericPostOutput(runtime.context.doPost(postEvent(payload, { submissionId: OTHER_SUBMISSION_ID })));
    expectNoSavedRow(runtime);
  });

  it("rejects extra, duplicate, missing, and malformed form parameters", () => {
    const payload = downloadSubmission();
    const events = [
      postEvent(payload, { mode: "save" }),
      createGasEvent({ submissionId: [SUBMISSION_ID, SUBMISSION_ID], payload: JSON.stringify(payload) }),
      createGasEvent({ submissionId: SUBMISSION_ID }),
      createGasEvent({ submissionId: SUBMISSION_ID, payload: "{" }),
      createGasEvent({ submissionId: SUBMISSION_ID, payload: "[]" }),
    ];

    events.forEach((event) => {
      const runtime = createGasRuntime();
      expectGenericPostOutput(runtime.context.doPost(event));
      expectNoSavedRow(runtime);
    });
  });

  it("parses a 16,384-character payload but rejects 16,385 characters before JSON parsing", () => {
    const boundaryRuntime = createGasRuntime();
    const boundaryPayload = `[${" ".repeat(16_382)}]`;
    expect(boundaryPayload).toHaveLength(16_384);
    boundaryRuntime.context.doPost(createGasEvent({
      submissionId: SUBMISSION_ID,
      payload: boundaryPayload,
    }));
    expect(boundaryRuntime.state.jsonParseLengths).toEqual([16_384]);
    expect(boundaryRuntime.state.appendAttempts).toBe(0);

    const overflowRuntime = createGasRuntime();
    const overflowPayload = `[${" ".repeat(16_383)}]`;
    expect(overflowPayload).toHaveLength(16_385);
    overflowRuntime.context.doPost(createGasEvent({
      submissionId: SUBMISSION_ID,
      payload: overflowPayload,
    }));
    expect(overflowRuntime.state.jsonParseLengths).toEqual([]);
    expect(overflowRuntime.state.appendAttempts).toBe(0);
  });
});

describe("configuration and Sheet failure boundaries", () => {
  it("uses only the exact documented configuration values", () => {
    const runtime = createGasRuntime({
      properties: {
        ...DEFAULT_GAS_PROPERTIES,
        THA_SHEET_ID: "approved-sheet",
        THA_SHEET_NAME: "Approved leads",
        THA_STATUS_TTL_HOURS: "12",
      },
    });

    post(runtime, downloadSubmission());

    expect(runtime.state.openedSheetIds).toEqual(["approved-sheet"]);
    expect(runtime.state.requestedSheetNames).toEqual(["Approved leads"]);
    expect(Object.keys(runtime.state.properties).sort()).toEqual([
      "THA_AUTOREPLY_BODY",
      "THA_AUTOREPLY_ENABLED",
      "THA_AUTOREPLY_REPLY_TO",
      "THA_AUTOREPLY_SENDER_NAME",
      "THA_AUTOREPLY_SUBJECT",
      "THA_SHEET_ID",
      "THA_SHEET_NAME",
      "THA_SLACK_SHEET_URL",
      "THA_SLACK_WEBHOOK_URL",
      "THA_STATUS_TTL_HOURS",
    ]);
  });

  it.each([
    ["THA_SHEET_ID", 256],
    ["THA_SHEET_NAME", 100],
  ] as const)("accepts trimmed %s at %i characters and rejects the next character", (key, maximum) => {
    const boundaryRuntime = createGasRuntime({ properties: { [key]: `  ${"a".repeat(maximum)}  ` } });
    post(boundaryRuntime, downloadSubmission());
    expect(receipt(boundaryRuntime)).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });

    const overflowRuntime = createGasRuntime({ properties: { [key]: "a".repeat(maximum + 1) } });
    post(overflowRuntime, downloadSubmission());
    expectNoSavedRow(overflowRuntime);
    expect(overflowRuntime.state.openedSheetIds).toEqual([]);
  });

  it.each(["THA_SHEET_ID", "THA_SHEET_NAME", "THA_STATUS_TTL_HOURS"])(
    "fails closed when required property %s is missing",
    (key) => {
      const runtime = createGasRuntime();
      delete runtime.state.properties[key];
      post(runtime, downloadSubmission());
      expectNoSavedRow(runtime);
    },
  );

  it("rejects undocumented Script Properties", () => {
    const runtime = createGasRuntime({ properties: { SECRET_EXTRA_KEY: "must-not-be-read" } });
    post(runtime, downloadSubmission());
    expectNoSavedRow(runtime);
  });

  it.each(["", "0", "0.5", "1.5", "-1", "721", "720.01", "NaN", "Infinity", "24 hours"])(
    "rejects invalid or overlong receipt TTL %s",
    (ttl) => {
      const runtime = createGasRuntime({ properties: { THA_STATUS_TTL_HOURS: ttl } });
      post(runtime, downloadSubmission());
      expectNoSavedRow(runtime);
    },
  );

  it.each(["1", "720"])("accepts integer receipt TTL %s from 1 through 720 hours", (ttl) => {
    const runtime = createGasRuntime({ properties: { THA_STATUS_TTL_HOURS: ttl } });
    post(runtime, downloadSubmission());
    expect(receipt(runtime)).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });
  });

  it("initializes the header only on a truly empty Sheet", () => {
    const runtime = createGasRuntime({ rows: [[]] });
    post(runtime, downloadSubmission());

    expect(runtime.state.headerWrites).toBe(0);
    expect(runtime.state.appendAttempts).toBe(0);
    expectNoSavedRow(runtime);
  });

  it.each([
    [["submissionId", "receivedAt"]],
    [[...GAS_HEADERS, "unexpected"]],
    [[...GAS_HEADERS.slice(0, -1)]],
  ])("rejects a non-empty Sheet whose header is not the exact 19-column contract", (header) => {
    const runtime = createGasRuntime({ rows: [header] });
    post(runtime, downloadSubmission());

    expect(runtime.state.headerWrites).toBe(0);
    expect(runtime.state.appendAttempts).toBe(0);
    expectNoSavedRow(runtime);
  });

  it("reuses an existing exact header without rewriting it", () => {
    const runtime = createGasRuntime({ rows: [[...GAS_HEADERS]] });
    post(runtime, downloadSubmission());

    expect(runtime.state.headerWrites).toBe(0);
    expect(runtime.state.appendAttempts).toBe(1);
    expect(runtime.state.rows).toHaveLength(2);
  });

  it.each([
    ["open", { failOpen: true }],
    ["missing sheet", { missingSheet: true }],
    ["read", { rows: [[...GAS_HEADERS]], failRead: true }],
    ["header write", { failHeaderWrite: true }],
    ["append", { rows: [[...GAS_HEADERS]], failAppend: true }],
  ] as const)("never saves after a Sheet %s failure and releases an acquired lock", (_label, options) => {
    const runtime = createGasRuntime(options);
    expectGenericPostOutput(post(runtime, downloadSubmission()));

    expectNoSavedRow(runtime);
    expect(runtime.state.lockAcquisitions).toBe(1);
    expect(runtime.state.lockReleases).toBe(1);
  });

  it("does not touch the Sheet or release a lock it did not acquire", () => {
    const runtime = createGasRuntime({ failLock: true });
    expectGenericPostOutput(post(runtime, downloadSubmission()));

    expect(runtime.state.lockAttempts).toBe(1);
    expect(runtime.state.lockAcquisitions).toBe(0);
    expect(runtime.state.lockReleases).toBe(0);
    expect(runtime.state.openedSheetIds).toEqual([]);
    expectNoSavedRow(runtime);
  });

  it("does not expose an append failure as a saved receipt", () => {
    const runtime = createGasRuntime({ rows: [[...GAS_HEADERS]], failAppend: true });
    post(runtime, downloadSubmission());
    runtime.state.failAppend = false;

    expect(receipt(runtime)).toEqual({ submissionId: SUBMISSION_ID, status: "not_found" });
    expect(runtime.state.rows).toEqual([[...GAS_HEADERS]]);
  });
});

describe("locked idempotency and receipt durability", () => {
  it("serializes duplicate submissions and appends the UUID only once", () => {
    const runtime = createGasRuntime();
    const payload = downloadSubmission();

    expectGenericPostOutput(post(runtime, payload));
    expectGenericPostOutput(post(runtime, payload));

    expect(runtime.state.rows).toHaveLength(2);
    expect(runtime.state.rows[1]?.[1]).toBe(SUBMISSION_ID);
    expect(runtime.state.appendAttempts).toBe(1);
    expect(runtime.state.lockAttempts).toBe(2);
    expect(runtime.state.lockAcquisitions).toBe(2);
    expect(runtime.state.lockReleases).toBe(2);
  });

  it("allows only one append when the same UUID arrives concurrently", () => {
    const runtime = createGasRuntime();
    const payload = downloadSubmission();
    let concurrentOutput: FakeTextOutput | undefined;
    runtime.state.beforeAppend = () => {
      concurrentOutput = post(runtime, payload);
    };

    expectGenericPostOutput(post(runtime, payload));

    expect(concurrentOutput).toBeDefined();
    expectGenericPostOutput(concurrentOutput!);
    expect(runtime.state.rows.filter((row) => row[1] === SUBMISSION_ID)).toHaveLength(1);
    expect(runtime.state.appendAttempts).toBe(1);
    expect(runtime.state.lockAttempts).toBe(2);
    expect(runtime.state.lockAcquisitions).toBe(1);
    expect(runtime.state.lockReleases).toBe(1);
  });

  it("flushes the saved row before releasing a waiting same-ID contender", () => {
    const runtime = createGasRuntime();
    const payload = downloadSubmission();
    let contenderOutput: FakeTextOutput | undefined;
    runtime.queueAfterRelease(() => {
      contenderOutput = post(runtime, payload);
    });

    expectGenericPostOutput(post(runtime, payload));

    expect(contenderOutput).toBeDefined();
    expectGenericPostOutput(contenderOutput!);
    expect(runtime.state.rows.filter((row) => row[1] === SUBMISSION_ID)).toHaveLength(1);
    expect(runtime.state.appendAttempts).toBe(1);
    expect(runtime.state.lockAcquisitions).toBe(2);
    expect(runtime.state.lockReleases).toBe(2);
    expect(runtime.state.flushCalls).toBe(2);
    const firstFlush = runtime.state.operations.indexOf("sheet:flush:commit");
    const firstRelease = runtime.state.operations.indexOf("lock:release");
    const secondAcquire = runtime.state.operations.indexOf("lock:acquire", firstRelease + 1);
    const contenderRead = runtime.state.operations.indexOf("sheet:values:read", secondAcquire + 1);
    expect(firstFlush).toBeGreaterThan(-1);
    expect(firstFlush).toBeLessThan(firstRelease);
    expect(firstRelease).toBeLessThan(secondAcquire);
    expect(secondAcquire).toBeLessThan(contenderRead);
  });

  it("releases the script lock in a nested finally when flush fails without exposing saved", () => {
    const runtime = createGasRuntime({ rows: [[...GAS_HEADERS]], failFlush: true });

    expectGenericPostOutput(post(runtime, downloadSubmission()));

    expect(runtime.state.flushCalls).toBe(1);
    expect(runtime.state.lockAcquisitions).toBe(1);
    expect(runtime.state.lockReleases).toBe(1);
    expect(runtime.state.rows).toEqual([[...GAS_HEADERS]]);
    runtime.state.failFlush = false;
    expect(receipt(runtime)).toEqual({ submissionId: SUBMISSION_ID, status: "not_found" });
  });

  it("derives saved status from the durable Sheet instead of VM memory", () => {
    const writer = createGasRuntime();
    post(writer, downloadSubmission());
    expect(receipt(writer)).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });

    const freshEmptyVm = createGasRuntime();
    expect(receipt(freshEmptyVm)).toEqual({ submissionId: SUBMISSION_ID, status: "not_found" });

    const freshDurableVm = createGasRuntime({ rows: writer.state.rows });
    expect(receipt(freshDurableVm)).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });
  });

  it("returns not_found for an unknown UUID", () => {
    const runtime = createGasRuntime({ rows: [[...GAS_HEADERS], storedRow()] });
    expect(receipt(runtime, OTHER_SUBMISSION_ID)).toEqual({
      submissionId: OTHER_SUBMISSION_ID,
      status: "not_found",
    });
  });

  it("expires a durable receipt after the configured TTL without appending it again", () => {
    const runtime = createGasRuntime({ rows: [[...GAS_HEADERS], storedRow()] });
    runtime.advanceHours(24.001);

    expect(receipt(runtime)).toEqual({ submissionId: SUBMISSION_ID, status: "not_found" });
    post(runtime, downloadSubmission());
    expect(runtime.state.appendAttempts).toBe(0);
    expect(runtime.state.rows).toHaveLength(2);
    expect(receipt(runtime)).toEqual({ submissionId: SUBMISSION_ID, status: "not_found" });
  });

  it.each([
    "not-a-date",
    "2026-02-30T00:00:00.000Z",
    "2026-08-25T03:04:05.678Z",
  ])("never reports saved for malformed or future receivedAt value %s", (receivedAt) => {
    const runtime = createGasRuntime({ rows: [[...GAS_HEADERS], storedRow({ receivedAt })] });
    expect(receipt(runtime)).toEqual({ submissionId: SUBMISSION_ID, status: "not_found" });
  });
});

describe("in-lock normalized-email abuse suppression", () => {
  const submissionIds = [
    SUBMISSION_ID,
    OTHER_SUBMISSION_ID,
    THIRD_SUBMISSION_ID,
    FOURTH_SUBMISSION_ID,
  ] as const;

  function submissionFor(submissionId: string, email = "person@example.com") {
    return downloadSubmission({ email }, { submissionId });
  }

  it("saves the first three new UUIDs in ten minutes and rejects the fourth after email normalization", () => {
    const runtime = createGasRuntime();
    const emails = [
      "  PERSON@EXAMPLE.COM  ",
      "person@example.com",
      "Person@Example.Com",
      " person@EXAMPLE.com ",
    ];

    submissionIds.forEach((submissionId, index) => {
      expectGenericPostOutput(post(runtime, submissionFor(submissionId, emails[index])));
    });

    expect(runtime.state.rows.slice(1).map((row) => row[1])).toEqual(submissionIds.slice(0, 3));
    expect(runtime.state.rows.slice(1).map((row) => row[7])).toEqual([
      "person@example.com",
      "person@example.com",
      "person@example.com",
    ]);
    expect(runtime.state.appendAttempts).toBe(3);
    expect(runtime.state.digestCalls).toBeGreaterThan(0);
    expect(receipt(runtime, FOURTH_SUBMISSION_ID)).toEqual({
      submissionId: FOURTH_SUBMISSION_ID,
      status: "not_found",
    });
  });

  it("checks UUID idempotency before suppression and does not consume a second slot", () => {
    const runtime = createGasRuntime();

    expectGenericPostOutput(post(runtime, submissionFor(SUBMISSION_ID)));
    const digestCallsAfterFirstSave = runtime.state.digestCalls;
    expectGenericPostOutput(post(runtime, submissionFor(SUBMISSION_ID)));
    expect(runtime.state.digestCalls).toBe(digestCallsAfterFirstSave);

    expectGenericPostOutput(post(runtime, submissionFor(OTHER_SUBMISSION_ID)));
    expectGenericPostOutput(post(runtime, submissionFor(THIRD_SUBMISSION_ID)));
    expectGenericPostOutput(post(runtime, submissionFor(SUBMISSION_ID)));
    expectGenericPostOutput(post(runtime, submissionFor(FOURTH_SUBMISSION_ID)));

    expect(runtime.state.rows.slice(1).map((row) => row[1])).toEqual([
      SUBMISSION_ID,
      OTHER_SUBMISSION_ID,
      THIRD_SUBMISSION_ID,
    ]);
    expect(runtime.state.appendAttempts).toBe(3);
    expect(receipt(runtime, SUBMISSION_ID)).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });
    expect(receipt(runtime, FOURTH_SUBMISSION_ID)).toEqual({
      submissionId: FOURTH_SUBMISSION_ID,
      status: "not_found",
    });
  });

  it("includes the exact ten-minute boundary and excludes rows one millisecond older", () => {
    const exactlyTenMinutesAgo = "2026-08-24T02:54:05.678Z";
    const justOutsideWindow = "2026-08-24T02:54:05.677Z";
    const recentRows = submissionIds.slice(0, 3).map((submissionId) => storedRow({
      submissionId,
      receivedAt: exactlyTenMinutesAgo,
    }));
    const boundaryRuntime = createGasRuntime({ rows: [[...GAS_HEADERS], ...recentRows] });

    expectGenericPostOutput(post(boundaryRuntime, submissionFor(FOURTH_SUBMISSION_ID)));
    expect(boundaryRuntime.state.appendAttempts).toBe(0);
    expect(boundaryRuntime.state.rows).toHaveLength(4);

    const oldRows = submissionIds.slice(0, 3).map((submissionId) => storedRow({
      submissionId,
      receivedAt: justOutsideWindow,
    }));
    const outsideRuntime = createGasRuntime({ rows: [[...GAS_HEADERS], ...oldRows] });
    expectGenericPostOutput(post(outsideRuntime, submissionFor(FOURTH_SUBMISSION_ID)));
    expect(outsideRuntime.state.appendAttempts).toBe(1);
    expect(outsideRuntime.state.rows.at(-1)?.[1]).toBe(FOURTH_SUBMISSION_ID);
  });

  it("allows a fourth recent submission when its normalized email hash differs", () => {
    const rows = submissionIds.slice(0, 3).map((submissionId) => storedRow({ submissionId }));
    const runtime = createGasRuntime({ rows: [[...GAS_HEADERS], ...rows] });

    expectGenericPostOutput(post(runtime, submissionFor(FOURTH_SUBMISSION_ID, "other@example.com")));

    expect(runtime.state.appendAttempts).toBe(1);
    expect(runtime.state.rows.at(-1)?.[1]).toBe(FOURTH_SUBMISSION_ID);
    expect(runtime.state.rows.at(-1)?.[7]).toBe("other@example.com");
  });

  it("serializes four waiting new UUIDs so only three are durably appended", () => {
    const runtime = createGasRuntime();
    const contenderOutputs: FakeTextOutput[] = [];
    submissionIds.slice(1).forEach((submissionId) => {
      runtime.queueAfterRelease(() => {
        contenderOutputs.push(post(runtime, submissionFor(submissionId)));
      });
    });

    expectGenericPostOutput(post(runtime, submissionFor(SUBMISSION_ID)));

    expect(contenderOutputs).toHaveLength(3);
    contenderOutputs.forEach(expectGenericPostOutput);
    expect(runtime.state.lockAcquisitions).toBe(4);
    expect(runtime.state.lockReleases).toBe(4);
    expect(runtime.state.flushCalls).toBe(4);
    expect(runtime.state.appendAttempts).toBe(3);
    expect(runtime.state.rows.slice(1).map((row) => row[1])).toEqual(submissionIds.slice(0, 3));
    expect(receipt(runtime, FOURTH_SUBMISSION_ID)).toEqual({
      submissionId: FOURTH_SUBMISSION_ID,
      status: "not_found",
    });
  });

  it("keeps the SHA-256 digest ephemeral and raw email only in the approved Sheet column", () => {
    const runtime = createGasRuntime();
    const outputs = submissionIds.map((submissionId) => post(runtime, submissionFor(submissionId)));
    const digest = createHash("sha256").update("person@example.com", "utf8");
    const digestHex = digest.copy().digest("hex");
    const digestBase64 = digest.copy().digest("base64");
    const signedDigest = Array.from(digest.digest(), (byte) => byte > 127 ? byte - 256 : byte);

    expect(runtime.state.digestCalls).toBeGreaterThan(0);
    expect(runtime.state.logs).toEqual([]);
    expect(JSON.stringify(runtime.state.properties)).not.toContain("person@example.com");
    expect(JSON.stringify(runtime.state.rows)).not.toContain(digestHex);
    expect(JSON.stringify(runtime.state.rows)).not.toContain(digestBase64);
    expect(JSON.stringify(runtime.state.rows)).not.toContain(JSON.stringify(signedDigest));
    runtime.state.rows.slice(1).forEach((row) => {
      row.forEach((cell, columnIndex) => {
        if (columnIndex !== 7) expect(String(cell)).not.toContain("person@example.com");
      });
    });
    outputs.forEach((output) => {
      expectGenericPostOutput(output);
      expect(output.getContent()).not.toContain("person@example.com");
      expect(output.getContent()).not.toContain(digestHex);
    });
    expect(runtime.state.operations.join("\n")).not.toContain("person@example.com");
    expect(runtime.state.rows.slice(1)).toHaveLength(3);
  });

  it("ignores malformed, future, and non-v4 rows rather than treating them as successful saves", () => {
    const rows = [
      storedRow({ submissionId: "not-a-uuid" }),
      storedRow({ submissionId: OTHER_SUBMISSION_ID, receivedAt: "not-a-date" }),
      storedRow({ submissionId: THIRD_SUBMISSION_ID, receivedAt: "2026-08-24T03:04:05.679Z" }),
    ];
    const runtime = createGasRuntime({ rows: [[...GAS_HEADERS], ...rows] });

    expectGenericPostOutput(post(runtime, submissionFor(FOURTH_SUBMISSION_ID)));

    expect(runtime.state.appendAttempts).toBe(1);
    expect(runtime.state.rows.at(-1)?.[1]).toBe(FOURTH_SUBMISSION_ID);
  });

  it("counts only the candidate email even when several recent successful emails coexist", () => {
    const runtime = createGasRuntime({
      rows: [
        [...GAS_HEADERS],
        storedRow({ submissionId: SUBMISSION_ID }),
        storedRow({ submissionId: OTHER_SUBMISSION_ID, email: "other@example.com" }),
        storedRow({ submissionId: THIRD_SUBMISSION_ID, email: "third@example.com" }),
      ],
    });

    expectGenericPostOutput(post(runtime, submissionFor(FIFTH_SUBMISSION_ID)));

    expect(runtime.state.appendAttempts).toBe(1);
    expect(runtime.state.rows.at(-1)?.[1]).toBe(FIFTH_SUBMISSION_ID);
  });
});

describe("JSONP and privacy boundary", () => {
  it("returns only submissionId and saved status as JavaScript for a durable row", () => {
    const runtime = createGasRuntime({ rows: [[...GAS_HEADERS], storedRow()] });
    const output = runtime.context.doGet(statusEvent());
    const parsed = executeJsonp(output);

    expect(parsed).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });
    expect(Object.keys(parsed).sort()).toEqual(["status", "submissionId"]);
    expect(output.getContent()).not.toContain("person@example.com");
    expect(output.getContent()).not.toContain("THA株式会社");
    expect(output.getContent()).not.toContain("test-sheet-id");
  });

  it.each([
    GENERATED_CALLBACK,
    "__thaGasReceipt_2f8a1f6b_7a1e_4ed8_9b4c_8a5d345d9c21_z9",
    `__thaGasReceipt_2f8a1f6b_7a1e_4ed8_9b4c_8a5d345d9c21_${"a".repeat(75)}`,
  ])("accepts and executes exact flat generated callback %s", (callback) => {
    const runtime = createGasRuntime();
    const output = runtime.context.doGet(statusEvent(SUBMISSION_ID, callback));
    expect(executeJsonp(output, callback)).toEqual({ submissionId: SUBMISSION_ID, status: "not_found" });
  });

  it.each([
    "",
    "thaReceipt_1",
    "THA.receipts.handle_2",
    "constructor",
    "prototype",
    "__proto__",
    "__thaGasReceipt_2f8a1f6b_7a1e_4ed8_9b4c_8a5d345d9c21.constructor",
    "__thaGasReceipt___proto__",
    ".receipt",
    "receipt.",
    "receipt..next",
    "1receipt",
    "$receipt",
    "receipt-name",
    "receipt()",
    "receipt alert",
    "受領",
    "receipt/next",
    "receipt\nnext",
    `__thaGasReceipt_2f8a1f6b_7a1e_4ed8_9b4c_8a5d345d9c21_${"a".repeat(76)}`,
  ])("rejects unsafe callback %j without reflecting it into JavaScript", (callback) => {
    const runtime = createGasRuntime();
    const output = runtime.context.doGet(statusEvent(SUBMISSION_ID, callback));

    expect(output.getMimeType()).toBe("text/plain");
    expect(output.getContent()).toBe("invalid request");
    if (callback.length > 0) expect(output.getContent()).not.toContain(callback);
  });

  it("rejects invalid UUIDs and non-exact GET query parameters before emitting JavaScript", () => {
    const runtime = createGasRuntime();
    const events = [
      statusEvent("predictable", "thaReceipt"),
      createGasEvent({ submissionId: SUBMISSION_ID, callback: "thaReceipt", email: "person@example.com" }),
      createGasEvent({ submissionId: SUBMISSION_ID, callback: ["thaReceipt", "other"] }),
      createGasEvent({ callback: "thaReceipt" }),
    ];

    events.forEach((event) => {
      const output = runtime.context.doGet(event);
      expect(output.getMimeType()).toBe("text/plain");
      expect(output.getContent()).toBe("invalid request");
    });
  });

  it("keeps successful and failed POST bodies identical and never logs PII or configuration", () => {
    const runtime = createGasRuntime({ rows: [[...GAS_HEADERS]] });
    const rejectedEmail = rejectedFreeMailAddress();
    const valid = downloadSubmission({
      companyName: "PRIVATE COMPANY",
      name: "PRIVATE PERSON",
      email: "private@business.example",
    });
    const validOutput = post(runtime, valid);
    const rowCountAfterValidPost = runtime.state.rows.length;
    const invalidOutput = post(runtime, downloadSubmission({ email: rejectedEmail }, {
      submissionId: OTHER_SUBMISSION_ID,
    }));
    const statusOutput = runtime.context.doGet(statusEvent());
    const combinedOutput = [validOutput.getContent(), invalidOutput.getContent(), statusOutput.getContent()].join(" ");
    const combinedLogs = runtime.state.logs.join(" ");

    expectGenericPostOutput(validOutput);
    expectGenericPostOutput(invalidOutput);
    expect(runtime.state.rows).toHaveLength(rowCountAfterValidPost);
    expect(validOutput.getContent()).toBe(invalidOutput.getContent());
    for (const privateValue of [
      "PRIVATE COMPANY",
      "PRIVATE PERSON",
      "private@business.example",
      rejectedEmail,
      "test-sheet-id",
      "https://example.com/source",
      "newsletter",
    ]) {
      expect(combinedOutput).not.toContain(privateValue);
      expect(combinedLogs).not.toContain(privateValue);
    }
    expect(runtime.state.logs).toEqual([]);
    expect(runtime.state.htmlOutputs).toBe(0);
  });
});
