import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  realpath,
  rename,
  rm,
  rmdir,
} from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const modulePath = fileURLToPath(import.meta.url);
const supportedDirectories = new Set([
  "app",
  "components",
  "content",
  "gas",
  "lib",
  "public",
  "scripts",
  "tests",
]);
const supportedExceptionalFiles = new Set([
  ".agents/skills/managing-tha-talks/SKILL.md",
  ".agents/skills/managing-tha-talks/agents/openai.yaml",
  ".agents/skills/managing-tha-talks/references/project-contract.md",
  ".claude/skills/managing-tha-talks/SKILL.md",
  ".env.example",
  ".gitignore",
  ".github/workflows/ci.yml",
  ".github/workflows/pages.yml",
  ".nvmrc",
  "README.md",
  "docs/launch-checklist.md",
  "next-env.d.ts",
  "next.config.ts",
  "package-lock.json",
  "package.json",
  "playwright.config.ts",
  "release/public-files.json",
  "release/secret-rules.json",
  "tsconfig.json",
  "vitest.config.ts",
]);
const approvedTalkSlugs = ["ai-president-intro", "long-lived-companies"];
const canonicalTalkDocuments = [
  "evidence.json",
  "handout.json",
  "manifest.json",
  "presentation.json",
  "worksheets/experiment.json",
  "worksheets/explore.json",
  "worksheets/integrate.json",
  "worksheets/systemize.json",
];
const assetReferencePattern = /^\/(downloads|media)\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const imageExtensions = new Set([".avif", ".gif", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"]);
const videoExtensions = new Set([".m4v", ".mov", ".mp4", ".ogv", ".webm"]);
const secureDirectoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const secureReadFlags = constants.O_RDONLY | constants.O_NOFOLLOW;
const secureCreateFlags = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isNotFoundError(error) {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function isContained(root, target) {
  const relative = path.relative(root, target);
  return relative === ""
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function sameIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.uid === right.uid
    && left.gid === right.gid;
}

function sameInode(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameOwner(left, right) {
  return left.uid === right.uid && left.gid === right.gid;
}

function sameSnapshot(left, right) {
  return sameIdentity(left, right)
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function assertSecurePlatform() {
  if (process.platform === "win32"
    || typeof constants.O_NOFOLLOW !== "number"
    || typeof constants.O_DIRECTORY !== "number"
    || typeof process.getuid !== "function") {
    throw new Error("Public source preparation requires POSIX O_NOFOLLOW, O_DIRECTORY, and uid support.");
  }
}

function assertOwnedProtectedDirectory(captured) {
  if (captured.snapshot.uid !== BigInt(process.getuid())) {
    throw new Error(`${captured.label} must be owned by the current uid`);
  }
  if ((captured.snapshot.mode & 0o22n) !== 0n) {
    throw new Error(`${captured.label} must deny group/other writes`);
  }
}

function assertAbsoluteResolvedPath(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.resolve(value) !== value) {
    throw new Error(`${label} must be an absolute resolved path`);
  }
}

function assertRelativePath(relativePath, label) {
  if (typeof relativePath !== "string" || relativePath.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (relativePath.includes("\\")) throw new Error(`${label} must use POSIX separators; backslash is not allowed: ${relativePath}`);
  if (!/^[\x20-\x7e]+$/.test(relativePath) || relativePath.normalize("NFC") !== relativePath) {
    throw new Error(`${label} contains Unicode or non-ASCII ambiguity: ${relativePath}`);
  }
  if (path.posix.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    throw new Error(`${label} must be relative: ${relativePath}`);
  }
  const segments = relativePath.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`${label} contains an empty or traversal segment: ${relativePath}`);
  }
  if (path.posix.normalize(relativePath) !== relativePath) {
    throw new Error(`${label} is not normalized: ${relativePath}`);
  }
}

function registerPath(registry, relativePath, kind, label) {
  const collisionKey = relativePath.toLowerCase();
  const existing = registry.get(collisionKey);
  if (!existing) {
    registry.set(collisionKey, { kind, relativePath });
    return;
  }
  if (existing.relativePath !== relativePath) {
    throw new Error(`${label} case collision: ${existing.relativePath} and ${relativePath}`);
  }
  if (existing.kind !== kind) {
    throw new Error(`${label} destination collision: ${relativePath} is both ${existing.kind} and ${kind}`);
  }
}

function collectTopLevelJsonKeys(source) {
  const keys = [];
  let objectDepth = 0;
  let arrayDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === '"') break;
        index += 1;
      }
      if (index >= source.length) break;
      if (objectDepth === 1 && arrayDepth === 0) {
        let next = index + 1;
        while (/\s/.test(source[next] ?? "")) next += 1;
        if (source[next] === ":") keys.push(JSON.parse(source.slice(start, index + 1)));
      }
      continue;
    }
    if (character === "{") objectDepth += 1;
    else if (character === "}") objectDepth -= 1;
    else if (character === "[") arrayDepth += 1;
    else if (character === "]") arrayDepth -= 1;
  }
  return keys;
}

