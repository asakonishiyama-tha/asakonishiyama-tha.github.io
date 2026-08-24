import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const approvedRoutes = [
  "/",
  "/talks/ai-president-intro/",
  "/talks/ai-president-intro/quest/",
  "/talks/ai-president-intro/result/",
  "/talks/ai-president-intro/handout/",
  "/talks/long-lived-companies/",
  "/talks/long-lived-companies/quest/",
  "/talks/long-lived-companies/result/",
  "/talks/long-lived-companies/handout/",
];

const approvedPdfs = [
  "/downloads/ai-philosophy-for-smb.pdf",
  "/downloads/tha-ai-management-action-sheet.pdf",
  "/downloads/long-lived-companies-experiment.pdf",
  "/downloads/long-lived-companies-explore.pdf",
  "/downloads/long-lived-companies-handout.pdf",
  "/downloads/long-lived-companies-integrate.pdf",
  "/downloads/long-lived-companies-systemize.pdf",
  "/downloads/long-lived-companies-talk.pdf",
];

const approvedHtmlArtifacts = new Set([
  "index.html",
  "talks/ai-president-intro/index.html",
  "talks/ai-president-intro/quest/index.html",
  "talks/ai-president-intro/result/index.html",
  "talks/ai-president-intro/handout/index.html",
  "talks/long-lived-companies/index.html",
  "talks/long-lived-companies/quest/index.html",
  "talks/long-lived-companies/result/index.html",
  "talks/long-lived-companies/handout/index.html",
]);
const requiredFrameworkRouteArtifacts = [
  "index.txt",
  "talks/ai-president-intro/index.txt",
  "talks/ai-president-intro/quest/index.txt",
  "talks/ai-president-intro/result/index.txt",
  "talks/ai-president-intro/handout/index.txt",
  "talks/long-lived-companies/index.txt",
  "talks/long-lived-companies/quest/index.txt",
  "talks/long-lived-companies/result/index.txt",
  "talks/long-lived-companies/handout/index.txt",
];
const approvedFrameworkRouteArtifacts = new Set(requiredFrameworkRouteArtifacts);
const approvedPdfArtifacts = new Set(approvedPdfs.map((pdf) => pdf.slice(1)));
const approvedMediaArtifacts = new Set([
  "media/long-lived-companies-hero.webp",
  "media/long-lived-companies-time-assets.webp",
]);
const exactInfrastructureArtifacts = new Set([".gitkeep"]);

const requiredFrameworkErrorDocuments = [];
const frameworkErrorDocuments = new Set(["404.html", "404/index.html"]);
const forbiddenSegments = new Set(["api", "admin", "live", "presenter"]);
const secretRules = [
  ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ["slack-webhook", /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9_-]{8,}\/[A-Za-z0-9_-]{8,}\/[A-Za-z0-9_-]{16,}/],
  ["google-api-key", /AIza[0-9A-Za-z_-]{35}/],
  ["github-token", /(?:github_pat_[0-9A-Za-z_]{20,}|gh[pousr]_[0-9A-Za-z]{30,})/],
  ["openai-api-key", /sk-[A-Za-z0-9_-]{32,}/],
  ["aws-access-key", /(?:AKIA|ASIA)[0-9A-Z]{16}/],
];

function toPortablePath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function browserPathFromHtml(relativePath) {
  if (!relativePath.toLowerCase().endsWith(".html")) return null;
  if (relativePath === "index.html") return "/";
  if (relativePath.endsWith("/index.html")) {
    return `/${relativePath.slice(0, -"index.html".length)}`;
  }
  return `/${relativePath}`;
}

function formatSetDifference(actual, expected) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const unexpected = actual.filter((item) => !expectedSet.has(item));
  const missing = expected.filter((item) => !actualSet.has(item));
  return [
    ...unexpected.map((item) => `approved-set: unexpected ${item}`),
    ...missing.map((item) => `approved-set: missing ${item}`),
  ];
}

