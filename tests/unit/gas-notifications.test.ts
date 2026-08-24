import { readFileSync } from "node:fs";
import path from "node:path";
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
const RECEIVED_AT = "2026-08-24T03:04:05.678Z";
const CONSENTED_AT = "2026-08-23T00:00:00.000Z";
const CANONICAL_EVENT_NAME = "THA AI社長 登壇セッション";
const CALLBACK = "__thaGasReceipt_2f8a1f6b_7a1e_4ed8_9b4c_8a5d345d9c21_1";
const SLACK_WEBHOOK_URL = [
  "https:/",
  "hooks.slack.com",
  "services",
  "approved-team",
  "approved-channel",
  "approved-token",
].join("/");
const SHEET_URL = "https://docs.google.com/spreadsheets/d/approved-sheet_123/edit#gid=0";
const SUBMISSION_NOTE_KEY = "2:2";

const VALID_SLACK_PROPERTIES = {
  THA_SLACK_WEBHOOK_URL: SLACK_WEBHOOK_URL,
  THA_SLACK_SHEET_URL: SHEET_URL,
};

const VALID_MAIL_PROPERTIES = {
  THA_AUTOREPLY_ENABLED: "true",
  THA_AUTOREPLY_SENDER_NAME: "THA登壇事務局",
  THA_AUTOREPLY_REPLY_TO: "reply@example.com",
  THA_AUTOREPLY_SUBJECT: "お申し込みを受け付けました",
  THA_AUTOREPLY_BODY: "お問い合わせありがとうございます。\n担当者よりご連絡します。",
};

type Runtime = ReturnType<typeof createGasRuntime>;
type LeadOverrides = Record<string, unknown>;
type SubmissionOverrides = Record<string, unknown>;

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
      consent: true,
      talkSlug: "ai-president-intro",
      eventName: CANONICAL_EVENT_NAME,
      diagnosisStage: "experiment",
      referrer: "https://example.com/private-source",
      utmSource: "private-newsletter",
      utmMedium: "private-email",
      utmCampaign: "private-launch",
      ...leadOverrides,
    },
  };
}

function consultationSubmission(
  leadOverrides: LeadOverrides = {},
  submissionOverrides: SubmissionOverrides = {},
) {
  return downloadSubmission({
    intent: "consultation",
    consultationTopic: "ai-president",
    ...leadOverrides,
  }, submissionOverrides);
}

function postEvent(payload: Record<string, unknown>) {
  return createGasEvent({
    submissionId: String(payload.submissionId),
    payload: JSON.stringify(payload),
  });
}

function post(runtime: Runtime, payload: Record<string, unknown>) {
  return runtime.context.doPost(postEvent(payload));
}

function processNotifications(runtime: Runtime) {
  expect(runtime.context.processPendingLeadNotifications).toBeTypeOf("function");
  runtime.context.processPendingLeadNotifications?.();
}

function postAndProcess(runtime: Runtime, payload: Record<string, unknown>) {
  const output = post(runtime, payload);
  processNotifications(runtime);
  return output;
}

function expectGenericPostOutput(output: FakeTextOutput) {
  expect(output.getMimeType()).toBe("text/plain");
  expect(output.getContent()).toBe("accepted");
}

function receipt(runtime: Runtime, submissionId = SUBMISSION_ID) {
  const callback = submissionId === SUBMISSION_ID
    ? CALLBACK
    : `__thaGasReceipt_${submissionId.replaceAll("-", "_")}_1`;
  const output = runtime.context.doGet(createGasEvent({ submissionId, callback }));
  expect(output.getMimeType()).toBe("application/javascript");
  const received: unknown[] = [];
  const sandbox = Object.create(null) as Record<string, unknown>;
  sandbox[callback] = (payload: unknown) => received.push(payload);
  new vm.Script(output.getContent()).runInContext(vm.createContext(sandbox));
  return JSON.parse(JSON.stringify(received[0])) as Record<string, unknown>;
}

function storedRow(overrides: Partial<Record<(typeof GAS_HEADERS)[number], unknown>> = {}) {
  const values: Record<(typeof GAS_HEADERS)[number], unknown> = {
    receivedAt: RECEIVED_AT,
    submissionId: SUBMISSION_ID,
    intent: "download",
    talkSlug: "ai-president-intro",
    eventName: CANONICAL_EVENT_NAME,
    company: "THA株式会社",
    name: "西山 朝子",
    email: "person@example.com",
    consultationTopic: "",
    consultationMessage: "",
    resultStage: "experiment",
    referrer: "https://example.com/private-source",
    utmSource: "private-newsletter",
    utmMedium: "private-email",
    utmCampaign: "private-launch",
    consentedAt: CONSENTED_AT,
    slackStatus: "pending",
    slackNotifiedAt: "",
    slackRetryCount: 0,
    ...overrides,
  };
  return GAS_HEADERS.map((header) => values[header]);
}

function runtimeWithSlack(options: Parameters<typeof createGasRuntime>[0] = {}) {
  return createGasRuntime({
    ...options,
    properties: {
      ...VALID_SLACK_PROPERTIES,
      ...options.properties,
    },
  });
}

