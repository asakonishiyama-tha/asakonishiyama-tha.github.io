import { z } from "zod";

import type { DiagnosisStage } from "@/lib/diagnosis/score";
import { consultationTopicValues, type ConsultationTopic } from "@/lib/leads/consultation-topics";

export type LeadIntent = "download" | "consultation";
export type { ConsultationTopic };

const freeEmailDomains = new Set([
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
]);

const isSpreadsheetSafeText = (value: string) => !/^[=+\-@]/.test(value);

const compactText = (maximum: number) =>
  z.string().trim().min(1).max(maximum)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value))
    .refine(isSpreadsheetSafeText);

const optionalPersonName = z.string()
  .trim()
  .max(120)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value))
  .refine(isSpreadsheetSafeText)
  .optional()
  .default("");

const businessEmail = z.string().trim().toLowerCase().max(254).email().refine((value) => {
  const domain = value.split("@")[1];
  return domain !== undefined && !freeEmailDomains.has(domain);
}, "business email required").refine(isSpreadsheetSafeText);

const acquisitionText = (maximum: number) =>
  z.string().trim().max(maximum)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value))
    .refine(isSpreadsheetSafeText)
    .optional()
    .default("");

const commonFields = {
  companyName: compactText(160),
  name: optionalPersonName,
  email: businessEmail,
  consent: z.literal(true),
  talkSlug: z.string().trim().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/),
  eventName: compactText(160),
  diagnosisStage: z.enum(["explore", "experiment", "systemize", "integrate"]).optional(),
  referrer: acquisitionText(2_048),
  utmSource: acquisitionText(200),
  utmMedium: acquisitionText(200),
  utmCampaign: acquisitionText(200),
};

const downloadLeadSchema = z.object({
  intent: z.literal("download"),
  ...commonFields,
}).strict();

const consultationLeadSchema = z.object({
  intent: z.literal("consultation"),
  consultationTopic: z.enum(consultationTopicValues),
  ...commonFields,
}).strict();

export const leadSchema = z.discriminatedUnion("intent", [downloadLeadSchema, consultationLeadSchema]);

export type ValidatedLead = z.output<typeof leadSchema> & {
  diagnosisStage?: DiagnosisStage;
};

export class InvalidLeadError extends Error {
  constructor() {
    super("invalid lead");
    this.name = "InvalidLeadError";
  }
}

export function parseLead(input: unknown): ValidatedLead {
  const result = leadSchema.safeParse(input);
  if (!result.success) {
    throw new InvalidLeadError();
  }
  return result.data;
}
