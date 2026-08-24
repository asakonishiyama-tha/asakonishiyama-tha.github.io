export const consultationTopicValues = [
  "ai-president",
  "smb-ai",
  "adoption",
  "succession",
  "time-assets",
  "other",
] as const;

export type ConsultationTopic = (typeof consultationTopicValues)[number];

export type ConsultationTopicOption = {
  value: ConsultationTopic;
  label: string;
};

export const defaultConsultationTopicOptions: readonly ConsultationTopicOption[] = [
  { value: "ai-president", label: "AI社長について相談したい" },
  { value: "smb-ai", label: "中小企業のAI活用について相談したい" },
  { value: "adoption", label: "AI導入・定着について相談したい" },
  { value: "other", label: "その他" },
];

export function isConsultationTopic(value: unknown): value is ConsultationTopic {
  return typeof value === "string" && consultationTopicValues.some((topic) => topic === value);
}
