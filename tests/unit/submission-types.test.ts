import { describe, expect, it } from "vitest";

import { parseLeadSubmission, parseReceiptStatus } from "@/lib/forms/submission-types";

const validSubmissionId = "6c686afa-3ad2-4dab-94a4-bd616198bbed";
const nonV4SubmissionIds = [
  "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "01890f2e-7c5b-7cc4-98c0-123456789abc",
  "00000000-0000-0000-0000-000000000000",
  "ffffffff-ffff-ffff-ffff-ffffffffffff",
];
const formulaPrefixes = ["=", "+", "-", "@"] as const;
const formulaControlledFields = [
  "companyName",
  "name",
  "email",
  "referrer",
  "utmSource",
  "utmMedium",
  "utmCampaign",
] as const;

const validLead = {
  intent: "consultation" as const,
  companyName: "THA株式会社",
  name: "西山朝子",
  email: "asako@example.com",
  phone: "03-1234-5678",
  consent: true as const,
  talkSlug: "ai-president-intro",
  eventName: "THA AI社長 登壇セッション",
  diagnosisStage: "experiment" as const,
  consultationTopic: "ai-president",
  referrer: "https://tha-inc.com/",
  utmSource: "newsletter",
  utmMedium: "email",
  utmCampaign: "launch",
};

describe("GAS submission contract", () => {
  it("accepts an exact saved receipt", () => {
    expect(parseReceiptStatus({ submissionId: validSubmissionId, status: "saved" })).toEqual({
      submissionId: validSubmissionId,
      status: "saved",
    });
  });

  it("rejects receipt data beyond its persistence status", () => {
    expect(() => parseReceiptStatus({
      submissionId: validSubmissionId,
      status: "saved",
      email: "asako@example.com",
    })).toThrow();
  });

  it("rejects malformed receipt identifiers and unknown statuses", () => {
    expect(() => parseReceiptStatus({ submissionId: "predictable", status: "saved" })).toThrow();
    expect(() => parseReceiptStatus({ submissionId: validSubmissionId, status: "received" })).toThrow();
  });

  it.each(nonV4SubmissionIds)("rejects non-crypto.randomUUID receipt and submission ID %s", (submissionId) => {
    expect(() => parseReceiptStatus({ submissionId, status: "saved" })).toThrow();
    expect(() => parseLeadSubmission({
      submissionId,
      website: "",
      consentedAt: "2026-08-23T00:00:00.000Z",
      lead: validLead,
    })).toThrow();
  });

  it("accepts a submission with only its allowed lead data", () => {
    expect(parseLeadSubmission({
      submissionId: validSubmissionId,
      website: "",
      consentedAt: "2026-08-23T00:00:00.000Z",
      lead: validLead,
    })).toEqual({
      submissionId: validSubmissionId,
      website: "",
      consentedAt: "2026-08-23T00:00:00.000Z",
      lead: validLead,
    });
  });

  it("requires a person name and accepts a normalized optional business phone", () => {
    expect(() => parseLeadSubmission({
      submissionId: validSubmissionId,
      website: "",
      consentedAt: "2026-08-23T00:00:00.000Z",
      lead: { ...validLead, name: "   " },
    })).toThrow();

    expect(parseLeadSubmission({
      submissionId: validSubmissionId,
      website: "",
      consentedAt: "2026-08-23T00:00:00.000Z",
      lead: { ...validLead, phone: "  +81 (3) 1234-5678  " },
    }).lead.phone).toBe("+81 (3) 1234-5678");
  });

  it.each([
    "123456",
    "1234567890123456",
    "03-ABCD-5678",
    "=03-1234-5678",
    "03-1234-5678\nprivate",
  ])("rejects unsafe or malformed optional phone %s", (phone) => {
    expect(() => parseLeadSubmission({
      submissionId: validSubmissionId,
      website: "",
      consentedAt: "2026-08-23T00:00:00.000Z",
      lead: { ...validLead, phone },
    })).toThrow();
  });

  it("rejects predictable identifiers, filled honeypots, and diagnosis answers", () => {
    expect(() => parseLeadSubmission({
      submissionId: "predictable",
      website: "",
      consentedAt: "2026-08-23T00:00:00.000Z",
      lead: validLead,
    })).toThrow();
    expect(() => parseLeadSubmission({
      submissionId: validSubmissionId,
      website: "bot.example",
      consentedAt: "2026-08-23T00:00:00.000Z",
      lead: validLead,
    })).toThrow();
    expect(() => parseLeadSubmission({
      submissionId: validSubmissionId,
      website: "",
      consentedAt: "2026-08-23T00:00:00.000Z",
      lead: { ...validLead, diagnosisAnswers: ["a", "b", "c"] },
    })).toThrow();
  });

  it.each(formulaControlledFields.flatMap((field) => formulaPrefixes.map((prefix) => [
    field,
    prefix,
    `  ${prefix}${field === "email" ? "person@example.com" : "formula"}`,
  ] as const)))("rejects normalized lead field %s beginning with formula prefix %s before browser submission", (
    field,
    _prefix,
    value,
  ) => {
    expect(() => parseLeadSubmission({
      submissionId: validSubmissionId,
      website: "",
      consentedAt: "2026-08-23T00:00:00.000Z",
      lead: { ...validLead, [field]: value },
    })).toThrow();
  });
});
