import type { LeadIntent } from "@/lib/validation/lead-schema";

export function parseLeadIntent(value: unknown): LeadIntent | undefined {
  return value === "download" || value === "consultation" ? value : undefined;
}

export function leadResultHref(slug: string, intent: LeadIntent): string {
  return `/talks/${encodeURIComponent(slug)}/result?intent=${intent}`;
}

export function leadQuestHref(slug: string, intent?: LeadIntent): string {
  const base = `/talks/${encodeURIComponent(slug)}/quest`;
  return intent ? `${base}?intent=${intent}` : base;
}
