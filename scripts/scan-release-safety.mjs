import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const modulePath = fileURLToPath(import.meta.url);
const rulesPath = path.resolve(path.dirname(modulePath), "../release/secret-rules.json");
const secureDirectoryFlags = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const secureReadFlags = constants.O_RDONLY | constants.O_NOFOLLOW;
const maximumRulesFileBytes = 1024 * 1024;
const maximumApprovedBinaryBytes = 64 * 1024 * 1024;
const fixedMaximumTextFileBytes = 5 * 1024 * 1024;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const binaryExtensions = new Set([
  ".7z", ".avi", ".avif", ".bin", ".bmp", ".class", ".db", ".dmg", ".doc", ".docx",
  ".eot", ".exe", ".gif", ".gz", ".ico", ".jar", ".jpeg", ".jpg", ".mov",
  ".mp3", ".mp4", ".ogg", ".otf", ".pdf", ".png", ".ppt", ".pptx", ".rar",
  ".sqlite", ".tar", ".tif", ".tiff", ".ttf", ".wav", ".webm", ".webp",
  ".woff", ".woff2", ".xls", ".xlsx", ".zip",
]);
const expectedExampleEmailDomains = [
  "business.example",
  "corp.example",
  "e2e-company.example",
  "example.com",
  "example.net",
  "example.org",
];
const expectedApprovedPdfPairs = new Set([
  "content/talks/ai-president-intro/assets/downloads/ai-philosophy-for-smb.pdf\0downloads/ai-philosophy-for-smb.pdf",
  "content/talks/ai-president-intro/assets/downloads/tha-ai-management-action-sheet.pdf\0downloads/tha-ai-management-action-sheet.pdf",
  "content/talks/long-lived-companies/assets/downloads/long-lived-companies-experiment.pdf\0downloads/long-lived-companies-experiment.pdf",
  "content/talks/long-lived-companies/assets/downloads/long-lived-companies-explore.pdf\0downloads/long-lived-companies-explore.pdf",
  "content/talks/long-lived-companies/assets/downloads/long-lived-companies-handout.pdf\0downloads/long-lived-companies-handout.pdf",
  "content/talks/long-lived-companies/assets/downloads/long-lived-companies-integrate.pdf\0downloads/long-lived-companies-integrate.pdf",
  "content/talks/long-lived-companies/assets/downloads/long-lived-companies-systemize.pdf\0downloads/long-lived-companies-systemize.pdf",
  "content/talks/long-lived-companies/assets/downloads/long-lived-companies-talk.pdf\0downloads/long-lived-companies-talk.pdf",
]);
const expectedApprovedImagePairs = new Set([
  "content/talks/long-lived-companies/assets/media/long-lived-companies-hero.webp\0media/long-lived-companies-hero.webp",
  "content/talks/long-lived-companies/assets/media/long-lived-companies-time-assets.webp\0media/long-lived-companies-time-assets.webp",
]);
const expectedRuleIds = new Set([
  "aws-access-key",
  "email-address",
  "fake-control-route",
  "fake-control-token",
  "forbidden-admin-route",
  "forbidden-api-route",
  "forbidden-live-route",
  "forbidden-presenter-route",
  "github-token",
  "google-api-key",
  "google-credential-assignment",
  "google-credential-field",
  "google-service-account",
  "known-pii-fixture",
  "loopback-gas-url",
  "openai-api-key",
  "private-key",
  "sheet-id-assignment",
  "slack-webhook",
  "tina-token",
]);
const forbiddenPathSegments = new Map([
  ["admin", "forbidden-admin-route"],
  ["api", "forbidden-api-route"],
  ["live", "forbidden-live-route"],
  ["presenter", "forbidden-presenter-route"],
]);
const unsafeReportingPathPrefix = "@unsafe-path-sha256/";

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isNotFoundError(error) {
  return error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT";
}

function sameSnapshot(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.uid === right.uid
    && left.gid === right.gid
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

async function closeHandle(handle, errorMessage) {
  try {
    await handle.close();
  } catch {
    throw new Error(errorMessage);
  }
}

function assertSecurePlatform() {
  if (process.platform === "win32"
    || typeof constants.O_NOFOLLOW !== "number"
    || typeof constants.O_DIRECTORY !== "number") {
    throw new Error("Release safety scan requires POSIX O_NOFOLLOW and O_DIRECTORY support.");
  }
}

function isPlainRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, expected, label) {
  if (!isPlainRecord(value)) throw new Error(`Release safety configuration schema is invalid (${label}).`);
  const actualKeys = Object.keys(value).sort(compareText);
  const expectedKeys = [...expected].sort(compareText);
  if (actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error(`Release safety configuration schema is invalid (${label}).`);
  }
}