function slackRequestText(runtime: Runtime, callIndex = 0) {
  const call = runtime.state.fetchCalls[callIndex];
  expect(call).toBeDefined();
  expect(call?.url).toBe(SLACK_WEBHOOK_URL);
  expect(call?.params).toEqual({
    method: "post",
    contentType: "application/json; charset=utf-8",
    payload: expect.any(String),
    muteHttpExceptions: true,
    timeoutSeconds: 30,
  });
  const payload = JSON.parse(String(call?.params.payload)) as Record<string, unknown>;
  expect(Object.keys(payload)).toEqual(["text", "mrkdwn", "unfurl_links", "unfurl_media"]);
  expect(typeof payload.text).toBe("string");
  expect(payload.mrkdwn).toBe(false);
  expect(payload.unfurl_links).toBe(false);
  expect(payload.unfurl_media).toBe(false);
  return payload.text as string;
}

describe("storage-only POST and owner notification processor", () => {
  it("durably saves and returns before configured slow throwing adapters, then the owner processor invokes both fakes", () => {
    const runtime = runtimeWithSlack({
      properties: VALID_MAIL_PROPERTIES,
      fetchResponses: [new Error("slow Slack failure")],
      fetchDelayMs: 12_000,
      failMail: true,
      mailDelayMs: 8_000,
    });
    const beforePostMs = runtime.state.nowMs;

    expectGenericPostOutput(post(runtime, downloadSubmission()));

    expect(runtime.state.nowMs).toBe(beforePostMs);
    expect(runtime.state.adapterCalls).toEqual([]);
    expect(runtime.state.fetchCalls).toEqual([]);
    expect(runtime.state.mailCalls).toEqual([]);
    expect(runtime.state.rows[1]?.slice(16, 19)).toEqual(["pending", "", 0]);
    expect(runtime.state.notes).toEqual({});
    expect(receipt(runtime)).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });

    processNotifications(runtime);

    expect(runtime.state.nowMs).toBe(beforePostMs + 20_000);
    expect(runtime.state.adapterCalls).toEqual([
      {
        adapter: "UrlFetchApp.fetch",
        implementation: "in-memory GAS VM fake",
        lockHeld: false,
      },
      {
        adapter: "MailApp.sendEmail",
        implementation: "in-memory GAS VM fake",
        lockHeld: false,
      },
    ]);
    expect(runtime.state.rows[1]?.slice(16, 19)).toEqual(["failed", "", 0]);
    expect(runtime.state.notes[SUBMISSION_NOTE_KEY]).toMatch(
      /^tha-autoreply:v1\|failed\|2026-08-24T03:04:25\.678Z\|[0-9a-f-]{36}$/,
    );
    expect(receipt(runtime)).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });
  });
});

