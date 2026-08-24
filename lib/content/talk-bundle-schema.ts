import type { DiagnosisStage } from "@/lib/diagnosis/score";

import { isCanonicalTalkSlug, validateTalkBundleRuntime, type TalkDocumentValidationError } from "./talk-schema.ts";
import type { Scene, Talk, TalkPresentation } from "./talk-types.ts";
import type {
  EvidenceItem,
  EvidenceKind,
  EvidenceProvenance,
  HandoutBlock,
  TalkBundle,
  TalkEvidenceDocument,
  TalkHandoutDocument,
  TalkManifest,
  TalkPresentationDocument,
  TalkSourceLink,
  TalkWorksheetDocument,
} from "./talk-bundle-types.ts";

const diagnosisStages = ["explore", "experiment", "systemize", "integrate"] as const;
const evidenceKinds = ["fact", "case", "quote", "tha-synthesis", "tha-viewpoint"] as const;
const evidenceProvenances = ["official", "interview", "secondary", "tha-synthesis"] as const;
const sourceLinkKinds = ["notion", "official", "research"] as const;
const yearPattern = /^\d{4}$/;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;

type JsonRecord = Record<string, unknown>;
type BundleDocumentValidationError = TalkDocumentValidationError;

function invalid(message: string): never {
  throw new Error(`Invalid talk bundle: ${message}`);
}

function invalidDocument(document: string, message: string): never {
  throw Object.assign(new Error(`Invalid talk bundle: ${message}`), { document }) as BundleDocumentValidationError;
}

function validateDocument<T>(document: string, validator: () => T): T {
  try {
    return validator();
  } catch (error) {
    if (error !== null && typeof error === "object" && "document" in error && typeof error.document === "string") {
      throw error;
    }
    const detail = error instanceof Error ? error.message : "unknown content error";
    throw Object.assign(new Error(detail), { document }) as BundleDocumentValidationError;
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function record(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) invalid(`${label} must be an object`);
  return value;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array`);
  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalid(`${label} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requiredString(value, label);
}

function requiredSafeHttpUrl(value: unknown, label: string): string {
  const url = requiredString(value, label);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    invalid(`${label} must be a safe HTTP(S) URL`);
  }
  if (
    url.trim() !== url
    || (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || parsed.hostname.length === 0
    || parsed.username.length > 0
    || parsed.password.length > 0
  ) {
    invalid(`${label} must be a safe HTTP(S) URL`);
  }
  return url;
}

function optionalSafeHttpUrl(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requiredSafeHttpUrl(value, label);
}

function isOneOf<T extends readonly string[]>(value: string, choices: T): value is T[number] {
  return choices.some((choice) => choice === value);
}

function requiredCanonicalSlug(value: unknown, label: string): string {
  const slug = requiredString(value, label);
  if (!isCanonicalTalkSlug(slug)) invalid(`${label} must be a valid lowercase slug`);
  return slug;
}

function requiredIsoDate(value: unknown, label: string): string {
  const date = requiredString(value, label);
  if (!isoDatePattern.test(date)) invalid(`${label} must use YYYY-MM-DD`);

  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    invalid(`${label} must use YYYY-MM-DD`);
  }
  return date;
}

function optionalIsoDate(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requiredIsoDate(value, label);
}

function requiredInformationDate(value: unknown, label: string): string {
  const date = requiredString(value, label);
  if (yearPattern.test(date)) return date;
  if (!isoDatePattern.test(date)) invalid(`${label} must use YYYY or YYYY-MM-DD`);

  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    invalid(`${label} must use YYYY or YYYY-MM-DD`);
  }
  return date;
}

function optionalInformationDate(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : requiredInformationDate(value, label);
}

function requiredStringArray(value: unknown, label: string): string[] {
  return array(value, label).map((item, index) => requiredString(item, `${label} ${index + 1}`));
}

