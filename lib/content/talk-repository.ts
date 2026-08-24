import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { getTalkBundle } from "@/lib/content/talk-bundle-repository";
import { composeTalk } from "@/lib/content/talk-bundle-schema";
import { isCanonicalTalkSlug, validateTalk } from "@/lib/content/talk-schema";
import type { Talk } from "@/lib/content/talk-types";

function isNotFoundError(error: unknown): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

async function getLegacyTalk(slug: string, talksDirectory: string): Promise<Talk | null> {
  if (!isCanonicalTalkSlug(slug)) {
    return null;
  }

  const talkPath = path.join(talksDirectory, `${slug}.json`);
  let metadata;

  try {
    metadata = await lstat(talkPath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    const detail = error instanceof Error ? error.message : "unknown filesystem error";
    throw new Error(`Invalid talk content for "${slug}": ${detail}`);
  }

  if (metadata.isSymbolicLink()) {
    throw new Error(`Invalid talk content for "${slug}": symbolic links are not allowed`);
  }
  if (!metadata.isFile()) {
    throw new Error(`Invalid talk content for "${slug}": expected a file`);
  }

  let contents: string;

  try {
    contents = await readFile(talkPath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }

  try {
    const talk = validateTalk(JSON.parse(contents));

    if (talk.slug !== slug) {
      throw new Error("talk slug does not match its filename");
    }

    return talk;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown content error";
    throw new Error(`Invalid talk content for "${slug}": ${detail}`);
  }
}

export async function getTalk(slug: string): Promise<Talk | null> {
  if (!isCanonicalTalkSlug(slug)) {
    return null;
  }

  const talksDirectory = path.join(process.cwd(), "content", "talks");
  const bundle = await getTalkBundle(slug, talksDirectory);
  if (bundle !== null) {
    return composeTalk(bundle);
  }

  return getLegacyTalk(slug, talksDirectory);
}

export async function listPublishedTalks(): Promise<Talk[]> {
  const talksDirectory = path.join(process.cwd(), "content", "talks");
  const entries = await readdir(talksDirectory, { withFileTypes: true });
  const bundleSlugs = entries
    .filter((entry) => entry.isDirectory() && isCanonicalTalkSlug(entry.name))
    .map((entry) => entry.name);
  const legacySlugs = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.slice(0, -".json".length))
    .filter(isCanonicalTalkSlug);
  const slugs = [...new Set([...bundleSlugs, ...legacySlugs])]
    .sort((left, right) => left.localeCompare(right));
  const talks = await Promise.all(slugs.map((slug) => getTalk(slug)));

  return talks.filter((talk): talk is Talk => talk !== null && talk.published);
}
