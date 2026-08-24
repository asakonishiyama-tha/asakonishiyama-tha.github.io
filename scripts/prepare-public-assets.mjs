import {
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
} from "node:fs/promises";
import { constants } from "node:fs";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { classifyPublicAsset } from "./public-asset-policy.mjs";

const canonicalSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const bundleDocuments = [
  "manifest.json",
  "presentation.json",
  "handout.json",
  "evidence.json",
  "worksheets/explore.json",
  "worksheets/experiment.json",
  "worksheets/systemize.json",
  "worksheets/integrate.json",
];
const generatedDirectories = ["downloads", "media"];
const assetReferencePattern = /^\/(downloads|media)\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const secureDirectoryOpenFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const supportedThreatModel = "trusted-same-uid-build";

function isNotFoundError(error) {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function isContained(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function sameFileSnapshot(left, right) {
  return sameIdentity(left, right)
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

async function closeHandles(handles) {
  const uniqueHandles = [...new Set(handles.filter(Boolean))];
  const results = await Promise.allSettled(uniqueHandles.map((handle) => handle.close()));
  return results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
}

async function readVerifiedFile(filePath, root, label, kind, testHooks) {
  const parentChain = await captureProtectedChain(path.dirname(filePath), `${label} parent`);
  try {
    await revalidateProtectedChain(parentChain);
    const before = await lstat(filePath, { bigint: true });
    if (before.isSymbolicLink()) throw new Error(`${label} symlink not allowed: ${filePath}`);
    if (!before.isFile()) throw new Error(`${label} must be a file: ${filePath}`);
    const beforeRealPath = await realpath(filePath);
    if (!isContained(root, beforeRealPath)) throw new Error(`${label} outside verified root: ${filePath}`);

    await testHooks.afterFileValidation?.({ kind, filePath });
    await revalidateProtectedChain(parentChain);

    let handle;
    try {
      handle = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error
        && ["ELOOP", "ENOENT"].includes(error.code)) {
        throw new Error(`${label} changed or symlink appeared before open: ${filePath}`);
      }
      throw error;
    }

    try {
      const opened = await handle.stat({ bigint: true });
      if (!sameFileSnapshot(before, opened)) throw new Error(`${label} identity changed before open: ${filePath}`);
      const contents = await handle.readFile();
      const afterRead = await handle.stat({ bigint: true });
      if (!sameFileSnapshot(opened, afterRead)) throw new Error(`${label} changed during read: ${filePath}`);

      await revalidateProtectedChain(parentChain);
      const afterPath = await lstat(filePath, { bigint: true });
      if (afterPath.isSymbolicLink() || !sameIdentity(opened, afterPath)) {
        throw new Error(`${label} identity changed after open: ${filePath}`);
      }
      const afterRealPath = await realpath(filePath);
      if (afterRealPath !== beforeRealPath || !isContained(root, afterRealPath)) {
        throw new Error(`${label} resolved path changed after open: ${filePath}`);
      }
      return contents;
    } finally {
      await closeHandles([handle]);
    }
  } finally {
    await closeHandles(parentChain.captures.map((capture) => capture.handle));
  }
}

function assertSecurePlatform() {
  if (typeof constants.O_NOFOLLOW !== "number" || typeof constants.O_DIRECTORY !== "number"
    || typeof process.getuid !== "function") {
    throw new Error("Secure asset preparation requires POSIX O_NOFOLLOW, O_DIRECTORY, and uid support.");
  }
}

async function captureDirectory(directory, label) {
  const resolvedPath = path.resolve(directory);
  let before;
  try {
    before = await lstat(resolvedPath, { bigint: true });
  } catch (error) {
    if (isNotFoundError(error)) throw new Error(`${label} is missing: ${resolvedPath}`);
    throw error;
  }
  if (before.isSymbolicLink()) throw new Error(`${label} symlink not allowed: ${resolvedPath}`);
  if (!before.isDirectory()) throw new Error(`${label} must be a directory: ${resolvedPath}`);

  let handle;
  try {
    handle = await open(resolvedPath, secureDirectoryOpenFlags);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ELOOP") {
      throw new Error(`${label} symlink not allowed: ${resolvedPath}`);
    }
    throw error;
  }
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameIdentity(before, opened)) throw new Error(`${label} identity changed while opening: ${resolvedPath}`);
    const realPath = await realpath(resolvedPath);
    const afterPath = await lstat(resolvedPath, { bigint: true });
    if (afterPath.isSymbolicLink() || !sameIdentity(opened, afterPath)) {
      throw new Error(`${label} identity changed while opening: ${resolvedPath}`);
    }
    return { handle, identity: opened, path: resolvedPath, realPath };
  } catch (error) {
    await closeHandles([handle]);
    throw error;
  }
}