function validateManifest(rawManifest) {
  const topLevelKeys = collectTopLevelJsonKeys(rawManifest);
  const seenKeys = new Set();
  for (const key of topLevelKeys) {
    if (seenKeys.has(key)) throw new Error(`duplicate manifest key: ${key}`);
    seenKeys.add(key);
  }

  let manifest;
  try {
    manifest = JSON.parse(rawManifest);
  } catch (error) {
    throw new Error("release/public-files.json must contain valid JSON", { cause: error });
  }
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("release/public-files.json must contain an object");
  }
  const keys = Object.keys(manifest);
  for (const key of keys) {
    if (key !== "directories" && key !== "files") throw new Error(`unknown manifest key: ${key}`);
  }
  for (const key of ["directories", "files"]) {
    if (!Object.hasOwn(manifest, key) || !Array.isArray(manifest[key])) {
      throw new Error(`manifest ${key} must be an array`);
    }
  }

  const manifestRegistry = new Map();
  for (const [kind, entries] of [["directory", manifest.directories], ["file", manifest.files]]) {
    const exactEntries = new Set();
    for (const entry of entries) {
      assertRelativePath(entry, `manifest ${kind}`);
      if (exactEntries.has(entry)) throw new Error(`duplicate manifest path: ${entry}`);
      exactEntries.add(entry);
      registerPath(manifestRegistry, entry, kind, "manifest");
    }
  }

  for (const directory of manifest.directories) {
    if (directory.includes("/") || !supportedDirectories.has(directory)) {
      throw new Error(`manifest directory is not approved: ${directory}`);
    }
  }
  for (const file of manifest.files) {
    const parentDirectory = manifest.directories.find((directory) => file.startsWith(`${directory}/`));
    if (parentDirectory) throw new Error(`manifest overlap: ${file} is already covered by ${parentDirectory}`);
    if (!supportedExceptionalFiles.has(file)) throw new Error(`manifest file is not approved: ${file}`);
  }
  if (!manifest.files.includes("release/public-files.json")) {
    throw new Error("manifest must include release/public-files.json");
  }
  return {
    directories: [...manifest.directories].sort(comparePaths),
    files: [...manifest.files].sort(comparePaths),
  };
}

async function captureRoot(rootPath, label) {
  assertAbsoluteResolvedPath(rootPath, label);
  let before;
  try {
    before = await lstat(rootPath, { bigint: true });
  } catch (error) {
    if (isNotFoundError(error)) throw new Error(`${label} is missing: ${rootPath}`);
    throw error;
  }
  if (before.isSymbolicLink()) throw new Error(`${label} symlink not allowed: ${rootPath}`);
  if (!before.isDirectory()) throw new Error(`${label} must be a directory: ${rootPath}`);

  let handle;
  try {
    handle = await open(rootPath, secureDirectoryFlags);
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ELOOP") {
      throw new Error(`${label} symlink not allowed: ${rootPath}`);
    }
    throw error;
  }
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameSnapshot(before, opened)) throw new Error(`${label} identity changed while opening: ${rootPath}`);
    const realPath = await realpath(rootPath);
    if (realPath !== rootPath) {
      throw new Error(`${label} must equal its canonical realpath; symlinked ancestor not allowed: ${rootPath}`);
    }
    const after = await lstat(rootPath, { bigint: true });
    if (after.isSymbolicLink() || !sameSnapshot(opened, after)) {
      throw new Error(`${label} identity changed while resolving: ${rootPath}`);
    }
    return { handle, label, path: rootPath, realPath, snapshot: opened };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function revalidateRoot(captured) {
  const opened = await captured.handle.stat({ bigint: true });
  if (!sameSnapshot(captured.snapshot, opened)) throw new Error(`${captured.label} identity changed`);
  let current;
  try {
    current = await lstat(captured.realPath, { bigint: true });
  } catch (error) {
    if (isNotFoundError(error)) throw new Error(`${captured.label} identity changed`);
    throw error;
  }
  if (current.isSymbolicLink() || !sameSnapshot(captured.snapshot, current)) {
    throw new Error(`${captured.label} identity changed`);
  }
}