async function collectArtifacts(rootDirectory) {
  const files = [];
  const findings = [];

  async function visit(relativeDirectory) {
    const directory = path.join(rootDirectory, relativeDirectory);
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const relativePath = toPortablePath(path.join(relativeDirectory, entry.name));
      const absolutePath = path.join(rootDirectory, relativePath);
      const status = await lstat(absolutePath);
      const segments = relativePath.toLowerCase().split("/");

      for (const segment of segments) {
        const browserName = segment.endsWith(".html") ? segment.slice(0, -".html".length) : segment;
        if (forbiddenSegments.has(browserName)) findings.push(`forbidden-path:${browserName}: ${relativePath}`);
      }
      if (status.isSymbolicLink()) {
        findings.push(`symlink: ${relativePath}`);
        continue;
      }
      if (status.isDirectory()) {
        await visit(relativePath);
        continue;
      }
      if (!status.isFile()) {
        findings.push(`unsupported-file-type: ${relativePath}`);
        continue;
      }
      files.push(relativePath);
    }
  }

  await visit("");
  return { files, findings };
}

function extractLocalReferences(html) {
  const references = [];
  for (const match of html.matchAll(/\b(?:href|src|poster)\s*=\s*["']([^"']+)["']/gi)) {
    references.push(match[1]);
  }
  for (const match of html.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)) {
    for (const candidate of match[1].split(",")) {
      const reference = candidate.trim().split(/\s+/, 1)[0];
      if (reference) references.push(reference);
    }
  }
  return references;
}

function localReferencePath(reference, sourceRoute) {
  const trimmed = reference.trim().replaceAll("&amp;", "&");
  if (!trimmed || trimmed.startsWith("#")) return null;
  if (/^(?:data|mailto|tel|javascript):/i.test(trimmed) || trimmed.startsWith("//")) return null;

  let parsed;
  try {
    parsed = new URL(trimmed, `https://static-export.invalid${sourceRoute}`);
  } catch {
    return "__INVALID__";
  }
  if (parsed.origin !== "https://static-export.invalid") return null;

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(parsed.pathname);
  } catch {
    return "__INVALID__";
  }
  if (decodedPath.includes("\0") || decodedPath.includes("\\")) return "__INVALID__";
  const segments = decodedPath.split("/");
  if (segments.includes("..")) return "__INVALID__";
  return decodedPath;
}

function referenceExists(pathname, fileSet) {
  if (pathname === "/") return fileSet.has("index.html");
  const relativePath = pathname.replace(/^\/+/, "");
  if (!relativePath) return fileSet.has("index.html");
  if (pathname.endsWith("/")) return fileSet.has(`${relativePath}index.html`);
  return fileSet.has(relativePath)
    || fileSet.has(`${relativePath}/index.html`)
    || fileSet.has(`${relativePath}.html`);
}

function sourceRouteForHtml(relativePath) {
  const route = browserPathFromHtml(relativePath);
  if (route) return route;
  const directory = path.posix.dirname(`/${relativePath}`);
  return directory.endsWith("/") ? directory : `${directory}/`;
}