function assertPolicyPath(relativePath, label) {
  if (typeof relativePath !== "string" || relativePath.length === 0
    || !/^[\x20-\x7e]+$/.test(relativePath)
    || relativePath.includes("\\")
    || relativePath.normalize("NFC") !== relativePath
    || path.posix.isAbsolute(relativePath)
    || path.win32.isAbsolute(relativePath)
    || path.posix.normalize(relativePath) !== relativePath
    || relativePath.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error(`Release safety configuration schema is invalid (${label}).`);
  }
}

function detectDuplicateObjectKeys(source) {
  let index = 0;

  function skipWhitespace() {
    while (/\s/.test(source[index] ?? "")) index += 1;
  }

  function parseString() {
    const start = index;
    index += 1;
    while (index < source.length) {
      if (source[index] === "\\") {
        index += 2;
        continue;
      }
      if (source[index] === "\"") {
        index += 1;
        return JSON.parse(source.slice(start, index));
      }
      index += 1;
    }
    throw new Error("Release safety configuration is invalid JSON.");
  }

  function parseArray() {
    index += 1;
    skipWhitespace();
    if (source[index] === "]") {
      index += 1;
      return;
    }
    while (index < source.length) {
      parseValue();
      skipWhitespace();
      if (source[index] === "]") {
        index += 1;
        return;
      }
      index += 1;
      skipWhitespace();
    }
  }

  function parseObject() {
    index += 1;
    const keys = new Set();
    skipWhitespace();
    if (source[index] === "}") {
      index += 1;
      return;
    }
    while (index < source.length) {
      const key = parseString();
      if (keys.has(key)) throw new Error("Release safety configuration contains a duplicate object key.");
      keys.add(key);
      skipWhitespace();
      index += 1;
      skipWhitespace();
      parseValue();
      skipWhitespace();
      if (source[index] === "}") {
        index += 1;
        return;
      }
      index += 1;
      skipWhitespace();
    }
  }

  function parseValue() {
    skipWhitespace();
    if (source[index] === "{") {
      parseObject();
      return;
    }
    if (source[index] === "[") {
      parseArray();
      return;
    }
    if (source[index] === "\"") {
      parseString();
      return;
    }
    while (index < source.length && !/[\s,}\]]/.test(source[index])) index += 1;
  }

  parseValue();
}

function parseStrictJson(source) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error("Release safety configuration is invalid JSON.");
  }
  detectDuplicateObjectKeys(source);
  return parsed;
}

function registerAllowancePath(registry, relativePath) {
  assertPolicyPath(relativePath, "allowance path");
  const key = relativePath.toLowerCase();
  const existing = registry.get(key);
  if (existing && existing !== relativePath) {
    throw new Error("Release safety configuration contains an allowance path collision.");
  }
  registry.set(key, relativePath);
}

function validateApprovedBinaries(entries, expectedPairs, extension, label, approvedBinaries) {
  if (!Array.isArray(entries) || entries.length !== expectedPairs.size) {
    throw new Error(`Release safety configuration schema is invalid (${label}s).`);
  }
  const observedPairs = new Set();
  for (const entry of entries) {
    assertExactKeys(entry, ["sourcePath", "outputPath", "sha256"], label);
    assertPolicyPath(entry.sourcePath, `${label} source path`);
    assertPolicyPath(entry.outputPath, `${label} output path`);
    if (!entry.sourcePath.endsWith(extension) || !entry.outputPath.endsWith(extension)
      || path.posix.basename(entry.sourcePath) !== path.posix.basename(entry.outputPath)
      || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
      throw new Error(`Release safety configuration schema is invalid (${label} entry).`);
    }
    const pair = `${entry.sourcePath}\0${entry.outputPath}`;
    if (!expectedPairs.has(pair) || observedPairs.has(pair)) {
      throw new Error(`Release safety configuration schema is invalid (${label} scope).`);
    }
    observedPairs.add(pair);
    for (const relativePath of [entry.sourcePath, entry.outputPath]) {
      const key = relativePath.toLowerCase();
      if (approvedBinaries.has(key)) {
        throw new Error("Release safety configuration contains an approved binary path collision.");
      }
      approvedBinaries.set(key, { path: relativePath, sha256: entry.sha256 });
    }
  }
}