async function revalidateMutableDirectory(captured) {
  const opened = await captured.handle.stat({ bigint: true });
  if (!opened.isDirectory() || !sameInode(captured.snapshot, opened) || !sameOwner(captured.snapshot, opened)) {
    throw new Error(`${captured.label} identity changed`);
  }
  let current;
  try {
    current = await lstat(captured.realPath, { bigint: true });
  } catch (error) {
    if (isNotFoundError(error)) throw new Error(`${captured.label} identity changed`);
    throw error;
  }
  if (current.isSymbolicLink() || !current.isDirectory()
    || !sameInode(captured.snapshot, current) || !sameOwner(captured.snapshot, current)) {
    throw new Error(`${captured.label} identity changed`);
  }
}

function createScanContext(sourceRoot) {
  return {
    directories: new Map(),
    files: new Map(),
    pathRegistry: new Map(),
    sourceRoot,
  };
}

function sourcePath(context, relativePath) {
  const absolutePath = path.resolve(context.sourceRoot.realPath, ...relativePath.split("/"));
  if (!isContained(context.sourceRoot.realPath, absolutePath) || absolutePath === context.sourceRoot.realPath) {
    throw new Error(`source path escapes sourceRoot: ${relativePath}`);
  }
  return absolutePath;
}

async function inspectDirectory(context, relativePath) {
  assertRelativePath(relativePath, "source path");
  const existing = context.directories.get(relativePath);
  if (existing) return existing;
  registerPath(context.pathRegistry, relativePath, "directory", "source");
  const absolutePath = sourcePath(context, relativePath);
  let metadata;
  try {
    metadata = await lstat(absolutePath, { bigint: true });
  } catch (error) {
    if (isNotFoundError(error)) throw new Error(`source directory is missing: ${relativePath}`);
    throw error;
  }
  if (metadata.isSymbolicLink()) throw new Error(`source symlink not allowed: ${relativePath}`);
  if (!metadata.isDirectory()) throw new Error(`source directory must be a directory: ${relativePath}`);
  const resolvedPath = await realpath(absolutePath);
  if (resolvedPath !== absolutePath || !isContained(context.sourceRoot.realPath, resolvedPath)) {
    throw new Error(`source directory has a symlinked ancestor or escapes sourceRoot: ${relativePath}`);
  }
  const record = { absolutePath, relativePath, snapshot: metadata };
  context.directories.set(relativePath, record);
  return record;
}

async function inspectFile(context, relativePath) {
  assertRelativePath(relativePath, "source path");
  const existing = context.files.get(relativePath);
  if (existing) return existing;
  const segments = relativePath.split("/");
  let parent = "";
  for (const segment of segments.slice(0, -1)) {
    parent = parent ? `${parent}/${segment}` : segment;
    await inspectDirectory(context, parent);
  }

  registerPath(context.pathRegistry, relativePath, "file", "source");
  const absolutePath = sourcePath(context, relativePath);
  let metadata;
  try {
    metadata = await lstat(absolutePath, { bigint: true });
  } catch (error) {
    if (isNotFoundError(error)) throw new Error(`source file is missing: ${relativePath}`);
    throw error;
  }
  if (metadata.isSymbolicLink()) throw new Error(`source symlink not allowed: ${relativePath}`);
  if (!metadata.isFile()) throw new Error(`special source entry not allowed: ${relativePath}`);
  if (metadata.nlink !== 1n) throw new Error(`source hardlink not allowed: ${relativePath}`);
  const resolvedPath = await realpath(absolutePath);
  if (resolvedPath !== absolutePath || !isContained(context.sourceRoot.realPath, resolvedPath)) {
    throw new Error(`source file has a symlinked ancestor or escapes sourceRoot: ${relativePath}`);
  }
  const record = { absolutePath, relativePath, snapshot: metadata };
  context.files.set(relativePath, record);
  return record;
}