describe("privacy-safe Slack formatting", () => {
  it("sends the exact download message with the server-owned Talk and stage labels", () => {
    const runtime = runtimeWithSlack();

    expectGenericPostOutput(postAndProcess(runtime, downloadSubmission()));

    expect(slackRequestText(runtime)).toBe([
      "【THA登壇サイト 新規申込】",
      "",
      "種別：資料請求",
      "会社名：THA株式会社",
      "氏名：西山 朝子様",
      "対象Talk：会社に、もう一人の社長がいたら。",
      "診断結果：実験期",
      "受付日時：2026-08-24 12:04:05 JST",
      "",
      `詳細：${SHEET_URL}`,
    ].join("\n"));
  });

  it("adds only the canonical consultation topic line for a consultation", () => {
    const runtime = runtimeWithSlack();

    postAndProcess(runtime, consultationSubmission({ diagnosisStage: "explore" }));

    expect(slackRequestText(runtime)).toBe([
      "【THA登壇サイト 新規申込】",
      "",
      "種別：相談申込",
      "会社名：THA株式会社",
      "氏名：西山 朝子様",
      "対象Talk：会社に、もう一人の社長がいたら。",
      "診断結果：探索期",
      "相談テーマ：AI社長について相談したい",
      "受付日時：2026-08-24 12:04:05 JST",
      "",
      `詳細：${SHEET_URL}`,
    ].join("\n"));
  });

  it.each([
    ["explore", "探索期"],
    ["experiment", "実験期"],
    ["systemize", "仕組み化期"],
    ["integrate", "経営統合期"],
  ])("maps stage %s to the canonical display label %s", (resultStage, label) => {
    const runtime = runtimeWithSlack();
    postAndProcess(runtime, downloadSubmission({ diagnosisStage: resultStage }));
    expect(slackRequestText(runtime)).toContain(`診断結果：${label}`);
  });

  it.each([
    ["ai-president", "AI社長について相談したい"],
    ["smb-ai", "中小企業のAI活用について相談したい"],
    ["adoption", "AI導入・定着について相談したい"],
    ["succession", "事業承継について相談したい"],
    ["time-assets", "会社らしさ・判断資産の言語化について相談したい"],
    ["other", "その他"],
  ])("maps consultation topic %s to the canonical display label", (consultationTopic, label) => {
    const runtime = runtimeWithSlack();
    postAndProcess(runtime, consultationSubmission({ consultationTopic }));
    expect(slackRequestText(runtime)).toContain(`相談テーマ：${label}`);
  });

  it("uses explicit missing-value labels when name and diagnosis are absent", () => {
    const runtime = runtimeWithSlack();
    const payload = downloadSubmission({ name: "" });
    delete (payload.lead as Record<string, unknown>).diagnosisStage;

    postAndProcess(runtime, payload);

    expect(slackRequestText(runtime)).toBe([
      "【THA登壇サイト 新規申込】",
      "",
      "種別：資料請求",
      "会社名：THA株式会社",
      "氏名：未入力様",
      "対象Talk：会社に、もう一人の社長がいたら。",
      "診断結果：未診断",
      "受付日時：2026-08-24 12:04:05 JST",
      "",
      `詳細：${SHEET_URL}`,
    ].join("\n"));
  });

  it("escapes Slack mrkdwn control characters so submitted text cannot mention users or channels", () => {
    const runtime = runtimeWithSlack();
    postAndProcess(runtime, downloadSubmission({
      companyName: "<@U123>& <!channel>",
      name: "<https://evil.example|click>",
    }));

    const text = slackRequestText(runtime);
    expect(text).toContain("会社名：&lt;@U123&gt;&amp; &lt;!channel&gt;");
    expect(text).toContain("氏名：&lt;https[:]//evil[.]example|click&gt;様");
    expect(text).not.toContain("<@U123>");
    expect(text).not.toContain("<!channel>");
    expect(text).not.toContain("<https://evil.example|click>");
  });

  it("neutralizes applicant URL and domain sequences while retaining the exact approved Sheet detail link", () => {
    const runtime = runtimeWithSlack();
    postAndProcess(runtime, downloadSubmission({
      companyName: "HTTP://evil.example https://second.example/path www.bad.example bare.example.com <@U123>",
      name: "Visit HtTp://trap.test or WWW.click.example <!channel>",
    }));

    const text = slackRequestText(runtime);
    expect(text).toContain(
      "会社名：HTTP[:]//evil[.]example https[:]//second[.]example/path www[.]bad[.]example bare[.]example[.]com &lt;@U123&gt;",
    );
    expect(text).toContain(
      "氏名：Visit HtTp[:]//trap[.]test or WWW[.]click[.]example &lt;!channel&gt;様",
    );
    const applicantLines = text.split("\n").filter((line) => (
      line.startsWith("会社名：") || line.startsWith("氏名：")
    )).join("\n");
    expect(applicantLines).not.toMatch(/(?:https?:\/\/|www\.)/i);
    expect(text).not.toContain("<@U123>");
    expect(text).not.toContain("<!channel>");
    expect(text.split("\n").at(-1)).toBe(`詳細：${SHEET_URL}`);
  });

  it("never sends email, free text, acquisition data, consent time, or arbitrary row serialization", () => {
    const privateValues = [
      "private@business.example",
      "PRIVATE FREE TEXT",
      "https://private.example/referrer",
      "PRIVATE SOURCE",
      "PRIVATE MEDIUM",
      "PRIVATE CAMPAIGN",
      "2026-08-20T10:11:12.000Z",
    ];
    const row = storedRow({
      email: privateValues[0],
      consultationMessage: privateValues[1],
      referrer: privateValues[2],
      utmSource: privateValues[3],
      utmMedium: privateValues[4],
      utmCampaign: privateValues[5],
      consentedAt: privateValues[6],
      intent: "consultation",
      consultationTopic: "time-assets",
      slackStatus: "failed",
    });
    const runtime = runtimeWithSlack({ rows: [[...GAS_HEADERS], row] });

    processNotifications(runtime);

    const text = slackRequestText(runtime);
    expect(text).toContain("相談テーマ：会社らしさ・判断資産の言語化について相談したい");
    privateValues.forEach((value) => expect(text).not.toContain(value));
    expect(text).not.toContain(JSON.stringify(row));
  });
});

