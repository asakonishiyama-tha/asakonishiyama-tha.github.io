import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

import { validateTalkBundle } from "@/lib/content/talk-bundle-schema";
import { isCanonicalTalkSlug } from "@/lib/content/talk-schema";
import type { TalkBundle } from "@/lib/content/talk-bundle-types";

const bundleFiles = ["manifest.json", "presentation.json", "handout.json", "evidence.json"] as const;
const stages = ["explore", "experiment", "systemize", "integrate"] as const;

function isNotFoundError(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function invalidDocument(slug: string, document: string, detail: string): Error {
  return new Error(`Invalid talk bundle document "${document}" for "${slug}": ${detail}`);
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : "unknown filesystem error";
}

function documentFromError(error: unknown): string | null {
  return error !== null && typeof error === "object" && "document" in error && typeof error.document === "string"
    ? error.document
    : null;
}

async function readBundleDocument(slug: string, bundleDirectory: string, document: string): Promise<unknown> {
  const documentPath = path.join(bundleDirectory, document);
  let metadata;

  try {
    metadata = await lstat(documentPath);
  } catch (error) {
    if (isNotFoundError(error)) {
      throw invalidDocument(slug, document, "file is missing");
    }
    throw invalidDocument(slug, document, errorDetail(error));
  }

  if (metadata.isSymbolicLink()) {
    throw invalidDocument(slug, document, "symbolic links are not allowed");
  }
  if (!metadata.isFile()) {
    throw invalidDocument(slug, document, "expected a file");
  }

  let contents: string;
  try {
    contents = await readFile(documentPath, "utf8");
  } catch (error) {
    throw invalidDocument(slug, document, errorDetail(error));
  }

  try {
    return JSON.parse(contents);
  } catch (error) {
    throw invalidDocument(slug, document, errorDetail(error));
  }
}

export async function getTalkBundle(
  slug: string,
  talksDirectory = path.join(process.cwd(), "content", "talks"),
): Promise<TalkBundle | null> {
  if (!isCanonicalTalkSlug(slug)) {
    return null;
  }

  const bundleDirectory = path.join(talksDirectory, slug);
  let directoryMetadata;
  try {
    directoryMetadata = await lstat(bundleDirectory);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw invalidDocument(slug, "bundle directory", errorDetail(error));
  }

  if (directoryMetadata.isSymbolicLink()) {
    throw invalidDocument(slug, ".", "symbolic links are not allowed");
  }
  if (!directoryMetadata.isDirectory()) {
    throw invalidDocument(slug, ".", "expected a directory");
  }

  const documents: unknown[] = [];
  for (const file of bundleFiles) {
    documents.push(await readBundleDocument(slug, bundleDirectory, file));
  }
  const worksheetsDirectory = path.join(bundleDirectory, "worksheets");
  let worksheetsMetadata;
  try {
    worksheetsMetadata = await lstat(worksheetsDirectory);
  } catch (error) {
    if (isNotFoundError(error)) {
      throw invalidDocument(slug, "worksheets", "directory is missing");
    }
    throw invalidDocument(slug, "worksheets", errorDetail(error));
  }
  if (worksheetsMetadata.isSymbolicLink()) {
    throw invalidDocument(slug, "worksheets", "symbolic links are not allowed");
  }
  if (!worksheetsMetadata.isDirectory()) {
    throw invalidDocument(slug, "worksheets", "expected a directory");
  }

  const worksheetValues: unknown[] = [];
  for (const stage of stages) {
    worksheetValues.push(await readBundleDocument(slug, worksheetsDirectory, `${stage}.json`));
  }

  try {
    return validateTalkBundle({
      manifest: documents[0],
      presentation: documents[1],
      handout: documents[2],
      evidence: documents[3],
      worksheets: Object.fromEntries(stages.map((stage, index) => [stage, worksheetValues[index]])),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown content error";
    const document = documentFromError(error);
    if (document !== null) {
      throw invalidDocument(slug, document, detail);
    }
    throw new Error(`Invalid talk bundle for "${slug}": ${detail}`);
  }
}
