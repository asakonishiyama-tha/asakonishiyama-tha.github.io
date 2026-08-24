import { leadSchema } from "@/lib/validation/lead-schema";

export const leadFieldNames = ["companyName", "name", "email", "consultationTopic", "consent"] as const;
export type LeadFieldName = typeof leadFieldNames[number];
export type LeadFieldErrors = Partial<Record<LeadFieldName, string>>;

const fieldMessages: Record<LeadFieldName, string> = {
  companyName: "会社名を入力してください。",
  name: "お名前をご確認ください。",
  email: "会社のメールアドレスを入力してください。",
  consultationTopic: "相談したいテーマを選択してください。",
  consent: "個人情報の取り扱いへの同意が必要です。",
};

/** Client-safe mirror of the server lead schema. It returns only generic field guidance, never submitted values. */
export function validateLeadFields(input: unknown): LeadFieldErrors {
  const result = leadSchema.safeParse(input);
  if (result.success) return {};

  return result.error.issues.reduce<LeadFieldErrors>((errors, issue) => {
    const field = issue.path[0];
    if (typeof field === "string" && leadFieldNames.includes(field as LeadFieldName) && !errors[field as LeadFieldName]) {
      errors[field as LeadFieldName] = fieldMessages[field as LeadFieldName];
    }
    return errors;
  }, {});
}