function assertUniqueIds(items: Array<{ id: string }>, collection: string): void {
  const firstIndexById = new Map<string, number>();
  items.forEach((item, index) => {
    const firstIndex = firstIndexById.get(item.id);
    if (firstIndex !== undefined) {
      invalid(`${collection}[${index}].id is a duplicate of ${collection}[${firstIndex}].id: ${item.id}`);
    }
    firstIndexById.set(item.id, index);
  });
}

function validateSourceLinks(value: unknown): TalkSourceLink[] {
  return array(value, "manifest sourceLinks").map((item, index) => {
    const source = record(item, `manifest source link ${index + 1}`);
    const kind = requiredString(source.kind, `manifest source link ${index + 1} kind`);
    if (!isOneOf(kind, sourceLinkKinds)) {
      invalid(`manifest source link ${index + 1} kind is invalid`);
    }
    return {
      label: requiredString(source.label, `manifest source link ${index + 1} label`),
      url: requiredSafeHttpUrl(source.url, `manifest source link ${index + 1} url`),
      kind,
    };
  });
}

function validateManifest(value: unknown): TalkManifest {
  const manifest = record(value, "manifest");
  if (manifest.formatVersion !== 2) invalid("manifest formatVersion must be 2");

  return {
    ...manifest,
    formatVersion: 2,
    sourceLinks: validateSourceLinks(manifest.sourceLinks),
    slug: requiredCanonicalSlug(manifest.slug, "manifest slug"),
  } as TalkManifest;
}

function validateEvidenceRefs(value: unknown, label: string): string[] {
  return requiredStringArray(value, `${label} evidenceRefs`);
}

function validatePresentationDocument(value: unknown): TalkPresentationDocument {
  const presentation = record(value, "presentation document");
  const scenes = array(presentation.scenes, "presentation scenes").map((item, index) => {
    const scene = record(item, `presentation scene ${index + 1}`);
    if (scene.type === "hero" && scene.image !== undefined) {
      requiredString(scene.alt, `hero scene ${index + 1} alt is required when image is configured`);
    }
    const evidenceRefs = validateEvidenceRefs(scene.evidenceRefs, `presentation scene ${index + 1}`);
    return { ...scene, evidenceRefs } as Scene & { evidenceRefs: string[] };
  });
  assertUniqueIds(scenes, "presentation scenes");

  if (presentation.presentation !== undefined && !isRecord(presentation.presentation)) {
    invalid("presentation presentation must be an object");
  }

  return {
    slug: requiredCanonicalSlug(presentation.slug, "presentation slug"),
    ...(presentation.presentation === undefined ? {} : { presentation: presentation.presentation as TalkPresentation }),
    scenes,
  };
}

function validateHandoutDocument(value: unknown): TalkHandoutDocument {
  const handout = record(value, "handout document");
  const chapters = array(handout.chapters, "handout chapters").map((item, index): HandoutBlock => {
    const chapter = record(item, `handout chapter ${index + 1}`);
    const takeaway = optionalString(chapter.takeaway, `handout chapter ${index + 1} takeaway`);
    return {
      id: requiredString(chapter.id, `handout chapter ${index + 1} id`),
      heading: requiredString(chapter.heading, `handout chapter ${index + 1} heading`),
      body: requiredStringArray(chapter.body, `handout chapter ${index + 1} body`),
      evidenceRefs: requiredStringArray(chapter.evidenceRefs, `handout chapter ${index + 1} evidenceRefs`),
      ...(takeaway === undefined ? {} : { takeaway }),
    };
  });
  assertUniqueIds(chapters, "handout chapters");

  return {
    slug: requiredCanonicalSlug(handout.slug, "handout slug"),
    title: requiredString(handout.title, "handout title"),
    subtitle: requiredString(handout.subtitle, "handout subtitle"),
    summary: requiredString(handout.summary, "handout summary"),
    chapters,
    closingAction: requiredString(handout.closingAction, "handout closingAction"),
  };
}