function validateRulesConfig(rawRules) {
  const parsed = parseStrictJson(rawRules);
  assertExactKeys(parsed, ["version", "maxTextFileBytes", "exampleEmailDomains", "approvedPdfs", "approvedImages", "rules"], "root");
  if (parsed.version !== 1 || parsed.maxTextFileBytes !== fixedMaximumTextFileBytes) {
    throw new Error("Release safety configuration schema is invalid (fixed limits).");
  }

  if (!Array.isArray(parsed.exampleEmailDomains)
    || parsed.exampleEmailDomains.length !== expectedExampleEmailDomains.length
    || parsed.exampleEmailDomains.some((domain, index) => domain !== expectedExampleEmailDomains[index])) {
    throw new Error("Release safety configuration schema is invalid (example email domains).");
  }

  const approvedBinaries = new Map();
  validateApprovedBinaries(parsed.approvedPdfs, expectedApprovedPdfPairs, ".pdf", "approved PDF", approvedBinaries);
  validateApprovedBinaries(parsed.approvedImages, expectedApprovedImagePairs, ".webp", "approved image", approvedBinaries);

  if (!Array.isArray(parsed.rules)) {
    throw new Error("Release safety configuration schema is invalid (rule inventory).");
  }
  const observedRuleIds = new Set();
  const rules = [];
  for (const configuredRule of parsed.rules) {
    assertExactKeys(configuredRule, ["id", "pattern", "flags", "allowPaths", "allowances"], "rule");
    if (typeof configuredRule.id !== "string" || !/^[a-z][a-z0-9-]*$/.test(configuredRule.id)
      || !expectedRuleIds.has(configuredRule.id)) {
      throw new Error("Release safety configuration schema is invalid (rule id).");
    }
    if (observedRuleIds.has(configuredRule.id)) {
      throw new Error("Release safety configuration contains a duplicate rule id.");
    }
    observedRuleIds.add(configuredRule.id);
    if (typeof configuredRule.pattern !== "string" || configuredRule.pattern.length === 0
      || configuredRule.pattern.length > 2048 || typeof configuredRule.flags !== "string"
      || !/^[imsu]*$/.test(configuredRule.flags)
      || [...new Set(configuredRule.flags)].sort(compareText).join("") !== configuredRule.flags) {
      throw new Error("Release safety configuration schema is invalid (rule expression).");
    }
    let expression;
    try {
      expression = new RegExp(configuredRule.pattern, `g${configuredRule.flags}`);
    } catch {
      throw new Error("Release safety configuration contains an invalid rule expression.");
    }
    expression.lastIndex = 0;
    if (expression.test("")) throw new Error("Release safety configuration contains an empty-match rule.");
    expression.lastIndex = 0;

    if (!Array.isArray(configuredRule.allowPaths) || !Array.isArray(configuredRule.allowances)) {
      throw new Error("Release safety configuration schema is invalid (rule allowances).");
    }
    const pathRegistry = new Map();
    const allowPaths = new Set();
    for (const relativePath of configuredRule.allowPaths) {
      registerAllowancePath(pathRegistry, relativePath);
      if (allowPaths.has(relativePath)) throw new Error("Release safety configuration contains a duplicate allowance path.");
      allowPaths.add(relativePath);
    }
    const allowances = new Map();
    for (const allowance of configuredRule.allowances) {
      const allowanceKeys = isPlainRecord(allowance) ? Object.keys(allowance).sort(compareText) : [];
      const valueOnlyKeys = ["path", "valueSha256"];
      const wholeFileKeys = ["fileSha256", "path", "valueSha256"];
      const isValueOnly = allowanceKeys.length === valueOnlyKeys.length
        && allowanceKeys.every((key, index) => key === valueOnlyKeys[index]);
      const isWholeFileBound = allowanceKeys.length === wholeFileKeys.length
        && allowanceKeys.every((key, index) => key === wholeFileKeys[index]);
      if (!isValueOnly && !isWholeFileBound) {
        throw new Error("Release safety configuration schema is invalid (rule allowance).");
      }
      registerAllowancePath(pathRegistry, allowance.path);
      if (typeof allowance.valueSha256 !== "string" || !/^[a-f0-9]{64}$/.test(allowance.valueSha256)) {
        throw new Error("Release safety configuration schema is invalid (allowance hash).");
      }
      if (isWholeFileBound
        && (typeof allowance.fileSha256 !== "string" || !/^[a-f0-9]{64}$/.test(allowance.fileSha256))) {
        throw new Error("Release safety configuration schema is invalid (allowance file hash).");
      }
      if (allowPaths.has(allowance.path)) {
        throw new Error("Release safety configuration contains an allowance scope overlap.");
      }
      const entries = allowances.get(allowance.path) ?? [];
      const fileSha256 = isWholeFileBound ? allowance.fileSha256 : null;
      if (entries.some((entry) => entry.valueSha256 === allowance.valueSha256
        && (entry.fileSha256 === null || fileSha256 === null || entry.fileSha256 === fileSha256))) {
        throw new Error("Release safety configuration contains a duplicate value allowance.");
      }
      entries.push({ fileSha256, valueSha256: allowance.valueSha256 });
      allowances.set(allowance.path, entries);
    }
    rules.push({
      allowPaths,
      allowances,
      expression,
      id: configuredRule.id,
    });
  }
  if (observedRuleIds.size !== expectedRuleIds.size) {
    throw new Error("Release safety configuration schema is invalid (rule inventory).");
  }

  return {
    approvedBinaries,
    exampleEmailDomains: new Set(parsed.exampleEmailDomains),
    maxTextFileBytes: parsed.maxTextFileBytes,
    rules,
  };
}