async function revalidateDirectoryRecord(record) {
  const metadata = await lstat(record.absolutePath, { bigint: true });
  if (metadata.isSymbolicLink() || !metadata.isDirectory() || !sameSnapshot(record.snapshot, metadata)) {
    throw new Error(`source directory identity changed: ${record.relativePath}`);
  }
}

async function revalidateFileRecord(context, record) {
  await revalidateRoot(context.sourceRoot);
  const segments = record.relativePath.split("/");
  let parent = "";
  for (const segment of segments.slice(0, -1)) {
    parent = parent ? `${parent}/${segment}` : segment;
    const directory = context.directories.get(parent);
    if (!directory) throw new Error(`source directory was not validated: ${parent}`);
    await revalidateDirectoryRecord(directory);
  }
  const metadata = await lstat(record.absolutePath, { bigint: true });
  if (metadata.isSymbolicLink() || !metadata.isFile() || !sameSnapshot(record.snapshot, metadata)) {
    throw new Error(`source file identity changed: ${record.relativePath}`);
  }
}

async function readVerifiedFile(context, record) {
  await revalidateFileRecord(context, record);
  let handle;
  try {
    handle = await open(record.absolutePath, secureReadFlags);
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error
      && ["ELOOP", "ENOENT"].includes(error.code)) {
      throw new Error(`source file changed or became a symlink: ${record.relativePath}`);
    }
    throw error;
  }
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameSnapshot(record.snapshot, opened)) {
      throw new Error(`source file identity changed before read: ${record.relativePath}`);
    }
    const bytes = await handle.readFile();
    const afterRead = await handle.stat({ bigint: true });
    if (!sameSnapshot(opened, afterRead)) {
      throw new Error(`source file changed during read: ${record.relativePath}`);
    }
    await revalidateFileRecord(context, record);
    return bytes;
  } finally {
    await handle.close();
  }
}

function validateAssetReference(value) {
  if (path.win32.isAbsolute(value) && !value.startsWith("/")) {
    throw new Error(`absolute filesystem asset path not allowed: ${value}`);
  }
  if (!value.startsWith("/")) return null;
  if (!value.startsWith("/downloads/") && !value.startsWith("/media/")) {
    throw new Error(`absolute filesystem asset path not allowed: ${value}`);
  }
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new Error(`invalid Talk asset reference: ${value}`);
  }
  if (decoded.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error(`path traversal in Talk asset reference: ${value}`);
  }
  if (!assetReferencePattern.test(value)) throw new Error(`invalid Talk asset reference: ${value}`);
  const relativeAsset = value.slice(1);
  const extension = path.posix.extname(relativeAsset).toLowerCase();
  const supported = (relativeAsset.startsWith("downloads/") && extension === ".pdf")
    || (relativeAsset.startsWith("media/") && (imageExtensions.has(extension) || videoExtensions.has(extension)));
  if (!supported) throw new Error(`unsupported Talk asset reference: ${value}`);
  return relativeAsset;
}

function collectAssetReferences(document) {
  const references = new Set();
  const visit = (value) => {
    if (typeof value === "string") {
      const reference = validateAssetReference(value);
      if (reference !== null) references.add(reference);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value !== null && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(document);
  return references;
}

async function collectApprovedContentPaths(context) {
  const allowedPaths = new Set();
  for (const approvedTalkSlug of approvedTalkSlugs) {
    const bundlePrefix = `content/talks/${approvedTalkSlug}`;
    const documents = [];
    for (const document of canonicalTalkDocuments) {
      const relativePath = `${bundlePrefix}/${document}`;
      const record = await inspectFile(context, relativePath);
      const bytes = await readVerifiedFile(context, record);
      let parsed;
      try {
        parsed = JSON.parse(bytes.toString("utf8"));
      } catch (error) {
        throw new Error(`approved Talk document must contain valid JSON: ${relativePath}`, { cause: error });
      }
      documents.push({ document, parsed });
      allowedPaths.add(relativePath);
    }
    const manifest = documents.find(({ document }) => document === "manifest.json")?.parsed;
    if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)
      || manifest.slug !== approvedTalkSlug || manifest.published !== true) {
      throw new Error(`approved Talk manifest must declare slug ${approvedTalkSlug} with published true`);
    }

    const references = new Set();
    for (const { parsed } of documents) {
      for (const reference of collectAssetReferences(parsed)) references.add(reference);
    }
    for (const reference of [...references].sort(comparePaths)) {
      allowedPaths.add(`${bundlePrefix}/assets/${reference}`);
    }
  }
  return allowedPaths;
}