describe("Slack configuration, outcomes, and receipt independence", () => {
  it.each([200, 204, 299])("marks a %i response sent with server time and keeps the receipt saved", (status) => {
    const runtime = runtimeWithSlack({ fetchResponses: [status] });

    expectGenericPostOutput(post(runtime, downloadSubmission()));
    expect(runtime.state.fetchCalls).toEqual([]);
    processNotifications(runtime);

    expect(runtime.state.rows[1]?.slice(16, 19)).toEqual([
      "sent",
      "2026-08-24T03:04:05.678Z",
      0,
    ]);
    expect(receipt(runtime)).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });
  });

  it.each([199, 300, 503])("marks a %i response failed without weakening the saved receipt", (status) => {
    const runtime = runtimeWithSlack({ fetchResponses: [status] });

    expectGenericPostOutput(post(runtime, downloadSubmission()));
    expect(runtime.state.fetchCalls).toEqual([]);
    processNotifications(runtime);

    expect(runtime.state.rows[1]?.slice(16, 19)).toEqual(["failed", "", 0]);
    expect(receipt(runtime)).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });
    expect(runtime.state.logs).toEqual([
      `slack submissionId=${SUBMISSION_ID} httpStatus=${status} attempt=1`,
    ]);
  });

  it("turns a fetch exception into a failed outcome without exposing the exception or PII", () => {
    const runtime = runtimeWithSlack({ fetchResponses: [new Error("PRIVATE NETWORK DETAIL")] });

    expectGenericPostOutput(post(runtime, downloadSubmission({ email: "private@business.example" })));
    expect(runtime.state.fetchCalls).toEqual([]);
    processNotifications(runtime);

    expect(runtime.state.rows[1]?.slice(16, 19)).toEqual(["failed", "", 0]);
    expect(receipt(runtime)).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });
    expect(runtime.state.logs).toEqual([
      `slack submissionId=${SUBMISSION_ID} httpStatus=0 attempt=1`,
    ]);
    expect(runtime.state.logs.join(" ")).not.toContain("PRIVATE NETWORK DETAIL");
    expect(runtime.state.logs.join(" ")).not.toContain("private@business.example");
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 200.5])(
    "normalizes a non-integer response code %s to numeric status 0",
    (status) => {
      const runtime = runtimeWithSlack({ fetchResponses: [status] });

      post(runtime, downloadSubmission());
      processNotifications(runtime);

      expect(runtime.state.rows[1]?.slice(16, 19)).toEqual(["failed", "", 0]);
      expect(runtime.state.logs).toEqual([
        `slack submissionId=${SUBMISSION_ID} httpStatus=0 attempt=1`,
      ]);
    },
  );

  it.each([
    ["blank webhook", { THA_SLACK_WEBHOOK_URL: "" }],
    ["blank Sheet URL", { THA_SLACK_SHEET_URL: "" }],
    ["non-HTTPS webhook", { THA_SLACK_WEBHOOK_URL: "http://hooks.slack.com/services/a/b/c" }],
    ["wrong webhook host", { THA_SLACK_WEBHOOK_URL: "https://example.com/services/a/b/c" }],
    ["webhook credentials", { THA_SLACK_WEBHOOK_URL: "https://user@hooks.slack.com/services/a/b/c" }],
    ["webhook query", { THA_SLACK_WEBHOOK_URL: `${SLACK_WEBHOOK_URL}?secret=1` }],
    ["webhook fragment", { THA_SLACK_WEBHOOK_URL: `${SLACK_WEBHOOK_URL}#secret` }],
    ["malformed webhook path", { THA_SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/a/b" }],
    ["non-HTTPS Sheet URL", { THA_SLACK_SHEET_URL: "http://docs.google.com/spreadsheets/d/test/edit" }],
    ["wrong Sheet host", { THA_SLACK_SHEET_URL: "https://evil.example/spreadsheets/d/test/edit" }],
    ["Sheet URL credentials", { THA_SLACK_SHEET_URL: "https://user@docs.google.com/spreadsheets/d/test/edit" }],
    ["control character", { THA_SLACK_SHEET_URL: `${SHEET_URL}\nprivate` }],
  ])("treats %s as disabled with zero fetch while preserving the saved receipt", (_label, properties) => {
    const runtime = runtimeWithSlack({ properties });

    expectGenericPostOutput(post(runtime, downloadSubmission()));
    expect(runtime.state.rows[1]?.slice(16, 19)).toEqual(["pending", "", 0]);
    processNotifications(runtime);

    expect(runtime.state.fetchCalls).toEqual([]);
    expect(runtime.state.rows[1]?.slice(16, 19)).toEqual(["disabled", "", 0]);
    expect(receipt(runtime)).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });
  });

  it("never notifies after an append or flush failure", () => {
    const appendFailure = runtimeWithSlack({ rows: [[...GAS_HEADERS]], failAppend: true });
    post(appendFailure, downloadSubmission());
    processNotifications(appendFailure);
    expect(appendFailure.state.fetchCalls).toEqual([]);
    expect(appendFailure.state.mailCalls).toEqual([]);
    expect(receipt(appendFailure)).toEqual({ submissionId: SUBMISSION_ID, status: "not_found" });

    const flushFailure = runtimeWithSlack({ rows: [[...GAS_HEADERS]], failFlush: true });
    post(flushFailure, downloadSubmission());
    processNotifications(flushFailure);
    expect(flushFailure.state.fetchCalls).toEqual([]);
    expect(flushFailure.state.mailCalls).toEqual([]);
  });

  it("keeps POST output generic and all outputs/logs free of config and private row values", () => {
    const runtime = runtimeWithSlack({ fetchResponses: [500] });
    const output = post(runtime, consultationSubmission({
      companyName: "PRIVATE COMPANY",
      name: "PRIVATE PERSON",
      email: "private@business.example",
    }));
    processNotifications(runtime);
    const statusOutput = runtime.context.doGet(createGasEvent({
      submissionId: SUBMISSION_ID,
      callback: CALLBACK,
    }));
    const visible = [output.getContent(), statusOutput.getContent(), ...runtime.state.logs].join(" ");

    for (const privateValue of [
      "PRIVATE COMPANY",
      "PRIVATE PERSON",
      "private@business.example",
      SLACK_WEBHOOK_URL,
      SHEET_URL,
      "private-source",
      "private-newsletter",
      "private-launch",
    ]) {
      expect(visible).not.toContain(privateValue);
    }
  });
});