async function readRulesConfig() {
  let before;
  try {
    before = await lstat(rulesPath, { bigint: true });
  } catch {
    throw new Error("Release safety configuration could not be read.");
  }
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n
    || before.size <= 0n || before.size > BigInt(maximumRulesFileBytes)) {
    throw new Error("Release safety configuration must be a bounded regular file.");
  }
  let resolved;
  try {
    resolved = await realpath(rulesPath);
  } catch {
    throw new Error("Release safety configuration could not be resolved.");
  }
  if (resolved !== rulesPath) {
    throw new Error("Release safety configuration must have no symlinked ancestor.");
  }

  let handle;
  try {
    handle = await open(rulesPath, secureReadFlags);
  } catch {
    throw new Error("Release safety configuration could not be opened safely.");
  }
  try {
    const opened = await handle.stat({ bigint: true });
    if (!sameSnapshot(before, opened)) throw new Error("Release safety configuration identity changed.");
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) throw new Error("Release safety configuration changed during read.");
      offset += bytesRead;
    }
    const after = await handle.stat({ bigint: true });
    const current = await lstat(rulesPath, { bigint: true });
    if (!sameSnapshot(opened, after) || current.isSymbolicLink() || !sameSnapshot(opened, current)) {
      throw new Error("Release safety configuration identity changed during read.");
    }
    let source;
    try {
      source = utf8Decoder.decode(bytes);
    } catch {
      throw new Error("Release safety configuration must be UTF-8 text.");
    }
    return validateRulesConfig(source);
  } finally {
    await closeHandle(handle, "Release safety configuration could not be closed safely.");
  }
}

async function captureDirectory(directoryPath, label, initialSnapshot) {
  let before = initialSnapshot;
  if (!before) {
    try {
      before = await lstat(directoryPath, { bigint: true });
    } catch {
      throw new Error(`${label} could not be inspected safely.`);
    }
  }
  if (before.isSymbolicLink() || !before.isDirectory()) {
    throw new Error(`${label} must be a real directory.`);
  }
  let handle;
  try {
    handle = await open(directoryPath, secureDirectoryFlags);
  } catch {
    throw new Error(`${label} could not be opened safely.`);
  }
  let opened;
  let resolved;
  let after;
  try {
    opened = await handle.stat({ bigint: true });
    resolved = await realpath(directoryPath);
    after = await lstat(directoryPath, { bigint: true });
  } catch {
    await closeHandle(handle, `${label} could not be closed safely.`);
    throw new Error(`${label} could not be inspected safely.`);
  }
  if (!sameSnapshot(before, opened) || resolved !== directoryPath
    || after.isSymbolicLink() || !sameSnapshot(opened, after)) {
    await closeHandle(handle, `${label} could not be closed safely.`);
    throw new Error(`${label} must equal its canonical realpath; symlinked ancestor not allowed.`);
  }
  return { handle, path: directoryPath, snapshot: opened };
}