function isForbiddenPath(relativePath) {
  const segments = relativePath.split("/");
  const basename = segments.at(-1);
  if (segments.some((segment) => (
    segment === ".git"
    || segment === ".local"
    || segment === ".superpowers"
    || segment === "node_modules"
    || segment === "out"
    || segment === "coverage"
    || segment === "test-results"
    || segment === "playwright-report"
    || segment === "blob-report"
    || segment === "tmp"
    || segment === "tina"
    || segment.startsWith(".next")
  ))) return true;
  if (basename.startsWith(".env") && relativePath !== ".env.example") return true;
  if (basename.endsWith(".tsbuildinfo")) return true;
  if (relativePath === "app/api" || relativePath.startsWith("app/api/")) return true;
  return /(^|[/_.-])(live|presenter)([/_.-]|$)/i.test(relativePath);
}

function shouldIncludeFile(relativePath, approvedContentPaths) {
  if (isForbiddenPath(relativePath)) return false;
  if (relativePath === "content" || relativePath.startsWith("content/")) {
    return approvedContentPaths.has(relativePath);
  }
  if (relativePath === "public" || relativePath.startsWith("public/")) {
    return relativePath === "public/.gitkeep";
  }
  return true;
}

async function scanDirectory(context, relativeDirectory, approvedContentPaths, plannedFiles) {
  const directory = await inspectDirectory(context, relativeDirectory);
  const entries = await readdir(directory.absolutePath, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => comparePaths(left.name, right.name))) {
    const relativePath = `${relativeDirectory}/${entry.name}`;
    assertRelativePath(relativePath, "source path");
    const absolutePath = sourcePath(context, relativePath);
    const metadata = await lstat(absolutePath, { bigint: true });
    if (metadata.isSymbolicLink()) throw new Error(`source symlink not allowed: ${relativePath}`);
    if (metadata.isDirectory()) {
      await scanDirectory(context, relativePath, approvedContentPaths, plannedFiles);
      continue;
    }
    if (!metadata.isFile()) throw new Error(`special source entry not allowed: ${relativePath}`);
    const record = await inspectFile(context, relativePath);
    if (shouldIncludeFile(relativePath, approvedContentPaths)) plannedFiles.set(relativePath, record);
  }
}

async function collectPlannedFiles(context, manifest) {
  const plannedFiles = new Map();
  const approvedContentPaths = manifest.directories.includes("content")
    ? await collectApprovedContentPaths(context)
    : new Set();
  for (const directory of manifest.directories) {
    await scanDirectory(context, directory, approvedContentPaths, plannedFiles);
  }
  for (const file of manifest.files) {
    plannedFiles.set(file, await inspectFile(context, file));
  }

  const destinationRegistry = new Map();
  for (const relativePath of plannedFiles.keys()) {
    registerPath(destinationRegistry, relativePath, "file", "candidate");
  }
  return [...plannedFiles.values()].sort((left, right) => comparePaths(left.relativePath, right.relativePath));
}

async function revalidateCandidateSource(context, records) {
  for (const record of records) await revalidateFileRecord(context, record);
}

async function cleanupUncapturedStagingRoot(stagePath, initialSnapshot) {
  let metadata;
  try {
    metadata = await lstat(stagePath, { bigint: true });
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()
    || !sameInode(initialSnapshot, metadata) || !sameOwner(initialSnapshot, metadata)) {
    throw new Error(`refusing to clean uncaptured stagingRoot after identity change: ${stagePath}`);
  }
  await rm(stagePath, { recursive: true });
}

