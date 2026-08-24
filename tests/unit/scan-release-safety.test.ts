import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildPublicSource } from "../../scripts/build-public-source.mjs";
import { scanReleaseSafety } from "../../scripts/scan-release-safety.mjs";

const scannerPath = path.resolve(import.meta.dirname, "../../scripts/scan-release-safety.mjs");
const rulesPath = path.resolve(import.meta.dirname, "../../release/secret-rules.json");
const atSign = String.fromCharCode(64);
const slash = "/";
const maximumTextFileBytes = 5 * 1024 * 1024;
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function address(localPart: string, domain: string): string {
  return [localPart, domain].join(atSign);
}

function regexEscapedAddress(localPart: string, domainParts: string[]): string {
  return [localPart, domainParts.join("\\.")].join(atSign);
}

function route(segment: string): string {
  return [slash, segment, slash].join("");
}

function privateKey(): string {
  return ["-----BEGIN", " PRIVATE", " KEY-----"].join("");
}

function encryptedPrivateKey(): string {
  return ["-----BEGIN", " ENCRYPTED", " PRIVATE", " KEY-----"].join("");
}

function githubToken(fill = "A"): string {
  return ["gh", "p_", fill.repeat(36)].join("");
}

function slackWebhook(fill = "A"): string {
  return ["https:", "", "hooks.slack.com", "services", `T${fill.repeat(8)}`, `B${fill.repeat(8)}`, fill.repeat(24)].join("/");
}

function allowedSlackFixture(): string {
  return [
    "https:",
    "",
    "hooks.slack.com",
    "services",
    `T${"0".repeat(8)}`,
    `B${"0".repeat(8)}`,
    "abcdefghijklmnopqrstuvwx",
  ].join("/");
}

function googleApiKey(): string {
  return ["AI", "za", "A".repeat(35)].join("");
}

function openAiKey(): string {
  return ["s", `k-${"A".repeat(32)}`].join("");
}

function awsAccessKey(): string {
  return ["AK", `IA${"A".repeat(16)}`].join("");
}

function excludedDraft(): string {
  return ["long", "lived", "companies"].join("-");
}

function fakeControlRoute(): string {
  return ["", "_fake-gas-control", "v1"].join("/");
}

function fakeControlToken(): string {
  return ["tha", "task", "9", "loopback", "control"].join("-");
}

function loopbackGasUrl(host = "127.0.0.9", port = "4545"): string {
  return ["http:", "", `${host}:${port}`, "exec"].join("/");
}

function knownPiiMarker(): string {
  return ["PII", "FIXTURE", "CUSTOMER", "001"].join("_");
}

function multilineJsonProperty(key: string, value: string): string {
  return ["{", `  ${JSON.stringify(key)}`, "  :", `  ${JSON.stringify(value)}`, "}"].join("\n");
}

function sheetIdName(): string {
  return ["THA", "SHEET", "ID"].join("_");
}

async function createTemporaryRoot(prefix = "hooked-release-scan-"): Promise<string> {
  const canonicalTemporaryDirectory = await realpath(tmpdir());
  const root = await mkdtemp(path.join(canonicalTemporaryDirectory, prefix));
  temporaryRoots.push(root);
  return root;
}

async function createContainedScanRoot(): Promise<{ container: string; root: string }> {
  const container = await createTemporaryRoot();
  const root = path.join(container, "root");
  await mkdir(root);
  return { container, root };
}