async function captureRoot(root) {
  if (typeof root !== "string" || !path.isAbsolute(root) || path.resolve(root) !== root) {
    throw new Error("Release safety scan requires a canonical absolute root.");
  }
  let metadata;
  try {
    metadata = await lstat(root, { bigint: true });
  } catch (error) {
    if (isNotFoundError(error)) throw new Error("Release safety scan root is missing.");
    throw new Error("Release safety scan root could not be inspected.");
  }
  return captureDirectory(root, "Release safety scan root", metadata);
}

async function revalidateDirectory(captured, label) {
  let opened;
  try {
    opened = await captured.handle.stat({ bigint: true });
  } catch {
    throw new Error(`${label} identity changed during scan.`);
  }
  let current;
  try {
    current = await lstat(captured.path, { bigint: true });
  } catch {
    throw new Error(`${label} identity changed during scan.`);
  }
  if (current.isSymbolicLink() || !sameSnapshot(captured.snapshot, opened)
    || !sameSnapshot(opened, current)) {
    throw new Error(`${label} identity changed during scan.`);
  }
}

function findingCollector() {
  const findings = new Map();
  return {
    add(file, rule) {
      findings.set(`${file}\0${rule}`, { file, rule });
    },
    values() {
      return [...findings.entries()]
        .sort(([left], [right]) => compareText(left, right))
        .map(([, finding]) => finding);
    },
  };
}

function registerScannedPath(context, relativePath, reportPath) {
  const collisionKey = relativePath.toLowerCase();
  const existing = context.pathRegistry.get(collisionKey);
  if (!existing) {
    context.pathRegistry.set(collisionKey, { relativePath, reportPath });
    return false;
  }
  if (existing.relativePath !== relativePath) {
    context.findings.add(existing.reportPath, "path-case-collision");
    context.findings.add(reportPath, "path-case-collision");
    return true;
  }
  return false;
}

function configuredPathRuleIds(config, relativePath) {
  const ruleIds = new Set();
  for (const rule of config.rules) {
    rule.expression.lastIndex = 0;
    let match;
    while ((match = rule.expression.exec(relativePath)) !== null) {
      if (rule.id !== "email-address" || !isExampleEmail(match[0], config.exampleEmailDomains)) {
        ruleIds.add(rule.id);
        break;
      }
    }
    rule.expression.lastIndex = 0;
  }
  return ruleIds;
}

function inspectPortablePath(context, relativePath) {
  const ruleIds = configuredPathRuleIds(context.config, relativePath);
  const hasBackslashAmbiguity = relativePath.includes("\\");
  const hasUnicodeAmbiguity = !/^[\x20-\x7e]+$/.test(relativePath)
    || relativePath.normalize("NFC") !== relativePath;
  const lowerPath = relativePath.toLowerCase();
  for (const segment of lowerPath.split("/")) {
    const rule = forbiddenPathSegments.get(segment);
    if (rule) ruleIds.add(rule);
  }
  if (lowerPath.includes("_fake-gas-control")) ruleIds.add("fake-control-route");

  const mustEncode = hasBackslashAmbiguity
    || hasUnicodeAmbiguity
    || ruleIds.size > 0
    || relativePath.startsWith(unsafeReportingPathPrefix);
  const reportPath = mustEncode
    ? `${unsafeReportingPathPrefix}${createHash("sha256").update(relativePath, "utf8").digest("hex")}`
    : relativePath;
  if (hasBackslashAmbiguity) ruleIds.add("path-backslash-ambiguity");
  if (hasUnicodeAmbiguity) ruleIds.add("path-unicode-ambiguity");
  for (const rule of ruleIds) context.findings.add(reportPath, rule);
  return reportPath;
}

