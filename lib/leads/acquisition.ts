export type AcquisitionMetadata = {
  referrer: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
};

type AcquisitionSource = {
  search: string;
  referrer: string;
  origin: string;
};

const emptyAcquisition: AcquisitionMetadata = {
  referrer: "",
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
};
const memoryFallback = new Map<string, AcquisitionMetadata>();
const memoryOnlyKeys = new Set<string>();
const storageKey = (talkSlug: string) => `tha-hooked:${talkSlug}:acquisition:v1`;

function boundedText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return "";
  return normalized.slice(0, maximum);
}

function externalReferrer(value: unknown, currentOrigin: string): string {
  const candidate = boundedText(value, 2_048);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.origin === currentOrigin) return "";
    url.search = "";
    url.hash = "";
    return boundedText(url.toString(), 2_048);
  } catch {
    return "";
  }
}

function normalizeStored(value: unknown): AcquisitionMetadata | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    referrer: boundedText(record.referrer, 2_048),
    utmSource: boundedText(record.utmSource, 200),
    utmMedium: boundedText(record.utmMedium, 200),
    utmCampaign: boundedText(record.utmCampaign, 200),
  };
}

function readExisting(talkSlug: string): AcquisitionMetadata | null {
  const key = storageKey(talkSlug);
  if (typeof window === "undefined") return memoryFallback.get(key) ?? null;
  try {
    const stored = window.sessionStorage.getItem(key);
    if (!stored) {
      if (memoryOnlyKeys.has(key)) return memoryFallback.get(key) ?? null;
      memoryFallback.delete(key);
      return null;
    }
    const parsed = normalizeStored(JSON.parse(stored));
    if (!parsed) return null;
    memoryFallback.set(key, parsed);
    memoryOnlyKeys.delete(key);
    return parsed;
  } catch {
    return memoryFallback.get(key) ?? null;
  }
}

function browserSource(): AcquisitionSource | null {
  if (typeof window === "undefined" || typeof document === "undefined") return null;
  return { search: window.location.search, referrer: document.referrer, origin: window.location.origin };
}

export function captureFirstTouchAcquisition(
  talkSlug: string,
  source: AcquisitionSource | null = browserSource(),
): AcquisitionMetadata {
  const key = storageKey(talkSlug);
  const existing = readExisting(talkSlug);
  if (existing) return existing;
  if (!source) return emptyAcquisition;

  const query = new URLSearchParams(source.search);
  const acquisition: AcquisitionMetadata = {
    referrer: externalReferrer(source.referrer, source.origin),
    utmSource: boundedText(query.get("utm_source"), 200),
    utmMedium: boundedText(query.get("utm_medium"), 200),
    utmCampaign: boundedText(query.get("utm_campaign"), 200),
  };
  memoryFallback.set(key, acquisition);
  try {
    window.sessionStorage.setItem(key, JSON.stringify(acquisition));
    memoryOnlyKeys.delete(key);
  } catch {
    memoryOnlyKeys.add(key);
    // The in-memory copy preserves first touch for this JavaScript lifetime.
  }
  return acquisition;
}