describe("durable nonblocking Slack claims and bounded retry", () => {
  it("does not resend Slack or mail for a duplicate POST with the same UUID", () => {
    const runtime = runtimeWithSlack({
      properties: VALID_MAIL_PROPERTIES,
      fetchResponses: [200],
    });
    const payload = downloadSubmission();

    post(runtime, payload);
    post(runtime, payload);
    expect(runtime.state.adapterCalls).toEqual([]);
    processNotifications(runtime);
    processNotifications(runtime);

    expect(runtime.state.appendAttempts).toBe(1);
    expect(runtime.state.fetchCalls).toHaveLength(1);
    expect(runtime.state.mailCalls).toHaveLength(1);
    expect(runtime.state.rows.filter((row) => row[1] === SUBMISSION_ID)).toHaveLength(1);
  });

  it("makes one initial Slack attempt plus exactly three retries, four attempts total, then stops", () => {
    const runtime = runtimeWithSlack({ fetchResponses: [500, 500, 500, 500, 200] });

    post(runtime, downloadSubmission());
    processNotifications(runtime);
    processNotifications(runtime);
    processNotifications(runtime);
    processNotifications(runtime);
    processNotifications(runtime);

    expect(runtime.state.fetchCalls).toHaveLength(4);
    expect(runtime.state.rows[1]?.slice(16, 19)).toEqual(["failed", "", 3]);
    expect(runtime.state.logs).toEqual([1, 2, 3, 4].map((attempt) => (
      `slack submissionId=${SUBMISSION_ID} httpStatus=500 attempt=${attempt}`
    )));
  });

  it("never retries a sent or disabled row and never duplicates a successful retry", () => {
    const runtime = runtimeWithSlack({ fetchResponses: [500, 204, 500] });

    post(runtime, downloadSubmission());
    processNotifications(runtime);
    processNotifications(runtime);
    processNotifications(runtime);

    expect(runtime.state.fetchCalls).toHaveLength(2);
    expect(runtime.state.rows[1]?.slice(16, 19)).toEqual([
      "sent",
      "2026-08-24T03:04:05.678Z",
      1,
    ]);

    const disabledRuntime = runtimeWithSlack({
      properties: { THA_SLACK_WEBHOOK_URL: "" },
      rows: [[...GAS_HEADERS], storedRow({ slackStatus: "disabled" })],
    });
    processNotifications(disabledRuntime);
    expect(disabledRuntime.state.fetchCalls).toEqual([]);
    expect(disabledRuntime.state.rows[1]?.[16]).toBe("disabled");
  });

  it("recovers a pending row left before its initial attempt without consuming a retry", () => {
    const runtime = runtimeWithSlack({
      rows: [[...GAS_HEADERS], storedRow({ slackStatus: "pending", slackRetryCount: 0 })],
      fetchResponses: [200],
    });

    processNotifications(runtime);

    expect(runtime.state.fetchCalls).toHaveLength(1);
    expect(runtime.state.rows[1]?.slice(16, 19)).toEqual([
      "sent",
      "2026-08-24T03:04:05.678Z",
      0,
    ]);
  });

  it("skips a live sending lease so concurrent triggers cannot send the same row", () => {
    const runtime = runtimeWithSlack();
    runtime.state.beforeFetch = () => processNotifications(runtime);

    post(runtime, downloadSubmission());
    processNotifications(runtime);

    expect(runtime.state.fetchCalls).toHaveLength(1);
    expect(runtime.state.fetchLockStates).toEqual([false]);
    expect(runtime.state.rows[1]?.[16]).toBe("sent");
  });

  it("reclaims an expired sending lease as the next bounded retry", () => {
    const expiredClaim = "2026-08-24T03:04:05.677Z|11111111-1111-4111-8111-111111111111";
    const runtime = runtimeWithSlack({
      rows: [[...GAS_HEADERS], storedRow({
        slackStatus: "sending",
        slackNotifiedAt: expiredClaim,
        slackRetryCount: 0,
      })],
      fetchResponses: [200],
    });

    processNotifications(runtime);

    expect(runtime.state.fetchCalls).toHaveLength(1);
    expect(runtime.state.rows[1]?.slice(16, 19)).toEqual([
      "sent",
      "2026-08-24T03:04:05.678Z",
      1,
    ]);
  });

  it("does not leave an expired maximum-retry claim permanently sending", () => {
    const expiredClaim = "2026-08-24T03:04:05.677Z|11111111-1111-4111-8111-111111111111";
    const runtime = runtimeWithSlack({
      rows: [[...GAS_HEADERS], storedRow({
        slackStatus: "sending",
        slackNotifiedAt: expiredClaim,
        slackRetryCount: 3,
      })],
    });

    processNotifications(runtime);

    expect(runtime.state.fetchCalls).toEqual([]);
    expect(runtime.state.rows[1]?.slice(16, 19)).toEqual(["failed", "", 3]);
  });

  it("finalizes only the matching claim token and retry count after an expired attempt is reclaimed", () => {
    const runtime = runtimeWithSlack({ fetchResponses: [503, 204] });
    runtime.state.beforeFetch = () => {
      runtime.advanceMilliseconds(5 * 60 * 1_000 + 1);
      processNotifications(runtime);
    };

    post(runtime, downloadSubmission());
    processNotifications(runtime);

    expect(runtime.state.fetchCalls).toHaveLength(2);
    expect(runtime.state.rows[1]?.slice(16, 19)).toEqual([
      "sent",
      "2026-08-24T03:09:05.679Z",
      1,
    ]);
  });

  it("flushes every claim and final state before lock release while fetching outside the lock", () => {
    const runtime = runtimeWithSlack();

    post(runtime, downloadSubmission());
    runtime.state.operations.splice(0);
    processNotifications(runtime);

    expect(runtime.state.fetchLockStates).toEqual([false]);
    const fetchIndex = runtime.state.operations.indexOf("url-fetch:start");
    const releaseBeforeFetch = runtime.state.operations.lastIndexOf("lock:release", fetchIndex);
    const claimQueue = runtime.state.operations.lastIndexOf("sheet:range:queue", releaseBeforeFetch);
    const claimFlush = runtime.state.operations.lastIndexOf("sheet:flush:commit", releaseBeforeFetch);
    const finalizeAcquire = runtime.state.operations.indexOf("lock:acquire", fetchIndex + 1);
    const finalizeQueue = runtime.state.operations.indexOf("sheet:range:queue", finalizeAcquire + 1);
    const finalizeFlush = runtime.state.operations.indexOf("sheet:flush:commit", finalizeQueue + 1);
    const finalizeRelease = runtime.state.operations.indexOf("lock:release", finalizeFlush + 1);

    expect(claimQueue).toBeGreaterThan(-1);
    expect(claimQueue).toBeLessThan(claimFlush);
    expect(claimFlush).toBeLessThan(releaseBeforeFetch);
    expect(releaseBeforeFetch).toBeLessThan(fetchIndex);
    expect(fetchIndex).toBeLessThan(finalizeAcquire);
    expect(finalizeAcquire).toBeLessThan(finalizeQueue);
    expect(finalizeQueue).toBeLessThan(finalizeFlush);
    expect(finalizeFlush).toBeLessThan(finalizeRelease);
  });

  it("keeps a receipt saved while a claimed fetch is in progress", () => {
    const runtime = runtimeWithSlack();
    let statusDuringFetch: Record<string, unknown> | undefined;
    runtime.state.beforeFetch = () => {
      statusDuringFetch = receipt(runtime);
    };

    post(runtime, downloadSubmission());
    processNotifications(runtime);

    expect(statusDuringFetch).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });
    expect(receipt(runtime)).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });
  });
});