async function revalidateDirectory(captured, label, candidatePath = captured.path) {
  const openIdentity = await captured.handle.stat({ bigint: true });
  if (!sameIdentity(captured.identity, openIdentity)) {
    throw new Error(`${label} identity changed: ${candidatePath}`);
  }
  let current;
  try {
    current = await lstat(candidatePath, { bigint: true });
  } catch (error) {
    if (isNotFoundError(error)) throw new Error(`${label} identity changed: ${candidatePath}`);
    throw error;
  }
  if (current.isSymbolicLink() || !sameIdentity(captured.identity, current)) {
    throw new Error(`${label} identity changed: ${candidatePath}`);
  }
  const currentRealPath = await realpath(candidatePath);
  if (candidatePath === captured.path && currentRealPath !== captured.realPath) {
    throw new Error(`${label} identity changed: ${candidatePath}`);
  }
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

function assertProtectedChainPermissions(chain) {
  const currentUid = BigInt(process.getuid());
  for (let index = 0; index < chain.captures.length - 1; index += 1) {
    const parent = chain.captures[index];
    const child = chain.captures[index + 1];
    if (path.dirname(child.realPath) !== parent.realPath) {
      throw new Error(`${chain.label} ancestor chain changed between ${parent.realPath} and ${child.realPath}`);
    }
    if ((parent.identity.mode & 0o22n) === 0n) continue;
    const sticky = (parent.identity.mode & 0o1000n) !== 0n;
    const trustedParentOwner = parent.identity.uid === currentUid || parent.identity.uid === 0n;
    const trustedChildOwner = child.identity.uid === currentUid || child.identity.uid === 0n;
    const protectedOwner = trustedParentOwner && trustedChildOwner;
    if (!sticky || !protectedOwner) {
      throw new Error(
        `${chain.label} ancestor ${parent.realPath} is writable without protective sticky ownership`,
      );
    }
  }
  if (chain.protectLeafChildren) {
    const leaf = chain.captures.at(-1);
    if (leaf.identity.uid !== currentUid || (leaf.identity.mode & 0o22n) !== 0n) {
      throw new Error(`${chain.label} must be owned by the current uid and deny group/other writes`);
    }
  }
}

async function captureProtectedChain(directory, label, { protectLeafChildren = true } = {}) {
  const leaf = await captureDirectory(directory, label);
  const captures = [];
  try {
    const canonicalPaths = canonicalDirectoryPaths(leaf.realPath);
    for (const canonicalPath of canonicalPaths.slice(0, -1)) {
      captures.push(await captureDirectory(canonicalPath, `${label} ancestor`));
    }
    captures.push(leaf);
    const chain = { captures, label, leaf, protectLeafChildren };
    assertProtectedChainPermissions(chain);
    await revalidateProtectedChain(chain);
    return chain;
  } catch (error) {
    await closeHandles([...captures.map((capture) => capture.handle), leaf.handle]);
    throw error;
  }
}

async function revalidateProtectedChain(chain) {
  for (const capture of chain.captures) {
    await revalidateDirectory(capture, `${chain.label} identity changed`);
  }
  assertProtectedChainPermissions(chain);
}

async function captureOptionalGeneratedDirectory(publicRoot, name) {
  const directory = path.resolve(publicRoot.realPath, name);
  if (!isContained(publicRoot.realPath, directory) || directory === publicRoot.realPath) {
    throw new Error(`generated output outside public root: ${directory}`);
  }
  try {
    const captured = await captureDirectory(directory, `generated output ${name}`);
    if (!isContained(publicRoot.realPath, captured.realPath) || captured.realPath === publicRoot.realPath) {
      await closeHandles([captured.handle]);
      throw new Error(`generated output outside public root: ${captured.realPath}`);
    }
    return { captured, existed: true, name, path: directory };
  } catch (error) {
    if (error instanceof Error && error.message === `generated output ${name} is missing: ${directory}`) {
      return { captured: null, existed: false, name, path: directory };
    }
    throw error;
  }
}

async function revalidateGeneratedDirectory(snapshot) {
  if (snapshot.existed) {
    await revalidateDirectory(snapshot.captured, `generated output identity changed for ${snapshot.name}`);
    return;
  }
  try {
    await lstat(snapshot.path);
  } catch (error) {
    if (isNotFoundError(error)) return;
    throw error;
  }
  throw new Error(`generated output identity changed for ${snapshot.name}`);
}

function publicParentFromChain(publicChain) {
  if (publicChain.captures.length < 2) throw new Error("public root cannot be the filesystem root");
  const parent = publicChain.captures.at(-2);
  if (parent.identity.uid !== BigInt(process.getuid()) || (parent.identity.mode & 0o22n) !== 0n) {
    throw new Error("public parent must be owned by the current uid and deny group/other writes");
  }
  return parent;
}

async function createPrivateWorkspace(publicChain, parent) {
  await revalidateProtectedChain(publicChain);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const workspacePath = path.join(parent.realPath, `.prepare-public-assets-${randomBytes(16).toString("hex")}`);
    try {
      await mkdir(workspacePath, { mode: 0o700 });
      const workspaceChain = await captureProtectedChain(workspacePath, "private workspace");
      if ((workspaceChain.leaf.identity.mode & 0o077n) !== 0n) {
        await closeHandles(workspaceChain.captures.map((capture) => capture.handle));
        throw new Error("private workspace permissions are not exclusive to the current uid");
      }
      return workspaceChain;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error("could not allocate a unique private workspace");
}

async function createStagingTree(workspaceChain, assets) {
  const workspace = workspaceChain.leaf;
  await revalidateProtectedChain(workspaceChain);
  const stagePath = path.join(workspace.realPath, "stage");
  const quarantinePath = path.join(workspace.realPath, "quarantine");
  await mkdir(stagePath, { mode: 0o700 });
  await mkdir(quarantinePath, { mode: 0o700 });

  for (const name of generatedDirectories) await mkdir(path.join(stagePath, name), { mode: 0o700 });
  for (const [relativeAsset, bytes] of [...assets.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    await revalidateProtectedChain(workspaceChain);
    const segments = relativeAsset.split("/");
    const filename = segments.pop();
    let parentPath = stagePath;
    for (const segment of segments) {
      parentPath = path.join(parentPath, segment);
      try {
        await mkdir(parentPath, { mode: 0o700 });
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "EEXIST")) throw error;
      }
      const parentMetadata = await lstat(parentPath);
      if (parentMetadata.isSymbolicLink() || !parentMetadata.isDirectory()) {
        throw new Error(`staging parent identity changed: ${relativeAsset}`);
      }
      const parentRealPath = await realpath(parentPath);
      if (!isContained(stagePath, parentRealPath)) throw new Error(`staging parent outside workspace: ${relativeAsset}`);
    }

    await revalidateProtectedChain(workspaceChain);
    const destination = path.join(parentPath, filename);
    const handle = await open(
      destination,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(bytes);
      const written = await handle.stat({ bigint: true });
      if (!written.isFile() || written.size !== BigInt(bytes.length)) {
        throw new Error(`staged asset write was incomplete: ${relativeAsset}`);
      }
    } finally {
      await closeHandles([handle]);
    }
  }
  return { quarantinePath, stagePath };
}

export class AssetRecoveryError extends Error {
  constructor(message, recoveryPath, cause, recoveryErrors) {
    super(message, { cause });
    this.name = "AssetRecoveryError";
    this.recoveryPath = recoveryPath;
    this.recoveryErrors = recoveryErrors;
  }
}

async function revalidateMutationRoots(publicChain, workspaceChain) {
  await revalidateProtectedChain(publicChain);
  await revalidateProtectedChain(workspaceChain);
}

async function rollbackPublication({ publicChain, workspaceChain, staging, states, testHooks }) {
  const recoveryErrors = [];
  for (const state of [...states].reverse()) {
    const { snapshot } = state;
    if (state.newPublished) {
      try {
        await testHooks.rollbackBoundary?.({ name: snapshot.name, boundary: "before-remove-published" });
        await revalidateMutationRoots(publicChain, workspaceChain);
        const failedPath = path.join(staging.stagePath, `${snapshot.name}-failed`);
        await rename(snapshot.path, failedPath);
        state.newPublished = false;
      } catch (error) {
        recoveryErrors.push(error);
      }
    }
    if (state.previousMoved && !state.newPublished) {
      try {
        await testHooks.rollbackBoundary?.({ name: snapshot.name, boundary: "before-restore-original" });
        await revalidateMutationRoots(publicChain, workspaceChain);
        const quarantinePath = path.join(staging.quarantinePath, snapshot.name);
        await revalidateDirectory(
          snapshot.captured,
          `generated output identity changed for ${snapshot.name}`,
          quarantinePath,
        );
        await rename(quarantinePath, snapshot.path);
        state.previousMoved = false;
      } catch (error) {
        recoveryErrors.push(error);
      }
    }
  }
  return recoveryErrors;
}

async function publishStagedDirectories({ publicChain, workspaceChain, staging, snapshots, testHooks }) {
  const publicRoot = publicChain.leaf;
  for (const snapshot of snapshots) {
    await testHooks.beforePublish?.({ name: snapshot.name, publicDirectory: publicRoot.path });
    await revalidateMutationRoots(publicChain, workspaceChain);
    await revalidateGeneratedDirectory(snapshot);
  }

  const states = snapshots.map((snapshot) => ({
    newPublished: false,
    previousMoved: false,
    snapshot,
  }));
  try {
    for (const state of states) {
      const { snapshot } = state;
      await revalidateMutationRoots(publicChain, workspaceChain);
      await revalidateGeneratedDirectory(snapshot);
      const stagedPath = path.join(staging.stagePath, snapshot.name);
      const quarantinePath = path.join(staging.quarantinePath, snapshot.name);
      await testHooks.publishBoundary?.({ name: snapshot.name, boundary: "before-quarantine" });
      await revalidateMutationRoots(publicChain, workspaceChain);
      await revalidateGeneratedDirectory(snapshot);
      if (snapshot.existed) {
        await rename(snapshot.path, quarantinePath);
        state.previousMoved = true;
        await revalidateMutationRoots(publicChain, workspaceChain);
        await revalidateDirectory(snapshot.captured, `generated output identity changed for ${snapshot.name}`, quarantinePath);
      }
      await testHooks.publishBoundary?.({ name: snapshot.name, boundary: "after-quarantine" });
      await revalidateMutationRoots(publicChain, workspaceChain);
      await testHooks.publishBoundary?.({ name: snapshot.name, boundary: "before-stage" });
      await revalidateMutationRoots(publicChain, workspaceChain);
      await rename(stagedPath, snapshot.path);
      state.newPublished = true;
      await revalidateMutationRoots(publicChain, workspaceChain);
      await testHooks.publishBoundary?.({ name: snapshot.name, boundary: "after-stage" });
      await revalidateMutationRoots(publicChain, workspaceChain);
    }
  } catch (error) {
    const recoveryErrors = await rollbackPublication({
      publicChain,
      workspaceChain,
      staging,
      states,
      testHooks,
    });
    if (recoveryErrors.length > 0) {
      throw new AssetRecoveryError(
        `Asset publication failed and rollback was incomplete; recovery data preserved at ${workspaceChain.leaf.path}`,
        workspaceChain.leaf.path,
        error,
        recoveryErrors,
      );
    }
    throw error;
  }
}

async function cleanupWorkspace(workspaceChain, publicChain, testHooks, invokeHook) {
  const workspace = workspaceChain.leaf;
  if (invokeHook) await testHooks.beforeCleanup?.({ workspaceDirectory: workspace.path });
  await revalidateProtectedChain(publicChain);
  await revalidateProtectedChain(workspaceChain);
  await rm(workspace.path, { recursive: true });
}

async function readDocument(bundleRoot, document, testHooks) {
  const documentPath = path.resolve(bundleRoot, document);
  if (!isContained(bundleRoot, documentPath)) {
    throw new Error(`Talk bundle document outside bundle root: ${document}`);
  }

  const segments = document.split("/");
  let current = bundleRoot;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (isNotFoundError(error)) throw new Error(`Talk bundle document is missing: ${document}`);
      throw error;
    }
    if (metadata.isSymbolicLink()) throw new Error(`Talk bundle document symlink not allowed: ${document}`);
    if (index < segments.length - 1 && !metadata.isDirectory()) {
      throw new Error(`Talk bundle document parent must be a directory: ${document}`);
    }
    if (index === segments.length - 1 && !metadata.isFile()) {
      throw new Error(`Talk bundle document must be a file: ${document}`);
    }
  }

  const contents = await readVerifiedFile(
    documentPath,
    bundleRoot,
    "Talk bundle document",
    "document",
    testHooks,
  );
  return JSON.parse(contents.toString("utf8"));
}

