import type { Dirent } from "node:fs";
import { lstat, readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { validateTalkBundle } from "../lib/content/talk-bundle-schema.ts";
import { isCanonicalTalkSlug, validateTalkDocument } from "../lib/content/talk-schema.ts";

const CONTENT_ROOT_LABEL = "content/talks";
const bundleDocumentNames = ["manifest.json", "presentation.json", "handout.json", "evidence.json"] as const;
const worksheetDocumentNames = ["explore.json", "experiment.json", "systemize.json", "integrate.json"] as const;

type BundleDocumentName = (typeof bundleDocumentNames)[number];
type WorksheetDocumentName = (typeof worksheetDocumentNames)[number];
type JsonRecord = Record<string, unknown>;

function relativeName(talksDirectory: string, filename: string): string {
  const relative = path.relative(talksDirectory, filename).split(path.sep).join("/");
  return relative || CONTENT_ROOT_LABEL;
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : "unknown content error";
}

function bundleDocumentFrom(error: unknown): string | undefined {
  return error !== null && typeof error === "object" && "document" in error && typeof error.document === "string"
    ? error.document
    : undefined;
}

function isExpectedBundleDocument(name: string): name is BundleDocumentName {
  return bundleDocumentNames.some((document) => document === name);
}

function isExpectedWorksheetDocument(name: string): name is WorksheetDocumentName {
  return worksheetDocumentNames.some((document) => document === name);
}

function isJsonFilename(name: string): boolean {
  return path.extname(name).toLowerCase() === ".json";
}

function isLowercaseJsonFilename(name: string): boolean {
  return path.extname(name) === ".json";
}

async function parseBundleDocument(filename: string, document: string): Promise<JsonRecord> {
  try {
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    throw Object.assign(new Error(errorDetail(error)), { document });
  }
}

type BundleWalkResult = { jsonCandidates: number; violations: string[] };

async function validateBundle(bundleDirectory: string, talksDirectory: string): Promise<BundleWalkResult> {
  const violations: string[] = [];
  let jsonCandidates = 0;
  const bundleName = relativeName(talksDirectory, bundleDirectory);
  const documents = new Map<BundleDocumentName, string>();
  const worksheets = new Map<WorksheetDocumentName, string>();
  let worksheetsDirectory: string | undefined;

  let entries;
  try {
    entries = await readdir(bundleDirectory, { withFileTypes: true });
  } catch {
    return { jsonCandidates, violations: [`${bundleName}: directory could not be read`] };
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const filename = path.join(bundleDirectory, entry.name);
    const name = relativeName(talksDirectory, filename);
    let metadata;
    try {
      metadata = await lstat(filename);
    } catch (error) {
      violations.push(`${name}: ${isMissing(error) ? "path disappeared during validation" : "path could not be inspected"}`);
      continue;
    }

    if (metadata.isSymbolicLink()) {
      violations.push(`${name}: symlink not allowed`);
      continue;
    }
    if (metadata.isDirectory()) {
      if (entry.name === "worksheets") {
        worksheetsDirectory = filename;
      } else if (entry.name !== "assets") {
        violations.push(`${name}: unexpected Talk bundle directory`);
      }
      continue;
    }
    if (!metadata.isFile()) {
      violations.push(`${name}: unsupported filesystem entry`);
      continue;
    }
    if (!isJsonFilename(entry.name)) continue;

    jsonCandidates += 1;
    if (!isLowercaseJsonFilename(entry.name)) {
      violations.push(`${name}: Talk bundle JSON filenames must use the lowercase .json extension`);
      continue;
    }
    if (!isExpectedBundleDocument(entry.name)) {
      violations.push(`${name}: unexpected Talk bundle JSON document`);
      continue;
    }
    documents.set(entry.name, filename);
  }

  for (const document of bundleDocumentNames) {
    if (!documents.has(document)) {
      violations.push(`${bundleName}/${document}: required Talk bundle JSON document is missing`);
    }
  }

  if (worksheetsDirectory === undefined) {
    violations.push(`${bundleName}/worksheets: required Talk bundle directory is missing`);
  } else {
    let worksheetEntries: Dirent[];
    try {
      worksheetEntries = await readdir(worksheetsDirectory, { withFileTypes: true });
    } catch {
      violations.push(`${bundleName}/worksheets: directory could not be read`);
      worksheetEntries = [];
    }

    for (const entry of worksheetEntries.sort((left, right) => left.name.localeCompare(right.name))) {
      const filename = path.join(worksheetsDirectory, entry.name);
      const name = relativeName(talksDirectory, filename);
      let metadata;
      try {
        metadata = await lstat(filename);
      } catch (error) {
        violations.push(`${name}: ${isMissing(error) ? "path disappeared during validation" : "path could not be inspected"}`);
        continue;
      }

      if (metadata.isSymbolicLink()) {
        violations.push(`${name}: symlink not allowed`);
        continue;
      }
      if (!metadata.isFile()) {
        violations.push(`${name}: unsupported Talk bundle filesystem entry`);
        continue;
      }
      if (!isJsonFilename(entry.name)) continue;

      jsonCandidates += 1;
      if (!isLowercaseJsonFilename(entry.name)) {
        violations.push(`${name}: Talk bundle JSON filenames must use the lowercase .json extension`);
        continue;
      }
      if (!isExpectedWorksheetDocument(entry.name)) {
        violations.push(`${name}: unexpected Talk bundle JSON document`);
        continue;
      }
      worksheets.set(entry.name, filename);
    }

    for (const document of worksheetDocumentNames) {
      if (!worksheets.has(document)) {
        violations.push(`${bundleName}/worksheets/${document}: required Talk bundle JSON document is missing`);
      }
    }
  }

  if (violations.length > 0) return { jsonCandidates, violations };

  const parsedDocuments = {} as Record<BundleDocumentName, JsonRecord>;
  const parsedWorksheets = {} as Record<WorksheetDocumentName, JsonRecord>;
  try {
    for (const document of bundleDocumentNames) {
      parsedDocuments[document] = await parseBundleDocument(documents.get(document)!, document);
    }
    for (const document of worksheetDocumentNames) {
      parsedWorksheets[document] = await parseBundleDocument(worksheets.get(document)!, `worksheets/${document}`);
    }

    const bundle = validateTalkBundle({
      manifest: parsedDocuments["manifest.json"],
      presentation: parsedDocuments["presentation.json"],
      handout: parsedDocuments["handout.json"],
      evidence: parsedDocuments["evidence.json"],
      worksheets: {
        explore: parsedWorksheets["explore.json"],
        experiment: parsedWorksheets["experiment.json"],
        systemize: parsedWorksheets["systemize.json"],
        integrate: parsedWorksheets["integrate.json"],
      },
    });
    if (bundle.manifest.slug !== path.basename(bundleDirectory)) {
      violations.push(`${bundleName}/manifest.json: Talk bundle directory name must match manifest slug`);
    }
  } catch (error) {
    const document = bundleDocumentFrom(error);
    const filename = document === undefined ? bundleName : `${bundleName}/${document}`;
    violations.push(`${filename}: ${errorDetail(error)}`);
  }

  return { jsonCandidates, violations };
}

/** Validates flat Talk documents and explicitly structured Talk bundle directories. */
export async function validateContent(talksDirectory = path.join(process.cwd(), "content", "talks")): Promise<string[]> {
  const rootDirectory = path.resolve(talksDirectory);
  const violations: string[] = [];
  let jsonCandidates = 0;

  let rootMetadata;
  try {
    rootMetadata = await lstat(rootDirectory);
  } catch (error) {
    return [`${CONTENT_ROOT_LABEL}: ${isMissing(error) ? "directory is missing" : "directory could not be inspected"}`];
  }
  if (rootMetadata.isSymbolicLink()) return [`${CONTENT_ROOT_LABEL}: symlink not allowed`];
  if (!rootMetadata.isDirectory()) return [`${CONTENT_ROOT_LABEL}: content path must be a directory`];

  let entries;
  try {
    entries = await readdir(rootDirectory, { withFileTypes: true });
  } catch {
    return [`${CONTENT_ROOT_LABEL}: directory could not be read`];
  }

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const filename = path.join(rootDirectory, entry.name);
    const name = relativeName(rootDirectory, filename);
    const jsonCandidate = isJsonFilename(entry.name);
    if (jsonCandidate) jsonCandidates += 1;
    let metadata;
    try {
      metadata = await lstat(filename);
    } catch (error) {
      violations.push(`${name}: ${isMissing(error) ? "path disappeared during validation" : "path could not be inspected"}`);
      continue;
    }
    if (metadata.isSymbolicLink()) {
      violations.push(`${name}: symlink not allowed`);
      continue;
    }
    if (metadata.isDirectory()) {
      if (isCanonicalTalkSlug(entry.name)) {
        const bundle = await validateBundle(filename, rootDirectory);
        jsonCandidates += bundle.jsonCandidates;
        violations.push(...bundle.violations);
      } else {
        violations.push(`${name}: Talk bundle directory names must use a canonical lowercase slug`);
      }
      continue;
    }
    if (!metadata.isFile()) {
      violations.push(`${name}: unsupported filesystem entry`);
      continue;
    }
    if (!jsonCandidate) continue;
    if (!isLowercaseJsonFilename(entry.name)) {
      violations.push(`${name}: Talk JSON filenames must use the lowercase .json extension`);
    }
    try {
      const document = JSON.parse(await readFile(filename, "utf8"));
      validateTalkDocument(document, entry.name.slice(0, -path.extname(entry.name).length));
    } catch (error) {
      violations.push(`${name}: ${errorDetail(error)}`);
    }
  }

  if (jsonCandidates === 0 && violations.length === 0) {
    violations.push(`${CONTENT_ROOT_LABEL}: no JSON files found`);
  }
  return violations;
}

async function main() {
  const failures = await validateContent();

  if (failures.length === 0) {
    return;
  }

  for (const failure of failures) {
    console.error(`Content validation failed: ${failure}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
