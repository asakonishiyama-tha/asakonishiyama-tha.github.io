// @vitest-environment node

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { verifyStaticExport } from "@/scripts/verify-static-export.mjs";

const approvedRoutes = [
  "/",
  "/talks/ai-president-intro/",
  "/talks/ai-president-intro/quest/",
  "/talks/ai-president-intro/result/",
  "/talks/ai-president-intro/handout/",
];

const approvedPdfs = [
  "/downloads/ai-philosophy-for-smb.pdf",
  "/downloads/tha-ai-management-action-sheet.pdf",
];

const frameworkRouteArtifacts = [
  "index.txt",
  "talks/ai-president-intro/index.txt",
  "talks/ai-president-intro/quest/index.txt",
  "talks/ai-president-intro/result/index.txt",
  "talks/ai-president-intro/handout/index.txt",
];
const excludedDraftSlug = ["long", "lived", "companies"].join("-");

let temporaryRoot: string;
const runningServers: ChildProcess[] = [];

async function writeArtifact(relativePath: string, contents: string | Buffer) {
  const target = path.join(temporaryRoot, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
}

async function createValidExport() {
  const routeLinks = approvedRoutes.map((route) => `<a href="${route}">${route}</a>`).join("");
  const pdfLinks = approvedPdfs.map((pdf) => `<a href="${pdf}">${pdf}</a>`).join("");
  const shell = `<!doctype html><html><head><link rel="stylesheet" href="/_next/static/css/site.css"></head><body>${routeLinks}${pdfLinks}<script src="/_next/static/chunks/app.js"></script></body></html>`;

  for (const route of approvedRoutes) {
    const relativePath = route === "/" ? "index.html" : `${route.slice(1)}index.html`;
    await writeArtifact(relativePath, shell);
    await writeArtifact(relativePath.replace(/\.html$/, ".txt"), "framework route payload");
  }
  await writeArtifact("_next/static/build-test/_buildManifest.js", "self.__BUILD_MANIFEST = {};");
  await writeArtifact("_next/static/build-test/_ssgManifest.js", "self.__SSG_MANIFEST = new Set();");
  await writeArtifact("_next/static/css/site.css", "body { color: #1f2a44; }");
  await writeArtifact("_next/static/chunks/app.js", "globalThis.__STATIC_EXPORT__ = true;");
  await writeArtifact("downloads/ai-philosophy-for-smb.pdf", "%PDF-1.7\nseminar");
  await writeArtifact("downloads/tha-ai-management-action-sheet.pdf", "%PDF-1.7\naction-sheet");
}

async function startStaticServer(hostname = "127.0.0.1") {
  const child = spawn(process.execPath, [
    path.join(process.cwd(), "scripts", "serve-static-export.mjs"),
    "--directory",
    temporaryRoot,
    "--hostname",
    hostname,
    "--port",
    "0",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  runningServers.push(child);

  const origin = await new Promise<string>((resolve, reject) => {
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`Static server did not start: ${stderr}`)), 5_000);
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.stdout.on("data", (chunk) => {
      const match = chunk.toString().match(/listening at (http:\/\/\S+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]!);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Static server exited with ${code}: ${stderr}`));
    });
  });

  return origin;
}

async function request(origin: string, requestPath: string) {
  const parsed = new URL(origin);
  return new Promise<{ body: Buffer; headers: http.IncomingHttpHeaders; status: number }>((resolve, reject) => {
    const outgoing = http.request({
      hostname: parsed.hostname,
      port: parsed.port,
      method: "GET",
      path: requestPath,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      response.once("end", () => resolve({
        body: Buffer.concat(chunks),
        headers: response.headers,
        status: response.statusCode ?? 0,
      }));
    });
    outgoing.once("error", reject);
    outgoing.end();
  });
}

beforeEach(async () => {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "verify-static-export-test-"));
});

afterEach(async () => {
  for (const child of runningServers.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    }
  }
  await rm(temporaryRoot, { force: true, recursive: true });
});

describe("verifyStaticExport", () => {
  it("reports only the approved routes and PDFs for a valid export", async () => {
    await createValidExport();

    const report = await verifyStaticExport(temporaryRoot);

    expect(report.routes).toEqual(approvedRoutes);
    expect(report.forbiddenArtifacts).toEqual([]);
    expect(report.pdfs).toEqual(approvedPdfs);
    expect(report.frameworkErrorDocuments).toEqual([]);
    expect(report.frameworkRouteArtifacts).toEqual(frameworkRouteArtifacts);
  });

  it.each(["404.html", "404/index.html"])("rejects the browser-addressable framework error artifact %s", async (relativePath) => {
    await createValidExport();
    await writeArtifact(relativePath, "<!doctype html><title>Framework not found</title>");

    await expect(verifyStaticExport(temporaryRoot)).rejects.toThrow(
      `unsupported-artifact: ${relativePath}`,
    );
  });

  it.each([
    ...frameworkRouteArtifacts.map((relativePath) => ({
      label: relativePath,
      removed: [relativePath],
    })),
    { label: "all five route payloads", removed: frameworkRouteArtifacts },
  ])("requires $label in the observed framework route payload set", async ({ removed }) => {
    await createValidExport();
    await Promise.all(removed.map((relativePath) => (
      rm(path.join(temporaryRoot, relativePath), { force: true })
    )));

    await expect(verifyStaticExport(temporaryRoot)).rejects.toThrow(
      "required-framework-route-artifact-set: missing",
    );
  });

  it.each([
    ["api/index.html", "forbidden-path:api"],
    ["admin/index.html", "forbidden-path:admin"],
    ["talks/ai-president-intro/live/index.html", "forbidden-path:live"],
    ["talks/ai-president-intro/presenter/index.html", "forbidden-path:presenter"],
    [`talks/${excludedDraftSlug}/index.html`, "forbidden-path:long-lived"],
    ["talks/draft-talk/index.html", "approved-route-set"],
  ])("rejects the forbidden artifact %s", async (relativePath, rule) => {
    await createValidExport();
    await writeArtifact(relativePath, "<!doctype html><title>Forbidden</title>");

    await expect(verifyStaticExport(temporaryRoot)).rejects.toThrow(rule);
  });

  it.each([
    ["draft.html", "approved-route-set: unexpected /draft.html"],
    ["admin.html", "forbidden-path:admin: admin.html"],
    ["preview/extra.html", "approved-route-set: unexpected /preview/extra.html"],
    ["draft.HTML", "approved-route-set: unexpected /draft.HTML"],
    ["admin.HTML", "forbidden-path:admin: admin.HTML"],
    ["preview/extra.HTML", "approved-route-set: unexpected /preview/extra.HTML"],
  ])("rejects the browser-addressable HTML artifact %s", async (relativePath, rule) => {
    await createValidExport();
    await writeArtifact(relativePath, "<!doctype html><title>Unapproved</title>");

    await expect(verifyStaticExport(temporaryRoot)).rejects.toThrow(rule);
  });

  it.each([
    ["notes.csv", "unsupported-artifact: notes.csv"],
    ["config.json", "unsupported-artifact: config.json"],
    ["unknown.txt", "unsupported-artifact: unknown.txt"],
    ["downloads/unapproved.csv", "unsupported-artifact: downloads/unapproved.csv"],
    ["media/unapproved.svg", "unsupported-artifact: media/unapproved.svg"],
    ["_next/loose.js", "unsupported-artifact: _next/loose.js"],
    ["_next/static/chunks/app.js.map", "unsupported-artifact: _next/static/chunks/app.js.map"],
    ["_next/static/runtime.json", "unsupported-artifact: _next/static/runtime.json"],
  ])("rejects the unapproved ordinary artifact %s", async (relativePath, rule) => {
    await createValidExport();
    await writeArtifact(relativePath, "unapproved");

    await expect(verifyStaticExport(temporaryRoot)).rejects.toThrow(rule);
  });

  it("rejects a broken local link from exported HTML", async () => {
    await createValidExport();
    await writeArtifact("index.html", "<a href=\"/missing/\">Missing</a>");

    await expect(verifyStaticExport(temporaryRoot)).rejects.toThrow("broken-local-link");
  });

  it("rejects every symlink instead of following it", async () => {
    await createValidExport();
    const outsideFile = path.join(path.dirname(temporaryRoot), "outside-static-export.txt");
    await writeFile(outsideFile, "outside");
    await symlink(outsideFile, path.join(temporaryRoot, "linked.txt"));

    await expect(verifyStaticExport(temporaryRoot)).rejects.toThrow("symlink: linked.txt");
    await rm(outsideFile, { force: true });
  });

  it("redacts matched secret values while naming the file and rule", async () => {
    await createValidExport();
    const secret = [
      "https:",
      "",
      "hooks.slack.com",
      "services",
      "T00000000",
      "B00000000",
      "abcdefghijklmnopqrstuvwx",
    ].join("/");
    await writeArtifact("_next/app.js", `globalThis.config = ${JSON.stringify(secret)};`);

    let message = "";
    try {
      await verifyStaticExport(temporaryRoot);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("secret:slack-webhook: _next/app.js");
    expect(message).not.toContain(secret);
  });
});

describe("static export server", () => {
  it("rejects a non-loopback binding before starting", async () => {
    const result = spawnSync(process.execPath, [
      path.join(process.cwd(), "scripts", "serve-static-export.mjs"),
      "--directory",
      temporaryRoot,
      "--hostname",
      "0.0.0.0",
      "--port",
      "3000",
    ], { encoding: "utf8" });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("loopback hostname");
  });

  it("serves every approved route index and PDF bytes with correct content types", async () => {
    await createValidExport();
    const origin = await startStaticServer();

    for (const routePath of approvedRoutes) {
      const route = await request(origin, routePath);
      expect(route.status, routePath).toBe(200);
      expect(route.headers["content-type"], routePath).toContain("text/html");
      expect(route.body.toString(), routePath).toContain("<!doctype html>");
    }

    const pdf = await request(origin, "/downloads/tha-ai-management-action-sheet.pdf");
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.body).toEqual(Buffer.from("%PDF-1.7\naction-sheet"));
  });

  it.each(["/404", "/404/", "/404.html", "/404/index.html"])(
    "returns status 404 when no framework error document is published for %s",
    async (requestPath) => {
      await createValidExport();
      const origin = await startStaticServer();

      const response = await request(origin, requestPath);

      expect(response.status).toBe(404);
      expect(response.headers["content-type"]).toContain("text/plain");
      expect(response.body.toString()).toBe("Not Found\n");
    },
  );

  it.each(["/%2e%2e%2foutside.txt", "/%2e%2e%5coutside.txt", "/bad%00path"])(
    "rejects the decoded unsafe request path %s",
    async (requestPath) => {
      await createValidExport();
      const outsideFile = path.join(path.dirname(temporaryRoot), "outside.txt");
      await writeFile(outsideFile, "outside");
      const origin = await startStaticServer();

      const response = await request(origin, requestPath);

      expect(response.status).toBe(400);
      expect(response.body.toString()).not.toContain("outside");
      await rm(outsideFile, { force: true });
    },
  );

  it("returns 404 for unknown files and refuses to follow symlinks", async () => {
    await createValidExport();
    const outsideFile = path.join(path.dirname(temporaryRoot), "outside-server.txt");
    await writeFile(outsideFile, "outside");
    await symlink(outsideFile, path.join(temporaryRoot, "linked.txt"));
    const origin = await startStaticServer();

    const missing = await request(origin, "/missing.txt");
    const linked = await request(origin, "/linked.txt");

    expect(missing.status).toBe(404);
    expect(linked.status).toBe(404);
    expect(linked.body.toString()).not.toContain("outside");
    await rm(outsideFile, { force: true });
  });
});