function validateAssetReference(value) {
  if (path.win32.isAbsolute(value) && !value.startsWith("/")) {
    throw new Error(`absolute filesystem path not allowed: ${value}`);
  }
  if (!value.startsWith("/")) return null;
  if (!value.startsWith("/downloads/") && !value.startsWith("/media/")) {
    throw new Error(`absolute filesystem path not allowed: ${value}`);
  }

  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new Error(`invalid asset reference: ${value}`);
  }
  if (decoded.split("/").some((segment) => segment === "." || segment === "..")) {
    throw new Error(`path traversal in asset reference: ${value}`);
  }
  if (!assetReferencePattern.test(value)) {
    throw new Error(`invalid asset reference: ${value}`);
  }
  const relativeAsset = value.slice(1);
  if (classifyPublicAsset(relativeAsset) === null) {
    throw new Error(`unsupported asset extension: ${relativeAsset}`);
  }
  return relativeAsset;
}

function collectDocumentReferences(document) {
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

async function readAsset(bundleRoot, relativeAsset, testHooks) {
  const assetsPath = path.resolve(bundleRoot, "assets");
  let assetsMetadata;
  try {
    assetsMetadata = await lstat(assetsPath);
  } catch (error) {
    if (isNotFoundError(error)) throw new Error(`missing source: ${relativeAsset}`);
    throw error;
  }
  if (assetsMetadata.isSymbolicLink()) throw new Error(`source symlink not allowed: ${relativeAsset}`);
  if (!assetsMetadata.isDirectory()) throw new Error(`source assets root must be a directory: ${relativeAsset}`);

  const assetsRoot = await realpath(assetsPath);
  if (!isContained(bundleRoot, assetsRoot)) throw new Error(`source outside Talk assets: ${relativeAsset}`);

  const sourcePath = path.resolve(assetsRoot, relativeAsset);
  if (!isContained(assetsRoot, sourcePath)) throw new Error(`source outside Talk assets: ${relativeAsset}`);

  const segments = relativeAsset.split("/");
  let current = assetsRoot;
  for (const [index, segment] of segments.entries()) {
    current = path.join(current, segment);
    let metadata;
    try {
      metadata = await lstat(current);
    } catch (error) {
      if (isNotFoundError(error)) throw new Error(`missing source: ${relativeAsset}`);
      throw error;
    }
    if (metadata.isSymbolicLink()) throw new Error(`source symlink not allowed: ${relativeAsset}`);
    if (index < segments.length - 1 && !metadata.isDirectory()) {
      throw new Error(`source parent must be a directory: ${relativeAsset}`);
    }
    if (index === segments.length - 1 && !metadata.isFile()) {
      throw new Error(`source must be a file: ${relativeAsset}`);
    }
  }

  return readVerifiedFile(sourcePath, assetsRoot, "Talk asset", "asset", testHooks);
}

async function collectPublishedAssets(talksChain, testHooks) {
  const talksRoot = talksChain.leaf.realPath;
  const assets = new Map();
  await revalidateProtectedChain(talksChain);
  const entries = await readdir(talksRoot, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    await revalidateProtectedChain(talksChain);
    const entryPath = path.join(talksRoot, entry.name);
    const metadata = await lstat(entryPath);
    if (metadata.isSymbolicLink()) throw new Error(`Talk bundle symlink not allowed: ${entry.name}`);
    if (!metadata.isDirectory() || !canonicalSlugPattern.test(entry.name)) continue;

    const bundleRoot = await realpath(entryPath);
    if (!isContained(talksRoot, bundleRoot)) throw new Error(`Talk bundle outside Talks root: ${entry.name}`);
    const manifest = await readDocument(bundleRoot, "manifest.json", testHooks);
    if (manifest === null || typeof manifest !== "object") {
      throw new Error(`Talk bundle manifest must be an object: ${entry.name}`);
    }
    if (typeof manifest.slug !== "string" || !canonicalSlugPattern.test(manifest.slug)) {
      throw new Error(`Talk bundle manifest requires a canonical slug: ${entry.name}`);
    }
    if (manifest.slug !== entry.name) {
      throw new Error(`Talk bundle manifest slug must match directory ${entry.name}`);
    }
    if (typeof manifest.published !== "boolean") {
      throw new Error(`Talk bundle requires a boolean published field: ${entry.name}`);
    }
    if (!manifest.published) continue;

    const documents = [manifest];
    for (const document of bundleDocuments.slice(1)) {
      documents.push(await readDocument(bundleRoot, document, testHooks));
    }
    const references = new Set();
    for (const document of documents) {
      for (const reference of collectDocumentReferences(document)) references.add(reference);
    }

    for (const reference of [...references].sort()) {
      const bytes = await readAsset(bundleRoot, reference, testHooks);
      const existing = assets.get(reference);
      if (existing && !existing.equals(bytes)) {
        throw new Error(`conflicting bytes for destination ${reference}`);
      }
      if (!existing) assets.set(reference, bytes);
    }
  }
  return assets;
}

export async function preparePublicAssets({
  talksDirectory = path.resolve("content/talks"),
  publicDirectory = path.resolve("public"),
  threatModel = supportedThreatModel,
  testHooks = {},
} = {}) {
  assertSecurePlatform();
  if (threatModel !== supportedThreatModel) {
    throw new Error("hostile same-uid processes are outside the supported threat model");
  }
  let talksChain;
  let publicChain;
  let workspaceChain;
  let snapshots = [];
  let workspaceRemoved = false;
  let operationFailed = false;

  try {
    talksChain = await captureProtectedChain(talksDirectory, "Talks root");
    publicChain = await captureProtectedChain(publicDirectory, "public root");
    const publicParent = publicParentFromChain(publicChain);
    const assets = await collectPublishedAssets(talksChain, testHooks);
    for (const name of generatedDirectories) {
      snapshots.push(await captureOptionalGeneratedDirectory(publicChain.leaf, name));
    }
    workspaceChain = await createPrivateWorkspace(publicChain, publicParent);
    const staging = await createStagingTree(workspaceChain, assets);
    await publishStagedDirectories({ publicChain, workspaceChain, staging, snapshots, testHooks });
    await cleanupWorkspace(workspaceChain, publicChain, testHooks, true);
    workspaceRemoved = true;
    return { copied: [...assets.keys()].sort() };
  } catch (error) {
    operationFailed = true;
    if (workspaceChain && publicChain && !workspaceRemoved && !(error instanceof AssetRecoveryError)) {
      try {
        await cleanupWorkspace(workspaceChain, publicChain, testHooks, false);
      } catch {
        // The workspace path no longer names the private directory. Refuse any
        // pathname-based recursive cleanup and leave recovery to its owner.
      }
    }
    throw error;
  } finally {
    const handles = [
      ...snapshots.map((snapshot) => snapshot.captured?.handle),
      ...workspaceChain?.captures.map((capture) => capture.handle) ?? [],
      ...publicChain?.captures.map((capture) => capture.handle) ?? [],
      ...talksChain?.captures.map((capture) => capture.handle) ?? [],
    ];
    const closeErrors = await closeHandles(handles);
    if (!operationFailed && closeErrors.length > 0) {
      throw new AggregateError(closeErrors, "Failed to close one or more verified filesystem handles");
    }
  }
}

async function main() {
  await preparePublicAssets();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