async function openVerifiedFile(record) {
  let handle;
  try {
    handle = await open(record.path, secureReadFlags);
  } catch {
    throw new Error(`Release safety scan file could not be opened safely: ${record.reportPath}`);
  }
  let opened;
  try {
    opened = await handle.stat({ bigint: true });
  } catch {
    await closeHandle(handle, `Release safety scan file could not be closed safely: ${record.reportPath}`);
    throw new Error(`Release safety scan file could not be inspected safely: ${record.reportPath}`);
  }
  if (!opened.isFile() || !sameSnapshot(record.snapshot, opened)) {
    await closeHandle(handle, `Release safety scan file could not be closed safely: ${record.reportPath}`);
    throw new Error(`Release safety scan file identity changed: ${record.reportPath}`);
  }
  return { handle, snapshot: opened };
}

async function revalidateFile(record, handleSnapshot, handle) {
  let opened;
  try {
    opened = await handle.stat({ bigint: true });
  } catch {
    throw new Error(`Release safety scan file identity changed: ${record.reportPath}`);
  }
  let current;
  try {
    current = await lstat(record.path, { bigint: true });
  } catch {
    throw new Error(`Release safety scan file identity changed: ${record.reportPath}`);
  }
  if (current.isSymbolicLink() || !sameSnapshot(handleSnapshot, opened)
    || !sameSnapshot(opened, current)) {
    throw new Error(`Release safety scan file identity changed: ${record.reportPath}`);
  }
}

async function readBoundedText(record, maximumBytes) {
  if (record.snapshot.size > BigInt(maximumBytes)) return { kind: "too-large" };
  const { handle, snapshot } = await openVerifiedFile(record);
  try {
    const bytes = Buffer.alloc(Number(snapshot.size));
    let offset = 0;
    while (offset < bytes.length) {
      let bytesRead;
      try {
        ({ bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset));
      } catch {
        throw new Error(`Release safety scan file could not be read safely: ${record.reportPath}`);
      }
      if (bytesRead === 0) throw new Error(`Release safety scan file changed during read: ${record.reportPath}`);
      offset += bytesRead;
    }
    await revalidateFile(record, snapshot, handle);
    if (bytes.includes(0)) return { kind: "binary" };
    try {
      return {
        kind: "text",
        fileSha256: createHash("sha256").update(bytes).digest("hex"),
        text: utf8Decoder.decode(bytes),
      };
    } catch {
      return { kind: "binary" };
    }
  } finally {
    await closeHandle(handle, `Release safety scan file could not be closed safely: ${record.reportPath}`);
  }
}