async function cleanupFreshStagingRoot(stagePath) {
  let before;
  try {
    before = await lstat(stagePath, { bigint: true });
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
  if (before.isSymbolicLink() || !before.isDirectory()
    || before.uid !== BigInt(process.getuid()) || (before.mode & 0o77n) !== 0n) {
    throw new Error(`refusing to clean fresh stagingRoot without verified identity: ${stagePath}`);
  }

  let handle;
  try {
    handle = await open(stagePath, secureDirectoryFlags);
  } catch (error) {
    throw new Error(`refusing to clean fresh stagingRoot that cannot be opened safely: ${stagePath}`, {
      cause: error,
    });
  }
  try {
    const opened = await handle.stat({ bigint: true });
    const resolved = await realpath(stagePath);
    const entries = await readdir(stagePath);
    const after = await lstat(stagePath, { bigint: true });
    if (!opened.isDirectory() || resolved !== stagePath || entries.length > 0
      || after.isSymbolicLink() || !sameSnapshot(before, opened) || !sameSnapshot(opened, after)) {
      throw new Error(`refusing to clean fresh stagingRoot after identity change: ${stagePath}`);
    }
    await rmdir(stagePath);
  } finally {
    await handle.close();
  }
}

async function createStagingRoot(outputRoot, testHooks) {
  const parent = path.dirname(outputRoot.realPath);
  const stagePath = await mkdtemp(path.join(parent, ".build-public-source-"));
  let initialSnapshot;
  try {
    initialSnapshot = await lstat(stagePath, { bigint: true });
    await testHooks.afterStagingCreated?.({ stagingRoot: stagePath });
    await chmod(stagePath, 0o700);
    const captured = await captureRoot(stagePath, "stagingRoot");
    try {
      assertOwnedProtectedDirectory(captured);
    } catch (error) {
      await captured.handle.close();
      throw error;
    }
    return captured;
  } catch (error) {
    try {
      if (initialSnapshot) await cleanupUncapturedStagingRoot(stagePath, initialSnapshot);
      else await cleanupFreshStagingRoot(stagePath);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `staging initialization failed and cleanup was refused: ${stagePath}`,
      );
    }
    throw error;
  }
}

async function writeStagingTree(stageRoot, payloads) {
  for (const { bytes, record } of payloads) {
    const segments = record.relativePath.split("/");
    const filename = segments.pop();
    let parent = stageRoot.realPath;
    for (const segment of segments) {
      parent = path.join(parent, segment);
      await mkdir(parent, { mode: 0o755, recursive: true });
      const metadata = await lstat(parent, { bigint: true });
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
        throw new Error(`staging directory collision: ${record.relativePath}`);
      }
      const resolved = await realpath(parent);
      if (!isContained(stageRoot.realPath, resolved)) {
        throw new Error(`staging path escaped: ${record.relativePath}`);
      }
    }
    await revalidateMutableDirectory(stageRoot);
    const destination = path.join(parent, filename);
    const handle = await open(destination, secureCreateFlags, 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.chmod(Number(record.snapshot.mode & 0o777n));
      const written = await handle.stat({ bigint: true });
      if (!written.isFile() || written.size !== BigInt(bytes.length) || written.nlink !== 1n) {
        throw new Error(`staged file write was incomplete: ${record.relativePath}`);
      }
    } finally {
      await handle.close();
    }
  }
}

async function assertOutputEmpty(outputRoot) {
  await revalidateRoot(outputRoot);
  const entries = await readdir(outputRoot.realPath);
  if (entries.length > 0) throw new Error("outputRoot must be empty");
}

async function publishStagingRoot(stageRoot, outputRoot, testHooks) {
  await Promise.all([revalidateMutableDirectory(stageRoot), assertOutputEmpty(outputRoot)]);
  assertOwnedProtectedDirectory(outputRoot);
  if (stageRoot.snapshot.uid !== outputRoot.snapshot.uid
    || stageRoot.snapshot.gid !== outputRoot.snapshot.gid) {
    throw new Error("stagingRoot ownership must match outputRoot before publication");
  }
  const outputMode = Number(outputRoot.snapshot.mode & 0o777n);
  await chmod(stageRoot.realPath, outputMode);
  await revalidateMutableDirectory(stageRoot);
  await revalidateRoot(outputRoot);
  await testHooks.beforePublish?.({
    outputRoot: outputRoot.realPath,
    stagingRoot: stageRoot.realPath,
  });
  await Promise.all([revalidateMutableDirectory(stageRoot), assertOutputEmpty(outputRoot)]);
  assertOwnedProtectedDirectory(outputRoot);
  await rename(stageRoot.realPath, outputRoot.realPath);
}