function uniqueSorted(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function hasSafeFrameworkSegments(relativePath) {
  return relativePath.split("/").every((segment) => /^[A-Za-z0-9._@()\[\]_-]+$/.test(segment));
}

function isApprovedNextStaticArtifact(relativePath) {
  const prefix = "_next/static/";
  if (!relativePath.startsWith(prefix)) return false;
  const frameworkPath = relativePath.slice(prefix.length);
  if (!hasSafeFrameworkSegments(frameworkPath)) return false;

  const segments = frameworkPath.split("/");
  if (segments.length === 2
    && ["_buildManifest.js", "_ssgManifest.js"].includes(segments[1])) {
    return true;
  }
  if (segments[0] === "chunks" && segments.length >= 2) {
    return segments.at(-1).endsWith(".js");
  }
  if (segments[0] === "css" && segments.length === 2) {
    return segments[1].endsWith(".css");
  }
  return false;
}

function isApprovedArtifact(relativePath) {
  return approvedHtmlArtifacts.has(relativePath)
    || approvedFrameworkRouteArtifacts.has(relativePath)
    || approvedPdfArtifacts.has(relativePath)
    || approvedMediaArtifacts.has(relativePath)
    || exactInfrastructureArtifacts.has(relativePath)
    || isApprovedNextStaticArtifact(relativePath);
}

export async function verifyStaticExport(outDirectory) {
  const rootDirectory = path.resolve(outDirectory);
  const rootStatus = await lstat(rootDirectory);
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    throw new Error("Static export verification failed:\nroot-directory: expected a real directory");
  }

  const { files, findings } = await collectArtifacts(rootDirectory);
  const fileSet = new Set(files);
  const observedRoutes = files
    .filter((file) => file.toLowerCase().endsWith(".html") && !frameworkErrorDocuments.has(file))
    .map(browserPathFromHtml)
    .filter(Boolean);
  const observedPdfs = files.filter((file) => file.toLowerCase().endsWith(".pdf")).map((file) => `/${file}`);
  const observedFrameworkErrorDocuments = requiredFrameworkErrorDocuments
    .filter((relativePath) => fileSet.has(relativePath));
  const observedFrameworkRouteArtifacts = requiredFrameworkRouteArtifacts
    .filter((relativePath) => fileSet.has(relativePath));

  const routeDifferences = formatSetDifference(observedRoutes, approvedRoutes);
  findings.push(...routeDifferences.map((finding) => finding.replace("approved-set", "approved-route-set")));
  const pdfDifferences = formatSetDifference(observedPdfs, approvedPdfs);
  findings.push(...pdfDifferences.map((finding) => finding.replace("approved-set", "approved-pdf-set")));
  const frameworkErrorDifferences = formatSetDifference(
    observedFrameworkErrorDocuments,
    requiredFrameworkErrorDocuments,
  );
  findings.push(...frameworkErrorDifferences.map((finding) => (
    finding.replace("approved-set", "required-framework-error-set")
  )));
  const frameworkRouteArtifactDifferences = formatSetDifference(
    observedFrameworkRouteArtifacts,
    requiredFrameworkRouteArtifacts,
  );
  findings.push(...frameworkRouteArtifactDifferences.map((finding) => (
    finding.replace("approved-set", "required-framework-route-artifact-set")
  )));

  for (const relativePath of files) {
    if (!isApprovedArtifact(relativePath)) findings.push(`unsupported-artifact: ${relativePath}`);
    const contents = await readFile(path.join(rootDirectory, relativePath));
    const searchableContents = contents.toString("utf8");
    for (const [rule, pattern] of secretRules) {
      if (pattern.test(searchableContents)) findings.push(`secret:${rule}: ${relativePath}`);
    }

    if (!relativePath.toLowerCase().endsWith(".html")) continue;
    const sourceRoute = sourceRouteForHtml(relativePath);
    for (const reference of extractLocalReferences(searchableContents)) {
      const pathname = localReferencePath(reference, sourceRoute);
      if (pathname === null) continue;
      if (pathname === "__INVALID__" || !referenceExists(pathname, fileSet)) {
        findings.push(`broken-local-link: ${relativePath}`);
      }
    }
  }

  const forbiddenArtifacts = uniqueSorted(findings);
  if (forbiddenArtifacts.length > 0) {
    throw new Error(`Static export verification failed:\n${forbiddenArtifacts.join("\n")}`);
  }

  return {
    routes: approvedRoutes.filter((route) => observedRoutes.includes(route)),
    forbiddenArtifacts,
    pdfs: approvedPdfs.filter((pdf) => observedPdfs.includes(pdf)),
    frameworkErrorDocuments: observedFrameworkErrorDocuments,
    frameworkRouteArtifacts: observedFrameworkRouteArtifacts,
  };
}

async function runCli() {
  const outDirectory = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve("out");
  try {
    const report = await verifyStaticExport(outDirectory);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Static export verification failed."}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await runCli();
}