async function hashApprovedBinary(record) {
  if (record.snapshot.size > BigInt(maximumApprovedBinaryBytes)) return null;
  const { handle, snapshot } = await openVerifiedFile(record);
  try {
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(64 * 1024);
    let position = 0;
    const size = Number(snapshot.size);
    while (position < size) {
      const requested = Math.min(buffer.length, size - position);
      let bytesRead;
      try {
        ({ bytesRead } = await handle.read(buffer, 0, requested, position));
      } catch {
        throw new Error(`Release safety scan file could not be read safely: ${record.reportPath}`);
      }
      if (bytesRead === 0) throw new Error(`Release safety scan file changed during read: ${record.reportPath}`);
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    await revalidateFile(record, snapshot, handle);
    return hash.digest("hex");
  } finally {
    await closeHandle(handle, `Release safety scan file could not be closed safely: ${record.reportPath}`);
  }
}

function isExampleEmail(value, domains) {
  const separator = value.lastIndexOf("@");
  if (separator < 0) return false;
  const domain = value.slice(separator + 1).replaceAll("\\.", ".").toLowerCase();
  return domains.has(domain);
}

function isAllowedMatch(rule, relativePath, matchedValue, fileSha256, context) {
  if (rule.allowPaths.has(relativePath)) return true;
  if (rule.id === "email-address" && isExampleEmail(matchedValue, context.config.exampleEmailDomains)) {
    return true;
  }
  const allowances = rule.allowances.get(relativePath);
  if (!allowances) return false;
  const valueHash = createHash("sha256").update(matchedValue, "utf8").digest("hex");
  return allowances.some((allowance) => allowance.valueSha256 === valueHash
    && (allowance.fileSha256 === null || allowance.fileSha256 === fileSha256));
}

function scanText(context, relativePath, reportPath, text, fileSha256) {
  for (const rule of context.config.rules) {
    rule.expression.lastIndex = 0;
    let match;
    while ((match = rule.expression.exec(text)) !== null) {
      if (!isAllowedMatch(rule, relativePath, match[0], fileSha256, context)) {
        context.findings.add(reportPath, rule.id);
        break;
      }
    }
    rule.expression.lastIndex = 0;
  }
}

async function inspectRegularFile(context, relativePath, reportPath, absolutePath, snapshot) {
  const record = {
    path: absolutePath,
    relativePath,
    reportPath,
    snapshot,
  };
  if (snapshot.nlink !== 1n) {
    context.findings.add(reportPath, "filesystem-hardlink");
    return;
  }
  const approvedBinary = context.config.approvedBinaries.get(relativePath.toLowerCase());
  if (approvedBinary && approvedBinary.path === relativePath) {
    const digest = await hashApprovedBinary(record);
    if (digest !== approvedBinary.sha256) context.findings.add(reportPath, "approved-binary-mismatch");
    return;
  }
  if (binaryExtensions.has(path.posix.extname(relativePath).toLowerCase())) {
    context.findings.add(reportPath, "unexpected-binary");
    return;
  }

  const contents = await readBoundedText(record, context.config.maxTextFileBytes);
  if (contents.kind === "too-large") {
    context.findings.add(reportPath, "text-file-too-large");
    return;
  }
  if (contents.kind === "binary") {
    context.findings.add(reportPath, "unexpected-binary");
    return;
  }
  scanText(context, relativePath, reportPath, contents.text, contents.fileSha256);
}

async function scanDirectory(context, capturedDirectory, relativeDirectory, label) {
  await revalidateDirectory(capturedDirectory, label);
  let entries;
  try {
    entries = await readdir(capturedDirectory.path, { withFileTypes: true });
  } catch {
    throw new Error(`${label} could not be read safely.`);
  }
  entries.sort((left, right) => compareText(left.name, right.name));
  for (const entry of entries) {
    await revalidateDirectory(capturedDirectory, label);
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    const reportPath = inspectPortablePath(context, relativePath);
    const absolutePath = path.join(capturedDirectory.path, entry.name);
    let metadata;
    try {
      metadata = await lstat(absolutePath, { bigint: true });
    } catch {
      throw new Error(`Release safety scan entry identity changed: ${reportPath}`);
    }
    const caseCollision = registerScannedPath(context, relativePath, reportPath);
    if (metadata.isSymbolicLink()) {
      context.findings.add(reportPath, "filesystem-symlink");
      continue;
    }
    if (caseCollision) continue;
    if (metadata.isDirectory()) {
      const nestedLabel = `Release safety scan directory ${reportPath}`;
      const nested = await captureDirectory(absolutePath, nestedLabel, metadata);
      try {
        await scanDirectory(context, nested, relativePath, nestedLabel);
      } finally {
        await closeHandle(nested.handle, `${nestedLabel} could not be closed safely.`);
      }
      continue;
    }
    if (!metadata.isFile()) {
      context.findings.add(reportPath, "filesystem-special");
      continue;
    }
    await inspectRegularFile(context, relativePath, reportPath, absolutePath, metadata);
  }
  await revalidateDirectory(capturedDirectory, label);
}

export async function scanReleaseSafety(root) {
  assertSecurePlatform();
  const config = await readRulesConfig();
  const rootCapture = await captureRoot(root);
  const findings = findingCollector();
  const context = {
    config,
    findings,
    pathRegistry: new Map(),
  };
  try {
    await scanDirectory(context, rootCapture, "", "Release safety scan root");
    return findings.values();
  } finally {
    await closeHandle(rootCapture.handle, "Release safety scan root could not be closed safely.");
  }
}

async function runCli() {
  if (process.argv.length !== 3) {
    process.stderr.write("Release safety scan failed: exactly one root directory is required.\n");
    process.exitCode = 1;
    return;
  }
  const root = path.resolve(process.argv[2]);
  try {
    const findings = await scanReleaseSafety(root);
    if (findings.length === 0) {
      process.stdout.write("0 findings\n");
      return;
    }
    process.stderr.write(`${findings.map(({ file, rule }) => `${file}\t${rule}`).join("\n")}\n`);
    process.exitCode = 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Release safety scan failed.";
    process.stderr.write(`Release safety scan failed: ${message}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) await runCli();