async function cleanupStagingRoot(stageRoot) {
  let metadata;
  try {
    metadata = await lstat(stageRoot.realPath, { bigint: true });
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
  const opened = await stageRoot.handle.stat({ bigint: true });
  if (metadata.isSymbolicLink() || !metadata.isDirectory()
    || !sameInode(stageRoot.snapshot, metadata) || !sameOwner(stageRoot.snapshot, metadata)
    || !sameInode(stageRoot.snapshot, opened) || !sameOwner(stageRoot.snapshot, opened)) {
    throw new Error(`refusing to clean stagingRoot after identity change: ${stageRoot.realPath}`);
  }
  await rm(stageRoot.realPath, { recursive: true });
}

async function closeCaptures(captures) {
  const results = await Promise.allSettled(captures.filter(Boolean).map((capture) => capture.handle.close()));
  const errors = results.filter((result) => result.status === "rejected").map((result) => result.reason);
  if (errors.length > 0) throw new AggregateError(errors, "failed to close verified filesystem handles");
}

export async function buildPublicSource({ sourceRoot, outputRoot, testHooks = {} }) {
  assertSecurePlatform();
  let sourceCapture;
  let outputCapture;
  let stageCapture;
  let published = false;
  let operationError;
  try {
    sourceCapture = await captureRoot(sourceRoot, "sourceRoot");
    outputCapture = await captureRoot(outputRoot, "outputRoot");
    assertOwnedProtectedDirectory(outputCapture);
    if (isContained(sourceCapture.realPath, outputCapture.realPath)
      || isContained(outputCapture.realPath, sourceCapture.realPath)) {
      throw new Error("sourceRoot and outputRoot must not contain each other");
    }
    await assertOutputEmpty(outputCapture);

    const context = createScanContext(sourceCapture);
    const manifestRecord = await inspectFile(context, "release/public-files.json");
    const manifestBytes = await readVerifiedFile(context, manifestRecord);
    const manifest = validateManifest(manifestBytes.toString("utf8"));
    const records = await collectPlannedFiles(context, manifest);
    const payloads = [];
    for (const record of records) {
      payloads.push({ bytes: await readVerifiedFile(context, record), record });
    }
    await revalidateCandidateSource(context, records);
    await assertOutputEmpty(outputCapture);

    stageCapture = await createStagingRoot(outputCapture, testHooks);
    await writeStagingTree(stageCapture, payloads);
    await revalidateCandidateSource(context, records);
    await publishStagingRoot(stageCapture, outputCapture, testHooks);
    published = true;
    return { files: records.map((record) => record.relativePath) };
  } catch (error) {
    operationError = error;
    if (stageCapture && !published) {
      try {
        await cleanupStagingRoot(stageCapture);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `public source build failed and private staging cleanup was refused: ${stageCapture.realPath}`,
        );
      }
    }
    throw error;
  } finally {
    try {
      await closeCaptures([stageCapture, outputCapture, sourceCapture]);
    } catch (closeError) {
      if (!operationError) throw closeError;
    }
  }
}

function parseCliArguments(arguments_) {
  let output;
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--output") {
      if (output !== undefined || index + 1 >= arguments_.length) {
        throw new Error("--output requires exactly one directory");
      }
      output = arguments_[index + 1];
      index += 1;
      continue;
    }
    if (argument.startsWith("--output=")) {
      if (output !== undefined || argument.length === "--output=".length) {
        throw new Error("--output requires exactly one directory");
      }
      output = argument.slice("--output=".length);
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }
  if (output === undefined) throw new Error("--output is required");
  return { outputRoot: path.resolve(output) };
}

async function main() {
  const { outputRoot } = parseCliArguments(process.argv.slice(2));
  const sourceRoot = path.resolve(path.dirname(modulePath), "..");
  const result = await buildPublicSource({ sourceRoot, outputRoot });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) await main();