function validateEvidenceItem(value: unknown, index: number): EvidenceItem {
  const item = record(value, `evidence item ${index + 1}`);
  const kind = requiredString(item.kind, `evidence item ${index + 1} kind`);
  const provenance = requiredString(item.provenance, `evidence item ${index + 1} provenance`);
  if (!isOneOf(kind, evidenceKinds)) invalid(`evidence item ${index + 1} kind is invalid`);
  if (!isOneOf(provenance, evidenceProvenances)) invalid(`evidence item ${index + 1} provenance is invalid`);
  const isThaKind = kind === "tha-synthesis" || kind === "tha-viewpoint";
  if (isThaKind !== (provenance === "tha-synthesis")) {
    invalid("THA synthesis/viewpoint kinds require tha-synthesis provenance and vice versa");
  }

  const sourceTitle = optionalString(item.sourceTitle, `evidence item ${index + 1} sourceTitle`);
  const sourceUrl = optionalSafeHttpUrl(item.sourceUrl, `evidence item ${index + 1} sourceUrl`);
  const asOf = optionalInformationDate(item.asOf, `evidence item ${index + 1} asOf`);
  const permissionNote = optionalString(item.permissionNote, `evidence item ${index + 1} permissionNote`);
  if (kind === "fact" && (sourceTitle === undefined || sourceUrl === undefined || asOf === undefined)) {
    invalid("fact evidence requires sourceTitle, sourceUrl, and asOf");
  }
  if (provenance === "interview" && permissionNote === undefined) {
    invalid("interview evidence requires permissionNote");
  }

  const evidence: EvidenceItem = {
    id: requiredString(item.id, `evidence item ${index + 1} id`),
    kind,
    claim: requiredString(item.claim, `evidence item ${index + 1} claim`),
    provenance,
    lastVerifiedAt: requiredIsoDate(item.lastVerifiedAt, `evidence item ${index + 1} lastVerifiedAt`),
    verifiedBy: requiredString(item.verifiedBy, `evidence item ${index + 1} verifiedBy`),
  };
  const optionalFields: Array<[keyof Pick<EvidenceItem, "value" | "unit" | "sourceTitle" | "publisher">, string | undefined]> = [
    ["value", optionalString(item.value, `evidence item ${index + 1} value`)],
    ["unit", optionalString(item.unit, `evidence item ${index + 1} unit`)],
    ["sourceTitle", sourceTitle],
    ["publisher", optionalString(item.publisher, `evidence item ${index + 1} publisher`)],
  ];
  optionalFields.forEach(([field, fieldValue]) => {
    if (fieldValue !== undefined) evidence[field] = fieldValue;
  });
  if (asOf !== undefined) evidence.asOf = asOf;
  if (sourceUrl !== undefined) evidence.sourceUrl = sourceUrl;
  const publishedAt = optionalIsoDate(item.publishedAt, `evidence item ${index + 1} publishedAt`);
  if (publishedAt !== undefined) evidence.publishedAt = publishedAt;
  if (permissionNote !== undefined) evidence.permissionNote = permissionNote;
  return evidence;
}

function validateEvidenceDocument(value: unknown): TalkEvidenceDocument {
  const evidence = record(value, "evidence document");
  const items = array(evidence.items, "evidence items").map(validateEvidenceItem);
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    invalid("evidence IDs must be unique");
  }
  return { slug: requiredCanonicalSlug(evidence.slug, "evidence slug"), items };
}

function validateWorksheet(value: unknown, key: DiagnosisStage): TalkWorksheetDocument {
  const worksheet = record(value, `worksheet ${key}`);
  const stage = requiredString(worksheet.stage, `worksheet ${key} stage`);
  if (!isOneOf(stage, diagnosisStages)) invalid(`worksheet ${key} stage is invalid`);
  if (stage !== key) invalid(`worksheet ${key} stage must match its record key`);
  return {
    slug: requiredCanonicalSlug(worksheet.slug, `worksheet ${key} slug`),
    stage,
    title: requiredString(worksheet.title, `worksheet ${key} title`),
    currentState: requiredString(worksheet.currentState, `worksheet ${key} currentState`),
    prompts: requiredStringArray(worksheet.prompts, `worksheet ${key} prompts`),
    sevenDayAction: requiredString(worksheet.sevenDayAction, `worksheet ${key} sevenDayAction`),
    nextStageSignal: requiredString(worksheet.nextStageSignal, `worksheet ${key} nextStageSignal`),
  };
}