async function writeFixture(
  root: string,
  relativePath: string,
  contents: string | Uint8Array = "safe text\n",
): Promise<void> {
  const filePath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function createIsolatedScanner(rawRules: string): Promise<string> {
  const moduleRoot = await createTemporaryRoot("hooked-release-scan-module-");
  const scriptsDirectory = path.join(moduleRoot, "scripts");
  const releaseDirectory = path.join(moduleRoot, "release");
  await Promise.all([mkdir(scriptsDirectory), mkdir(releaseDirectory)]);
  await Promise.all([
    copyFile(scannerPath, path.join(scriptsDirectory, "scan-release-safety.mjs")),
    writeFile(path.join(releaseDirectory, "secret-rules.json"), rawRules),
  ]);
  return path.join(scriptsDirectory, "scan-release-safety.mjs");
}

const contentRuleCases = [
  { rule: "private-key", value: privateKey() },
  { rule: "github-token", value: githubToken() },
  { rule: "slack-webhook", value: slackWebhook() },
  { rule: "google-api-key", value: googleApiKey() },
  {
    rule: "google-service-account",
    value: JSON.stringify({ [["ty", "pe"].join("")]: ["service", "account"].join("_") }),
  },
  {
    rule: "google-credential-field",
    value: JSON.stringify({ [["private", "key", "id"].join("_")]: "credential-value" }),
  },
  {
    rule: "google-credential-assignment",
    value: [["GOOGLE", "CLIENT", "SECRET"].join("_"), "credential-value"].join("="),
  },
  { rule: "tina-token", value: [["TINA", "TOKEN"].join("_"), "token-value-123456"].join("=") },
  { rule: "sheet-id-assignment", value: [["THA", "SHEET", "ID"].join("_"), "sheet-value-1234"].join("=") },
  { rule: "email-address", value: address("person", "outside.example.biz") },
  { rule: "excluded-draft", value: excludedDraft() },
  { rule: "forbidden-api-route", value: route("api") },
  { rule: "forbidden-admin-route", value: route("admin") },
  { rule: "forbidden-live-route", value: route("live") },
  { rule: "forbidden-presenter-route", value: route("presenter") },
  { rule: "fake-control-token", value: fakeControlToken() },
  { rule: "fake-control-route", value: fakeControlRoute() },
  { rule: "loopback-gas-url", value: loopbackGasUrl() },
  { rule: "known-pii-fixture", value: knownPiiMarker() },
  { rule: "openai-api-key", value: openAiKey() },
  { rule: "aws-access-key", value: awsAccessKey() },
] as const;

const credentialBypassCases = [
  { rule: "private-key", value: encryptedPrivateKey() },
  {
    rule: "google-service-account",
    value: multilineJsonProperty(["ty", "pe"].join(""), ["service", "account"].join("_")),
  },
  {
    rule: "google-credential-field",
    value: multilineJsonProperty(["client", "secret"].join("_"), "credential-value"),
  },
] as const;

const sheetAssignmentBypassCases = [
  `${JSON.stringify(sheetIdName())}: "sheet-value-json"`,
  `export ${sheetIdName()}="sheet-value-export"`,
  `const ${sheetIdName()} = "sheet-value-const"`,
  `process.env.${sheetIdName()} = "sheet-value-env"`,
] as const;

describe("release safety content rules", () => {
  it.each(contentRuleCases)("detects $rule without returning the matched value", async ({ rule, value }) => {
    const root = await createTemporaryRoot();
    await writeFixture(root, "unsafe.txt", `${value}\n`);

    const findings = await scanReleaseSafety(root);

    expect(findings).toEqual([{ file: "unsafe.txt", rule }]);
    expect(JSON.stringify(findings)).not.toContain(value);
  });

  it("allows only explicit reserved example email domains", async () => {
    const root = await createTemporaryRoot();
    await writeFixture(root, "examples.txt", [
      address("person", "example.com"),
      address("person", "example.net"),
      address("person", "example.org"),
      address("person", "corp.example"),
      address("person", "business.example"),
      address("person", "e2e-company.example"),
      regexEscapedAddress("person", ["example", "com"]),
    ].join("\n"));

    await expect(scanReleaseSafety(root)).resolves.toEqual([]);
  });

  it.each(credentialBypassCases)("detects bypass form for $rule", async ({ rule, value }) => {
    const root = await createTemporaryRoot();
    await writeFixture(root, "credential-bypass.txt", value);

    const findings = await scanReleaseSafety(root);

    expect(findings).toEqual([{ file: "credential-bypass.txt", rule }]);
    expect(JSON.stringify(findings)).not.toContain(value);
  });

  it.each(sheetAssignmentBypassCases)("detects a quoted/export/const/env Sheet-ID assignment", async (value) => {
    const root = await createTemporaryRoot();
    await writeFixture(root, "sheet-bypass.txt", value);

    const findings = await scanReleaseSafety(root);

    expect(findings).toEqual([{ file: "sheet-bypass.txt", rule: "sheet-id-assignment" }]);
    expect(JSON.stringify(findings)).not.toContain(value);
  });

  it("detects a real-looking email whose domain dots are regex-escaped", async () => {
    const value = regexEscapedAddress("person", [["tha", "inc"].join("-"), "com"]);
    const root = await createTemporaryRoot();
    await writeFixture(root, "unsafe-regex.txt", value);

    const findings = await scanReleaseSafety(root);

    expect(findings).toEqual([{ file: "unsafe-regex.txt", rule: "email-address" }]);
    expect(JSON.stringify(findings)).not.toContain(value);
  });

  it("binds a fixture allowance to both its exact path and exact matched-value hash", async () => {
    const allowedValue = allowedSlackFixture();
    const root = await createTemporaryRoot();
    await writeFixture(root, "tests/unit/verify-static-export.test.ts", allowedValue);

    await expect(scanReleaseSafety(root)).resolves.toEqual([]);

    await writeFixture(root, "tests/unit/verify-static-export.test.ts", slackWebhook("b"));
    await expect(scanReleaseSafety(root)).resolves.toEqual([
      { file: "tests/unit/verify-static-export.test.ts", rule: "slack-webhook" },
    ]);

    await writeFixture(root, "copied-fixture.txt", allowedValue);
    expect(await scanReleaseSafety(root)).toContainEqual({ file: "copied-fixture.txt", rule: "slack-webhook" });
  });

  it("can bind a generated-runtime allowance to the exact whole-file hash", async () => {
    const parsed = JSON.parse(await readFile(rulesPath, "utf8")) as {
      rules: Array<Record<string, unknown>>;
    } & Record<string, unknown>;
    const relativePath = "_next/static/chunks/framework-runtime.js";
    const matchedValue = route("api");
    const exactFile = `function frameworkRoute(value) { return value.startsWith(${JSON.stringify(matchedValue)}); }`;
    const configured = {
      ...parsed,
      rules: parsed.rules.map((rule) => rule.id === "forbidden-api-route"
        ? {
            ...rule,
            allowances: [
              ...((rule.allowances as Array<Record<string, unknown>>) ?? []),
              {
                path: relativePath,
                valueSha256: sha256(matchedValue),
                fileSha256: sha256(exactFile),
              },
            ],
          }
        : rule),
    };
    const isolatedPath = await createIsolatedScanner(`${JSON.stringify(configured, null, 2)}\n`);
    const root = await createTemporaryRoot();
    await writeFixture(root, relativePath, exactFile);

    const runIsolatedScanner = () => spawnSync(
      process.execPath,
      [isolatedPath, root],
      { encoding: "utf8" },
    );

    const exactResult = runIsolatedScanner();
    expect(exactResult.status, exactResult.stderr).toBe(0);
    expect(exactResult.stdout).toBe("0 findings\n");

    await writeFixture(root, relativePath, `${exactFile}\n`);
    const changedResult = runIsolatedScanner();
    expect(changedResult.status).toBe(1);
    expect(`${changedResult.stdout}${changedResult.stderr}`).toContain(`${relativePath}\tforbidden-api-route`);
    expect(`${changedResult.stdout}${changedResult.stderr}`).not.toContain(matchedValue);
  });

  it("deduplicates repeated matches and returns findings in portable file/rule order", async () => {
    const root = await createTemporaryRoot();
    await writeFixture(root, "z.txt", `${githubToken("Z")} ${githubToken("Z")}`);
    await writeFixture(root, "a.txt", `${privateKey()}\n${githubToken("Y")}`);

    expect(await scanReleaseSafety(root)).toEqual([
      { file: "a.txt", rule: "github-token" },
      { file: "a.txt", rule: "private-key" },
      { file: "z.txt", rule: "github-token" },
    ]);
  });

  it("keeps API and CLI findings redacted", async () => {
    const root = await createTemporaryRoot();
    const value = githubToken("R");
    await writeFixture(root, "unsafe.txt", value);

    const findings = await scanReleaseSafety(root);
    const result = spawnSync(process.execPath, [scannerPath, root], { encoding: "utf8" });
    const visibleOutput = `${result.stdout}${result.stderr}`;

    expect(findings).toEqual([{ file: "unsafe.txt", rule: "github-token" }]);
    expect(result.status).toBe(1);
    expect(visibleOutput).toContain("unsafe.txt\tgithub-token");
    expect(visibleOutput).not.toContain(value);
  });
});

describe("release safety filesystem boundary", () => {
  it("requires a canonical absolute directory root with no symlinked ancestor", async () => {
    const container = await createTemporaryRoot();
    const realParent = path.join(container, "real-parent");
    const root = path.join(realParent, "root");
    const aliasParent = path.join(container, "alias-parent");
    await mkdir(root, { recursive: true });
    await symlink(realParent, aliasParent);

    await expect(scanReleaseSafety("relative-root")).rejects.toThrow(/canonical absolute root/i);
    await expect(scanReleaseSafety(path.join(aliasParent, "root"))).rejects.toThrow(/canonical realpath|symlinked ancestor/i);
    await expect(scanReleaseSafety(root)).resolves.toEqual([]);
  });

  it("reports a symlink without following its target contents", async () => {
    const { container, root } = await createContainedScanRoot();
    const outside = path.join(container, "outside.txt");
    const value = githubToken("S");
    await writeFile(outside, value);
    await symlink(outside, path.join(root, "linked.txt"));

    const findings = await scanReleaseSafety(root);

    expect(findings).toEqual([{ file: "linked.txt", rule: "filesystem-symlink" }]);
    expect(JSON.stringify(findings)).not.toContain(value);
  });

  it("reports sockets and does not try to read them", async () => {
    const root = await createTemporaryRoot();
    const socketPath = path.join(root, "release.sock");
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

    try {
      await expect(scanReleaseSafety(root)).resolves.toEqual([
        { file: "release.sock", rule: "filesystem-special" },
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it("reports every hardlinked regular-file path", async () => {
    const root = await createTemporaryRoot();
    await writeFixture(root, "first.txt");
    await link(path.join(root, "first.txt"), path.join(root, "second.txt"));

    await expect(scanReleaseSafety(root)).resolves.toEqual([
      { file: "first.txt", rule: "filesystem-hardlink" },
      { file: "second.txt", rule: "filesystem-hardlink" },
    ]);
  });

  it("rejects oversized text before reading beyond the 5 MiB cap", async () => {
    const root = await createTemporaryRoot();
    await writeFixture(root, "oversized.txt", Buffer.alloc(maximumTextFileBytes + 1, 0x61));

    await expect(scanReleaseSafety(root)).resolves.toEqual([
      { file: "oversized.txt", rule: "text-file-too-large" },
    ]);
  });

  it.each([
    { file: "nul.txt", bytes: Buffer.from([0x73, 0x61, 0x66, 0x65, 0x00, 0x74, 0x65, 0x78, 0x74]) },
    { file: "opaque.bin", bytes: Buffer.from("printable opaque binary") },
    { file: "image.png", bytes: Buffer.from("printable but binary by extension") },
    { file: "downloads/unapproved.pdf", bytes: Buffer.from("%PDF-1.7\nunapproved") },
  ])("reports an unexpected binary instead of silently skipping $file", async ({ file, bytes }) => {
    const root = await createTemporaryRoot();
    await writeFixture(root, file, bytes);

    await expect(scanReleaseSafety(root)).resolves.toEqual([
      { file, rule: "unexpected-binary" },
    ]);
  });

  it.each([
    "ai-philosophy-for-smb.pdf",
    "tha-ai-management-action-sheet.pdf",
  ])("allows the hash-pinned approved PDF %s only at an exact source path", async (filename) => {
    const root = await createTemporaryRoot();
    const relativePath = `content/talks/ai-president-intro/assets/downloads/${filename}`;
    const source = path.join(process.cwd(), ...relativePath.split("/"));
    const destination = path.join(root, ...relativePath.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(source, destination);

    await expect(scanReleaseSafety(root)).resolves.toEqual([]);
  });

  it("rejects changed bytes at an approved PDF path without exposing a digest", async () => {
    const root = await createTemporaryRoot();
    const relativePath = "downloads/ai-philosophy-for-smb.pdf";
    await writeFixture(root, relativePath, Buffer.from("%PDF-1.7\nchanged"));

    const findings = await scanReleaseSafety(root);

    expect(findings).toEqual([{ file: relativePath, rule: "approved-binary-mismatch" }]);
    expect(JSON.stringify(findings)).not.toMatch(/[a-f0-9]{64}/i);
  });

  it("uses stable printable reporting paths for API and CLI hostile-path findings", async () => {
    const root = await createTemporaryRoot();
    const secret = githubToken("N");
    const rawPaths = [
      ["leak-", secret, "\n", ".txt"].join(""),
      ["tab", "\t", "name.txt"].join(""),
      ["escape", "\u001b", "name.txt"].join(""),
      ["caf", String.fromCodePoint(0xe9), ".txt"].join(""),
      ["back", "\\", "slash.txt"].join(""),
    ];
    await Promise.all(rawPaths.map((rawPath) => writeFile(path.join(root, rawPath), "safe")));

    const expected = [
      { file: "@unsafe-path-sha256/07c79d73bca15989140ccdbf1aadc40e6436120e6322510b0351a21e187e937f", rule: "path-unicode-ambiguity" },
      { file: "@unsafe-path-sha256/222fe568a9a18f155dfa5dde910881f5eac8d279239f3b693490921ea4dbf03b", rule: "path-backslash-ambiguity" },
      { file: "@unsafe-path-sha256/263171c43fb228d61ef665651abd5c2c305c73bf1142dd5cd5b0f7076a80e69d", rule: "path-unicode-ambiguity" },
      { file: "@unsafe-path-sha256/5996d1f7905c244c4fa2c38e29b4f1f2374831626a311489221ccb3f233cc4e8", rule: "path-unicode-ambiguity" },
      { file: "@unsafe-path-sha256/e0fb297ee2eabda0ae820049145c56acffd9a44adc3b8074fbdb40d6a13f43a2", rule: "github-token" },
      { file: "@unsafe-path-sha256/e0fb297ee2eabda0ae820049145c56acffd9a44adc3b8074fbdb40d6a13f43a2", rule: "path-unicode-ambiguity" },
    ];

    const findings = await scanReleaseSafety(root);
    const cli = spawnSync(process.execPath, [scannerPath, root], { encoding: "utf8" });

    expect(findings).toEqual(expected);
    expect(cli.status).toBe(1);
    expect(cli.stdout).toBe("");
    expect(cli.stderr).toBe(`${expected.map(({ file, rule }) => `${file}\t${rule}`).join("\n")}\n`);
    expect(cli.stderr.split("\n").filter(Boolean)).toHaveLength(expected.length);
    expect(cli.stderr.split("\n").filter(Boolean).every((line) => line.split("\t").length === 2)).toBe(true);
    for (const rawPath of rawPaths) {
      expect(JSON.stringify(findings)).not.toContain(rawPath);
      expect(cli.stderr).not.toContain(rawPath);
    }
    expect(JSON.stringify(findings)).not.toContain(secret);
    expect(cli.stderr).not.toContain(secret);
    expect(cli.stderr).not.toContain("\u001b");
  });

  it("uses only the printable reporting path in thrown API and CLI errors", async () => {
    const root = await createTemporaryRoot();
    const secret = githubToken("E");
    const rawPath = [
      "error-",
      secret,
      "\n\t\u001b",
      "caf",
      String.fromCodePoint(0xe9),
      "\\",
      "file.txt",
    ].join("");
    const absolutePath = path.join(root, rawPath);
    const expectedPath = "@unsafe-path-sha256/6588ecab451c03311f15fc8507b1c07ad92e1833e9b6148d4f4a6c76678c1320";
    await writeFile(absolutePath, "safe");
    const scannerUrl = pathToFileURL(scannerPath).href;
    const patchFilesystem = `
      import { createRequire, syncBuiltinESMExports } from "node:module";
      import path from "node:path";
      const require = createRequire(import.meta.url);
      const fsPromises = require("node:fs/promises");
      const originalOpen = fsPromises.open;
      const absolutePath = ${JSON.stringify(absolutePath)};
      fsPromises.open = async (filePath, ...rest) => (
        path.resolve(String(filePath)) === absolutePath
          ? Promise.reject(new Error("injected open failure"))
          : Reflect.apply(originalOpen, fsPromises, [filePath, ...rest])
      );
      syncBuiltinESMExports();
    `;
    const apiScript = `${patchFilesystem}
      const { scanReleaseSafety } = await import(${JSON.stringify(scannerUrl)});
      try {
        await scanReleaseSafety(${JSON.stringify(root)});
        process.exitCode = 2;
      } catch (error) {
        process.stdout.write(error instanceof Error ? error.message : String(error));
      }
    `;
    const cliScript = `${patchFilesystem}
      process.argv = [process.execPath, ${JSON.stringify(scannerPath)}, ${JSON.stringify(root)}];
      await import(${JSON.stringify(scannerUrl)});
    `;

    const api = spawnSync(process.execPath, ["--input-type=module", "--eval", apiScript], { encoding: "utf8" });
    const cli = spawnSync(process.execPath, ["--input-type=module", "--eval", cliScript], { encoding: "utf8" });
    const apiMessage = `Release safety scan file could not be opened safely: ${expectedPath}`;

    expect(api.status, api.stderr).toBe(0);
    expect(api.stdout).toBe(apiMessage);
    expect(api.stderr).toBe("");
    expect(api.stdout).not.toContain(rawPath);
    expect(api.stdout).not.toContain(secret);
    expect(api.stdout).not.toMatch(/[\t\r\n\u001b]/);
    expect(cli.status).toBe(1);
    expect(cli.stdout).toBe("");
    expect(cli.stderr).toBe(`Release safety scan failed: ${apiMessage}\n`);
    expect(cli.stderr).not.toContain(rawPath);
    expect(cli.stderr).not.toContain(secret);
    expect(cli.stderr).not.toContain("\u001b");
  });

  it("reports both names in a case-folded path collision", async () => {
    const root = await createTemporaryRoot();
    const actualPath = path.join(root, "Alpha.txt");
    const aliasPath = path.join(root, "alpha.txt");
    await writeFile(actualPath, "safe");
    const scannerUrl = pathToFileURL(scannerPath).href;
    const childScript = `
      import { createRequire, syncBuiltinESMExports } from "node:module";
      import path from "node:path";
      const require = createRequire(import.meta.url);
      const fsPromises = require("node:fs/promises");
      const originalReaddir = fsPromises.readdir;
      const originalLstat = fsPromises.lstat;
      const root = ${JSON.stringify(root)};
      const actualPath = ${JSON.stringify(actualPath)};
      const aliasPath = ${JSON.stringify(aliasPath)};
      fsPromises.readdir = async (...arguments_) => {
        const entries = await Reflect.apply(originalReaddir, fsPromises, arguments_);
        if (path.resolve(String(arguments_[0])) !== root) return entries;
        return [...entries, {
          name: "alpha.txt",
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isDirectory: () => false,
          isFIFO: () => false,
          isFile: () => true,
          isSocket: () => false,
          isSymbolicLink: () => false,
        }];
      };
      fsPromises.lstat = async (filePath, ...rest) => (
        path.resolve(String(filePath)) === aliasPath
          ? Reflect.apply(originalLstat, fsPromises, [actualPath, ...rest])
          : Reflect.apply(originalLstat, fsPromises, [filePath, ...rest])
      );
      syncBuiltinESMExports();
      const { scanReleaseSafety } = await import(${JSON.stringify(scannerUrl)});
      process.stdout.write(JSON.stringify(await scanReleaseSafety(root)));
    `;

    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", childScript], { encoding: "utf8" });

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      { file: "Alpha.txt", rule: "path-case-collision" },
      { file: "alpha.txt", rule: "path-case-collision" },
    ]);
  });
});

describe("strict release safety rule configuration", () => {
  it("rejects duplicate JSON object keys", async () => {
    const rawRules = await readFile(rulesPath, "utf8");
    const duplicateVersion = rawRules.replace(/^\{/, "{\n  \"version\": 1,");
    const isolatedPath = await createIsolatedScanner(duplicateVersion);
    const root = await createTemporaryRoot();
    const result = spawnSync(process.execPath, [isolatedPath, root], { encoding: "utf8" });

    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/duplicate object key/i);
  });

  it("rejects unknown configuration fields without exposing their values", async () => {
    const parsed = JSON.parse(await readFile(rulesPath, "utf8")) as Record<string, unknown>;
    const value = slackWebhook("Q");
    const isolatedPath = await createIsolatedScanner(`${JSON.stringify({ ...parsed, unexpected: value }, null, 2)}\n`);
    const root = await createTemporaryRoot();
    const result = spawnSync(process.execPath, [isolatedPath, root], { encoding: "utf8" });
    const visibleOutput = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(visibleOutput).toMatch(/configuration|config/i);
    expect(visibleOutput).not.toContain(value);
  });

  it("rejects duplicate rule IDs and case-folded allowance paths", async () => {
    const parsed = JSON.parse(await readFile(rulesPath, "utf8")) as {
      rules: Array<Record<string, unknown>>;
    } & Record<string, unknown>;
    const duplicateId = {
      ...parsed,
      rules: [...parsed.rules, { ...parsed.rules[0] }],
    };
    const duplicatePath = await createIsolatedScanner(`${JSON.stringify(duplicateId, null, 2)}\n`);
    const root = await createTemporaryRoot();
    const duplicateResult = spawnSync(process.execPath, [duplicatePath, root], { encoding: "utf8" });
    expect(duplicateResult.status).toBe(1);
    expect(duplicateResult.stderr).toMatch(/duplicate rule id/i);

    const firstRule = parsed.rules[0]!;
    const collidingPaths = {
      ...parsed,
      rules: [
        { ...firstRule, allowPaths: ["Tests/fixture.txt", "tests/fixture.txt"] },
        ...parsed.rules.slice(1),
      ],
    };
    const collidingPath = await createIsolatedScanner(`${JSON.stringify(collidingPaths, null, 2)}\n`);
    const collidingResult = spawnSync(process.execPath, [collidingPath, root], { encoding: "utf8" });
    expect(collidingResult.status).toBe(1);
    expect(collidingResult.stderr).toMatch(/allowance path collision/i);
  });
});

describe("public candidate integration", () => {
  it("copies the exact rule file and runs its scanner without private-worktree dependencies", async () => {
    const container = await createTemporaryRoot("hooked-release-candidate-");
    const outputRoot = path.join(container, "candidate");
    await mkdir(outputRoot);
    const sourceRoot = await realpath(process.cwd());

    const result = await buildPublicSource({ sourceRoot, outputRoot });

    expect(result.files).toContain("release/secret-rules.json");
    const candidateScannerPath = path.join(outputRoot, "scripts/scan-release-safety.mjs");
    expect(result.files).toContain("scripts/scan-release-safety.mjs");
    const candidateApiScript = `
      const { scanReleaseSafety } = await import(${JSON.stringify(pathToFileURL(candidateScannerPath).href)});
      process.stdout.write(JSON.stringify(await scanReleaseSafety(${JSON.stringify(outputRoot)})));
    `;
    const api = spawnSync(process.execPath, ["--input-type=module", "--eval", candidateApiScript], {
      cwd: outputRoot,
      encoding: "utf8",
      env: {} as NodeJS.ProcessEnv,
    });
    expect(api.status, api.stderr).toBe(0);
    expect(JSON.parse(api.stdout)).toEqual([]);

    const cli = spawnSync(process.execPath, [candidateScannerPath, outputRoot], {
      cwd: outputRoot,
      encoding: "utf8",
      env: {} as NodeJS.ProcessEnv,
    });
    expect(cli.status, cli.stderr).toBe(0);
    expect(cli.stdout).toBe("0 findings\n");
    expect(`${cli.stdout}${cli.stderr}`).not.toContain(sourceRoot);
  });
});