describe("note-backed at-most-once autoreply", () => {
  it("records a versioned disabled note and makes zero MailApp calls by default", () => {
    const row = storedRow({ slackStatus: "disabled" });
    const runtime = createGasRuntime({ rows: [[...GAS_HEADERS], row] });

    processNotifications(runtime);

    expect(runtime.state.mailCalls).toEqual([]);
    expect(runtime.state.rows[1]).toEqual(row);
    expect(runtime.state.notes[SUBMISSION_NOTE_KEY]).toBe(
      "tha-autoreply:v1|disabled|2026-08-24T03:04:05.678Z",
    );
  });

  it.each([
    ["not exactly true", { THA_AUTOREPLY_ENABLED: "TRUE" }],
    ["blank sender", { THA_AUTOREPLY_SENDER_NAME: "" }],
    ["invalid sender", { THA_AUTOREPLY_SENDER_NAME: "THA\nBcc" }],
    ["blank reply-to", { THA_AUTOREPLY_REPLY_TO: "" }],
    ["invalid reply-to", { THA_AUTOREPLY_REPLY_TO: "not-an-email" }],
    ["blank subject", { THA_AUTOREPLY_SUBJECT: "" }],
    ["invalid subject", { THA_AUTOREPLY_SUBJECT: "Subject\r\nBcc" }],
    ["blank body", { THA_AUTOREPLY_BODY: "" }],
    ["invalid body", { THA_AUTOREPLY_BODY: "Body\u0000Private" }],
  ])("records disabled for %s and makes zero MailApp calls", (_label, propertyOverride) => {
    const runtime = createGasRuntime({
      properties: {
        ...VALID_MAIL_PROPERTIES,
        ...propertyOverride,
      },
      rows: [[...GAS_HEADERS], storedRow({ slackStatus: "disabled" })],
    });

    processNotifications(runtime);

    expect(runtime.state.mailCalls).toEqual([]);
    expect(runtime.state.notes[SUBMISSION_NOTE_KEY]).toBe(
      "tha-autoreply:v1|disabled|2026-08-24T03:04:05.678Z",
    );
  });

  it("uses only the row email dynamically, preserves all 19 values, and stores no PII in the sent note", () => {
    const row = storedRow({
      company: "PRIVATE COMPANY",
      name: "PRIVATE PERSON",
      email: "recipient@example.com",
      slackStatus: "disabled",
    });
    const runtime = createGasRuntime({
      properties: VALID_MAIL_PROPERTIES,
      rows: [[...GAS_HEADERS], row],
      uuidValues: ["11111111-1111-4111-8111-111111111111"],
    });

    processNotifications(runtime);

    expect(runtime.state.mailCalls).toEqual([{
      to: "recipient@example.com",
      subject: VALID_MAIL_PROPERTIES.THA_AUTOREPLY_SUBJECT,
      body: VALID_MAIL_PROPERTIES.THA_AUTOREPLY_BODY,
      name: VALID_MAIL_PROPERTIES.THA_AUTOREPLY_SENDER_NAME,
      replyTo: VALID_MAIL_PROPERTIES.THA_AUTOREPLY_REPLY_TO,
    }]);
    expect(runtime.state.mailLockStates).toEqual([false]);
    expect(runtime.state.rows[1]).toEqual(row);
    expect(runtime.state.notes[SUBMISSION_NOTE_KEY]).toBe(
      "tha-autoreply:v1|sent|2026-08-24T03:04:05.678Z|11111111-1111-4111-8111-111111111111",
    );
    expect(runtime.state.notes[SUBMISSION_NOTE_KEY]).not.toContain("PRIVATE COMPANY");
    expect(runtime.state.notes[SUBMISSION_NOTE_KEY]).not.toContain("PRIVATE PERSON");
    expect(runtime.state.notes[SUBMISSION_NOTE_KEY]).not.toContain("recipient@example.com");
  });

  it("flushes the claimed note before releasing the lock, sends outside it, then flushes final state", () => {
    const runtime = createGasRuntime({
      properties: VALID_MAIL_PROPERTIES,
      rows: [[...GAS_HEADERS], storedRow({ slackStatus: "disabled" })],
      uuidValues: ["11111111-1111-4111-8111-111111111111"],
    });

    processNotifications(runtime);

    const sendIndex = runtime.state.operations.indexOf("mail:send");
    const releaseBeforeSend = runtime.state.operations.lastIndexOf("lock:release", sendIndex);
    const claimQueue = runtime.state.operations.lastIndexOf("sheet:note:queue", releaseBeforeSend);
    const claimFlush = runtime.state.operations.lastIndexOf("sheet:flush:commit", releaseBeforeSend);
    const finalizeAcquire = runtime.state.operations.indexOf("lock:acquire", sendIndex + 1);
    const finalizeQueue = runtime.state.operations.indexOf("sheet:note:queue", finalizeAcquire + 1);
    const finalizeFlush = runtime.state.operations.indexOf("sheet:flush:commit", finalizeQueue + 1);
    const finalizeRelease = runtime.state.operations.indexOf("lock:release", finalizeFlush + 1);

    expect(claimQueue).toBeGreaterThan(-1);
    expect(claimQueue).toBeLessThan(claimFlush);
    expect(claimFlush).toBeLessThan(releaseBeforeSend);
    expect(releaseBeforeSend).toBeLessThan(sendIndex);
    expect(sendIndex).toBeLessThan(finalizeAcquire);
    expect(finalizeAcquire).toBeLessThan(finalizeQueue);
    expect(finalizeQueue).toBeLessThan(finalizeFlush);
    expect(finalizeFlush).toBeLessThan(finalizeRelease);
    expect(runtime.state.mailLockStates).toEqual([false]);
  });

  it("records failed asynchronously without changing Slack or receipt state when MailApp throws", () => {
    const runtime = createGasRuntime({
      properties: VALID_MAIL_PROPERTIES,
      failMail: true,
    });

    expectGenericPostOutput(post(runtime, downloadSubmission()));
    expect(runtime.state.mailCalls).toEqual([]);
    processNotifications(runtime);
    processNotifications(runtime);

    expect(runtime.state.mailCalls).toHaveLength(1);
    expect(runtime.state.rows[1]?.[16]).toBe("disabled");
    expect(runtime.state.notes[SUBMISSION_NOTE_KEY]).toMatch(
      /^tha-autoreply:v1\|failed\|2026-08-24T03:04:05\.678Z\|[0-9a-f-]{36}$/,
    );
    expect(receipt(runtime)).toEqual({ submissionId: SUBMISSION_ID, status: "saved" });
    expect(runtime.state.logs).toEqual([]);
  });

  it("does not resend after duplicate POSTs, a Slack retry, or later processor runs", () => {
    const runtime = runtimeWithSlack({
      properties: VALID_MAIL_PROPERTIES,
      fetchResponses: [500, 200],
    });
    const payload = downloadSubmission();

    post(runtime, payload);
    post(runtime, payload);
    processNotifications(runtime);
    runtime.context.retryFailedSlackNotifications();
    processNotifications(runtime);

    expect(runtime.state.mailCalls).toHaveLength(1);
    expect(runtime.state.fetchCalls).toHaveLength(2);
    expect(runtime.state.notes[SUBMISSION_NOTE_KEY]).toMatch(/^tha-autoreply:v1\|sent\|/);
  });

  it("keeps the Slack-only compatibility retry from attempting a pending autoreply", () => {
    const runtime = runtimeWithSlack({
      properties: VALID_MAIL_PROPERTIES,
      rows: [[...GAS_HEADERS], storedRow()],
    });

    runtime.context.retryFailedSlackNotifications();

    expect(runtime.state.fetchCalls).toHaveLength(1);
    expect(runtime.state.mailCalls).toEqual([]);
    expect(runtime.state.notes).toEqual({});
  });

  it("allows a concurrent owner processor during MailApp without duplicating the claimed message", () => {
    const runtime = createGasRuntime({
      properties: VALID_MAIL_PROPERTIES,
      rows: [[...GAS_HEADERS], storedRow({ slackStatus: "disabled" })],
      uuidValues: ["11111111-1111-4111-8111-111111111111"],
    });
    runtime.state.beforeMail = () => processNotifications(runtime);

    processNotifications(runtime);

    expect(runtime.state.mailCalls).toHaveLength(1);
    expect(runtime.state.notes[SUBMISSION_NOTE_KEY]).toBe(
      "tha-autoreply:v1|sent|2026-08-24T03:04:05.678Z|11111111-1111-4111-8111-111111111111",
    );
  });

  it("does not let stale finalization overwrite a different durable claim note", () => {
    const competingNote = "tha-autoreply:v1|claimed|2026-08-24T03:04:05.678Z|22222222-2222-4222-8222-222222222222";
    const runtime = createGasRuntime({
      properties: VALID_MAIL_PROPERTIES,
      rows: [[...GAS_HEADERS], storedRow({ slackStatus: "disabled" })],
      uuidValues: ["11111111-1111-4111-8111-111111111111"],
    });
    runtime.state.beforeMail = () => {
      runtime.state.notes[SUBMISSION_NOTE_KEY] = competingNote;
    };

    processNotifications(runtime);
    processNotifications(runtime);

    expect(runtime.state.mailCalls).toHaveLength(1);
    expect(runtime.state.notes[SUBMISSION_NOTE_KEY]).toBe(competingNote);
  });

  it("never automatically retries a pre-existing claimed note", () => {
    const claimNote = "tha-autoreply:v1|claimed|2026-08-24T03:00:00.000Z|11111111-1111-4111-8111-111111111111";
    const runtime = createGasRuntime({
      properties: VALID_MAIL_PROPERTIES,
      rows: [[...GAS_HEADERS], storedRow({ slackStatus: "disabled" })],
      notes: { [SUBMISSION_NOTE_KEY]: claimNote },
    });

    processNotifications(runtime);
    runtime.context.retryFailedSlackNotifications();
    processNotifications(runtime);

    expect(runtime.state.mailCalls).toEqual([]);
    expect(runtime.state.notes[SUBMISSION_NOTE_KEY]).toBe(claimNote);
  });

  it("keeps claimed after a post-send finalization lock failure and never resends", () => {
    const runtime = createGasRuntime({
      properties: VALID_MAIL_PROPERTIES,
      rows: [[...GAS_HEADERS], storedRow({ slackStatus: "disabled" })],
      uuidValues: ["11111111-1111-4111-8111-111111111111"],
    });
    runtime.state.beforeMail = () => {
      runtime.state.failLock = true;
    };

    processNotifications(runtime);
    runtime.state.failLock = false;
    processNotifications(runtime);

    expect(runtime.state.mailCalls).toHaveLength(1);
    expect(runtime.state.notes[SUBMISSION_NOTE_KEY]).toBe(
      "tha-autoreply:v1|claimed|2026-08-24T03:04:05.678Z|11111111-1111-4111-8111-111111111111",
    );
  });
});

