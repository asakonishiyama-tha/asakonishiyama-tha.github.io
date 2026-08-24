import type { DiagnosisStage } from "@/lib/diagnosis/score";

declare global {
  interface Window {
    dataLayer?: Array<AnalyticsEvent>;
  }
}

const analyticsEventNames = [
  "talk_view",
  "quest_start",
  "quest_complete",
  "result_view",
  "download_form_view",
  "download_submit_success",
  "consultation_form_view",
  "consultation_submit_success",
] as const;

const diagnosisStages = ["explore", "experiment", "systemize", "integrate"] as const satisfies readonly DiagnosisStage[];
const canonicalTalkSlug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const dedupeStoragePrefix = "tha-hooked:analytics:v1:";
const inMemoryDedupeKeys = new Set<string>();

export type AnalyticsEventName = (typeof analyticsEventNames)[number];
export type AnalyticsProperties = Readonly<{ talkSlug: string; resultStage?: DiagnosisStage }>;
type AnalyticsEvent = Readonly<{ event: AnalyticsEventName; talkSlug: string; resultStage?: DiagnosisStage }>;

function isAnalyticsEventName(value: unknown): value is AnalyticsEventName {
  return typeof value === "string" && analyticsEventNames.includes(value as AnalyticsEventName);
}

function isDiagnosisStage(value: unknown): value is DiagnosisStage {
  return typeof value === "string" && diagnosisStages.includes(value as DiagnosisStage);
}

function createEvent(name: unknown, properties: unknown): AnalyticsEvent | null {
  if (!isAnalyticsEventName(name) || typeof properties !== "object" || properties === null) return null;

  const { talkSlug, resultStage } = properties as Partial<AnalyticsProperties>;
  if (typeof talkSlug !== "string" || !canonicalTalkSlug.test(talkSlug)) return null;
  if (resultStage !== undefined && !isDiagnosisStage(resultStage)) return null;
  return resultStage === undefined ? { event: name, talkSlug } : { event: name, talkSlug, resultStage };
}

function pushEvent(event: AnalyticsEvent): boolean {
  if (typeof window === "undefined" || !Array.isArray(window.dataLayer)) return false;
  window.dataLayer.push(event);
  return true;
}

function dedupeKey(event: AnalyticsEvent) {
  return `${dedupeStoragePrefix}${encodeURIComponent(event.event)}:${encodeURIComponent(event.talkSlug)}:${encodeURIComponent(event.resultStage ?? "")}`;
}

function storageHas(key: string): boolean {
  try {
    return window.sessionStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function rememberInSession(key: string) {
  try {
    window.sessionStorage.setItem(key, "1");
  } catch {
    // The module-local key still dedupes this JS lifetime when browser storage is unavailable.
  }
}

/**
 * Sends only anonymous lifecycle events. This boundary deliberately rebuilds
 * the payload instead of forwarding arbitrary properties, so JavaScript
 * callers cannot push personal information to a configured data layer.
 */
export function trackEvent(name: AnalyticsEventName, properties: AnalyticsProperties): void {
  const event = createEvent(name, properties);
  if (event) pushEvent(event);
}

/**
 * Emits each anonymous event key once per browser tab session. Submit-success
 * events are therefore once per intent event, talk slug, and diagnosis stage.
 * Only the allowlisted event name, slug, and optional stage form the stored key.
 */
export function trackEventOnce(name: AnalyticsEventName, properties: AnalyticsProperties): void {
  if (typeof window === "undefined") return;
  const event = createEvent(name, properties);
  if (!event) return;

  const key = dedupeKey(event);
  if (inMemoryDedupeKeys.has(key)) return;
  if (storageHas(key)) {
    inMemoryDedupeKeys.add(key);
    return;
  }
  if (!pushEvent(event)) return;

  inMemoryDedupeKeys.add(key);
  rememberInSession(key);
}
