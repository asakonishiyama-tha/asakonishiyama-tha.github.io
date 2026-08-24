import { z } from "zod";

import { leadSchema } from "@/lib/validation/lead-schema";

export const receiptStatusSchema = z.object({
  submissionId: z.string().uuidv4(),
  status: z.enum(["pending", "saved", "not_found"]),
}).strict();

export type ReceiptStatus = z.output<typeof receiptStatusSchema>;
export type SavedReceipt = ReceiptStatus & { status: "saved" };

export const leadSubmissionSchema = z.object({
  submissionId: z.string().uuidv4(),
  website: z.string().max(0),
  consentedAt: z.string().datetime(),
  lead: leadSchema,
}).strict();

export type LeadSubmission = z.output<typeof leadSubmissionSchema>;

export function parseReceiptStatus(input: unknown): ReceiptStatus {
  return receiptStatusSchema.parse(input);
}

export function parseLeadSubmission(input: unknown): LeadSubmission {
  return leadSubmissionSchema.parse(input);
}