describe("Apps Script authorization boundary", () => {
  it("uses exactly the Spreadsheet, external request, and send-mail OAuth scopes", () => {
    const manifestPath = path.resolve(import.meta.dirname, "../../gas/appsscript.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { oauthScopes?: unknown };

    expect(manifest.oauthScopes).toEqual([
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/script.external_request",
      "https://www.googleapis.com/auth/script.send_mail",
    ]);
  });

  it("keeps the exact ten-property Script Properties allowlist", () => {
    expect(Object.keys(DEFAULT_GAS_PROPERTIES).sort()).toEqual([
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

  it("routes every notification adapter call through the in-memory VM fake ledger", () => {
    const runtime = runtimeWithSlack({ properties: VALID_MAIL_PROPERTIES });
    post(runtime, downloadSubmission({}, { submissionId: OTHER_SUBMISSION_ID }));
    expect(runtime.state.adapterCalls).toEqual([]);
    processNotifications(runtime);

    expect(runtime.state.fetchCalls).toHaveLength(1);
    expect(runtime.state.mailCalls).toHaveLength(1);
    expect(runtime.state.fetchCalls[0]?.url).toBe(SLACK_WEBHOOK_URL);
    expect(runtime.state.adapterCalls).toEqual([
      {
        adapter: "UrlFetchApp.fetch",
        implementation: "in-memory GAS VM fake",
        lockHeld: false,
      },
      {
        adapter: "MailApp.sendEmail",
        implementation: "in-memory GAS VM fake",
        lockHeld: false,
      },
    ]);
  });
});