function validateWorksheets(value: unknown): Record<DiagnosisStage, TalkWorksheetDocument> {
  const worksheets = record(value, "worksheets");
  return diagnosisStages.reduce((validated, stage) => {
    if (!(stage in worksheets)) invalid(`worksheets must include ${stage}`);
    validated[stage] = validateDocument(`worksheets/${stage}.json`, () => validateWorksheet(worksheets[stage], stage));
    return validated;
  }, {} as Record<DiagnosisStage, TalkWorksheetDocument>);
}

function assertMatchingSlugs(
  slug: string,
  presentation: TalkPresentationDocument,
  handout: TalkHandoutDocument,
  evidence: TalkEvidenceDocument,
  worksheets: Record<DiagnosisStage, TalkWorksheetDocument>,
) {
  if (presentation.slug !== slug) invalidDocument("presentation.json", "bundle document slug must match manifest slug");
  if (handout.slug !== slug) invalidDocument("handout.json", "bundle document slug must match manifest slug");
  if (evidence.slug !== slug) invalidDocument("evidence.json", "bundle document slug must match manifest slug");
  diagnosisStages.forEach((stage) => {
    if (worksheets[stage].slug !== slug) {
      invalidDocument(`worksheets/${stage}.json`, "bundle document slug must match manifest slug");
    }
  });
}

function assertEvidenceReferences(
  presentation: TalkPresentationDocument,
  handout: TalkHandoutDocument,
  evidence: TalkEvidenceDocument,
) {
  const knownIds = new Set(evidence.items.map((item) => item.id));
  presentation.scenes.flatMap((scene) => scene.evidenceRefs).forEach((reference) => {
    if (!knownIds.has(reference)) invalidDocument("presentation.json", `unknown evidence reference: ${reference}`);
  });
  handout.chapters.flatMap((chapter) => chapter.evidenceRefs).forEach((reference) => {
    if (!knownIds.has(reference)) invalidDocument("handout.json", `unknown evidence reference: ${reference}`);
  });
}

export function composeTalk(bundle: TalkBundle): Talk {
  const { formatVersion: _version, sourceLinks: _sources, ...manifest } = bundle.manifest;
  const scenes = bundle.presentation.scenes.map(({ evidenceRefs: _refs, ...scene }) => scene);
  return { ...manifest, presentation: bundle.presentation.presentation, scenes } as Talk;
}

export function validateTalkBundle(input: unknown): TalkBundle {
  const bundle = record(input, "bundle");
  const manifest = validateDocument("manifest.json", () => validateManifest(bundle.manifest));
  const presentation = validateDocument("presentation.json", () => validatePresentationDocument(bundle.presentation));
  const handout = validateDocument("handout.json", () => validateHandoutDocument(bundle.handout));
  const evidence = validateDocument("evidence.json", () => validateEvidenceDocument(bundle.evidence));
  const worksheets = validateDocument("worksheets", () => validateWorksheets(bundle.worksheets));
  assertMatchingSlugs(manifest.slug, presentation, handout, evidence, worksheets);
  assertEvidenceReferences(presentation, handout, evidence);
  const candidate = { manifest, presentation, handout, evidence, worksheets };
  const runtime = validateTalkBundleRuntime(composeTalk(candidate));
  const { scenes, presentation: runtimePresentation, ...runtimeManifest } = runtime;

  return {
    manifest: { ...runtimeManifest, formatVersion: manifest.formatVersion, sourceLinks: manifest.sourceLinks },
    presentation: {
      slug: presentation.slug,
      ...(runtimePresentation === undefined ? {} : { presentation: runtimePresentation }),
      scenes: scenes.map((scene, index) => ({
        ...scene,
        evidenceRefs: presentation.scenes[index].evidenceRefs,
      })),
    },
    handout,
    evidence,
    worksheets,
  };
}
