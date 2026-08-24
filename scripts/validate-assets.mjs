import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { promisify } from "node:util";

import ffprobe from "ffprobe-static";
import sharp from "sharp";

import { classifyPublicAsset } from "./public-asset-policy.mjs";

const execFileAsync = promisify(execFile);
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const MAX_IMAGE_WIDTH = 2400;
const MAX_VIDEO_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_DURATION_SECONDS = 12;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const SECURE_DIRECTORY_OPEN_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const SUPPORTED_THREAT_MODEL = "trusted-same-uid-build";

function formatMegabytes(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function relativeName(publicDirectory, assetPath) {
  return path.relative(publicDirectory, assetPath).split(path.sep).join("/");
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

async function closeHandles(handles) {
  const uniqueHandles = [...new Set(handles.filter(Boolean))];
  const results = await Promise.allSettled(uniqueHandles.map((handle) => handle.close()));
  return results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
}

function canonicalDirectoryPaths(realDirectory) {
  const root = path.parse(realDirectory).root;
  const relative = path.relative(root, realDirectory);
  const paths = [root];
  if (relative === "") return paths;
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    paths.push(current);
  }
  return paths;
}

async function captureDirectory(directory, label) {
  const resolvedPath = path.resolve(directory);
  const before = await lstat(resolvedPath, { bigint: true });
  if (before.isSymbolicLink()) throw new Error(`${label} symlink not allowed: ${resolvedPath}`);
  if (!before.isDirectory()) throw new Error(`${label} must be a directory: ${resolvedPath}`);
  let handle;
  try {
    handle = await open(resolvedPath, SECURE_DIRECTORY_OPEN_FLAGS);
    const opened = await handle.stat({ bigint: true });
    if (!sameIdentity(before, opened)) throw new Error(`${label} identity changed: ${resolvedPath}`);
    const realPath = await realpath(resolvedPath);
    const after = await lstat(resolvedPath, { bigint: true });
    if (after.isSymbolicLink() || !sameIdentity(opened, after)) {
      throw new Error(`${label} identity changed: ${resolvedPath}`);
    }
    return { handle, identity: opened, path: resolvedPath, realPath };
  } catch (error) {
    await closeHandles([handle]);
    throw error;
  }
}

async function revalidateDirectory(captured, label) {
  const opened = await captured.handle.stat({ bigint: true });
  const current = await lstat(captured.path, { bigint: true });
  if (!sameIdentity(captured.identity, opened) || current.isSymbolicLink()
    || !sameIdentity(captured.identity, current)
    || await realpath(captured.path) !== captured.realPath) {
    throw new Error(`${label} identity changed: ${captured.path}`);
  }
}

function assertProtectedChainPermissions(chain) {
  const currentUid = BigInt(process.getuid());
  for (let index = 0; index < chain.captures.length - 1; index += 1) {
    const parent = chain.captures[index];
    const child = chain.captures[index + 1];
    if (path.dirname(child.realPath) !== parent.realPath) {
      throw new Error(`Asset validation public root ancestor chain changed at ${child.realPath}`);
    }
    if ((parent.identity.mode & 0o22n) === 0n) continue;
    const sticky = (parent.identity.mode & 0o1000n) !== 0n;
    const trustedParentOwner = parent.identity.uid === currentUid || parent.identity.uid === 0n;
    const trustedChildOwner = child.identity.uid === currentUid || child.identity.uid === 0n;
    const protectedOwner = trustedParentOwner && trustedChildOwner;
    if (!sticky || !protectedOwner) {
      throw new Error(
        `Asset validation public root ancestor ${parent.realPath} is writable without protective sticky ownership`,
      );
    }
  }
  const leaf = chain.captures.at(-1);
  if (leaf.identity.uid !== currentUid || (leaf.identity.mode & 0o22n) !== 0n) {
    throw new Error("Asset validation public root must be owned by the current uid and deny group/other writes");
  }
}

async function captureProtectedPublicRoot(directory) {
  const leaf = await captureDirectory(directory, "Asset validation public root");
  const captures = [];
  try {
    for (const canonicalPath of canonicalDirectoryPaths(leaf.realPath).slice(0, -1)) {
      captures.push(await captureDirectory(canonicalPath, "Asset validation public root ancestor"));
    }
    captures.push(leaf);
    const chain = { captures, leaf };
    assertProtectedChainPermissions(chain);
    await revalidateProtectedPublicRoot(chain);
    return chain;
  } catch (error) {
    await closeHandles([...captures.map((capture) => capture.handle), leaf.handle]);
    throw error;
  }
}

async function revalidateProtectedPublicRoot(chain) {
  for (const capture of chain.captures) {
    await revalidateDirectory(capture, "Asset validation public root");
  }
  assertProtectedChainPermissions(chain);
}

async function findFiles(rootDirectory, publicDirectory, violations) {
  let entries;

  try {
    const rootStat = await lstat(rootDirectory);
    const rootName = relativeName(publicDirectory, rootDirectory);

    if (rootStat.isSymbolicLink()) {
      violations.push(`${rootName}: symlink not allowed`);
      return [];
    }
    if (!rootStat.isDirectory()) {
      violations.push(`${rootName}: unsupported filesystem entry`);
      return [];
    }
    entries = await readdir(rootDirectory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const assetPath = path.join(rootDirectory, entry.name);
    const assetName = relativeName(publicDirectory, assetPath);
    const stat = await lstat(assetPath);

    if (stat.isSymbolicLink()) {
      violations.push(`${assetName}: symlink not allowed`);
      continue;
    }
    if (stat.isDirectory()) {
      files.push(...await findFiles(assetPath, publicDirectory, violations));
      continue;
    }
    if (!stat.isFile()) {
      violations.push(`${assetName}: unsupported filesystem entry`);
      continue;
    }

    files.push({ assetName, assetPath, size: stat.size });
  }

  return files;
}

async function readImageMetadata(assetPath) {
  return sharp(assetPath).metadata();
}

async function probeVideoDuration(assetPath) {
  const { stdout } = await execFileAsync(ffprobe.path, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    assetPath,
  ]);
  return Number.parseFloat(stdout.trim());
}

async function validateImage(asset, violations, getImageMetadata) {
  if (asset.size > MAX_IMAGE_BYTES) {
    violations.push(`${asset.assetName}: ${formatMegabytes(asset.size)} exceeds ${formatMegabytes(MAX_IMAGE_BYTES)}`);
  }

  try {
    const metadata = await getImageMetadata(asset.assetPath);
    if (typeof metadata.width !== "number") {
      violations.push(`${asset.assetName}: image width could not be measured`);
      return;
    }
    if (metadata.width > MAX_IMAGE_WIDTH) {
      violations.push(`${asset.assetName}: ${metadata.width}px exceeds ${MAX_IMAGE_WIDTH}px`);
    }
  } catch {
    violations.push(`${asset.assetName}: image metadata could not be read`);
  }
}

async function validateVideo(asset, violations, getVideoDuration) {
  if (asset.size > MAX_VIDEO_BYTES) {
    violations.push(`${asset.assetName}: ${formatMegabytes(asset.size)} exceeds ${formatMegabytes(MAX_VIDEO_BYTES)}`);
  }

  try {
    const duration = await getVideoDuration(asset.assetPath);

    if (!Number.isFinite(duration)) {
      violations.push(`${asset.assetName}: video duration could not be measured`);
      return;
    }
    if (duration > MAX_VIDEO_DURATION_SECONDS) {
      violations.push(`${asset.assetName}: ${duration.toFixed(2)}s exceeds ${MAX_VIDEO_DURATION_SECONDS.toFixed(2)}s`);
    }
  } catch {
    violations.push(`${asset.assetName}: video metadata could not be read`);
  }
}

function validatePdf(asset, violations) {
  if (asset.size > MAX_PDF_BYTES) {
    violations.push(`${asset.assetName}: ${formatMegabytes(asset.size)} exceeds ${formatMegabytes(MAX_PDF_BYTES)}`);
  }
}

/**
 * Checks only allowed, non-symlinked local files. The returned values contain
 * filenames and measured limits, never file contents.
 */
export async function validateAssets(
  publicDirectory = path.join(process.cwd(), "public"),
  {
    beforeTraversal,
    readImageMetadata: getImageMetadata = readImageMetadata,
    probeVideoDuration: getVideoDuration = probeVideoDuration,
    threatModel = SUPPORTED_THREAT_MODEL,
  } = {},
) {
  if (typeof constants.O_NOFOLLOW !== "number" || typeof constants.O_DIRECTORY !== "number"
    || typeof process.getuid !== "function") {
    throw new Error("Asset validation requires POSIX O_NOFOLLOW, O_DIRECTORY, and uid support.");
  }
  if (threatModel !== SUPPORTED_THREAT_MODEL) {
    throw new Error("hostile same-uid processes are outside the supported threat model");
  }
  const publicChain = await captureProtectedPublicRoot(publicDirectory);
  let operationFailed = false;
  try {
    const publicRoot = publicChain.leaf.realPath;
    await beforeTraversal?.();
    await revalidateProtectedPublicRoot(publicChain);
    const violations = [];
    const mediaFiles = await findFiles(path.join(publicRoot, "media"), publicRoot, violations);
    await revalidateProtectedPublicRoot(publicChain);
    const downloadFiles = await findFiles(path.join(publicRoot, "downloads"), publicRoot, violations);
    await revalidateProtectedPublicRoot(publicChain);

    for (const asset of [...mediaFiles, ...downloadFiles]) {
      const assetKind = classifyPublicAsset(asset.assetName);

      if (assetKind === "image") {
        await validateImage(asset, violations, getImageMetadata);
      } else if (assetKind === "video") {
        await validateVideo(asset, violations, getVideoDuration);
      } else if (assetKind === "pdf") {
        validatePdf(asset, violations);
      } else {
        violations.push(`${asset.assetName}: unsupported asset extension`);
      }
    }

    return violations;
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    const closeErrors = await closeHandles(publicChain.captures.map((capture) => capture.handle));
    if (!operationFailed && closeErrors.length > 0) {
      throw new AggregateError(closeErrors, "Failed to close one or more asset-validation handles");
    }
  }
}

async function main() {
  const violations = await validateAssets();

  if (violations.length === 0) {
    return;
  }

  for (const violation of violations) {
    console.error(`Asset validation failed: ${violation}`);
  }
  process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
