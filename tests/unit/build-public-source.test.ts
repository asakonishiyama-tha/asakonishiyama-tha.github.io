import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import {
  chmod,
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildPublicSource } from "../../scripts/build-public-source.mjs";

type ReleaseManifest = {
  directories: string[];
  files: string[];
};

type BuildPublicSourceTestHooks = {
  afterStagingCreated?: (event: { stagingRoot: string }) => Promise<void>;
  beforePublish?: (event: { outputRoot: string; stagingRoot: string }) => Promise<void>;
};

const canonicalTalkDocuments = [
  "evidence.json",
  "handout.json",
  "manifest.json",
  "presentation.json",
  "worksheets/experiment.json",
  "worksheets/explore.json",
  "worksheets/integrate.json",
  "worksheets/systemize.json",
] as const;

const approvedTalkSlugs = ["ai-president-intro", "long-lived-companies"] as const;

const expectedSourceAssets = [
  "content/talks/ai-president-intro/assets/downloads/ai-philosophy-for-smb.pdf",
  "content/talks/ai-president-intro/assets/downloads/tha-ai-management-action-sheet.pdf",
  "content/talks/long-lived-companies/assets/downloads/long-lived-companies-experiment.pdf",
  "content/talks/long-lived-companies/assets/downloads/long-lived-companies-explore.pdf",
  "content/talks/long-lived-companies/assets/downloads/long-lived-companies-handout.pdf",
  "content/talks/long-lived-companies/assets/downloads/long-lived-companies-integrate.pdf",
  "content/talks/long-lived-companies/assets/downloads/long-lived-companies-systemize.pdf",
  "content/talks/long-lived-companies/assets/downloads/long-lived-companies-talk.pdf",
  "content/talks/long-lived-companies/assets/media/long-lived-companies-hero.webp",
  "content/talks/long-lived-companies/assets/media/long-lived-companies-time-assets.webp",
] as const;

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

function comparePaths(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function createTemporaryRoot(
  prefix = "hooked-public-source-",
  temporaryDirectory = tmpdir(),
): Promise<string> {
  const canonicalTemporaryDirectory = await realpath(temporaryDirectory);
  const root = await mkdtemp(path.join(canonicalTemporaryDirectory, prefix));
  temporaryRoots.push(root);
  return root;
}

async function writeSourceFile(sourceRoot: string, relativePath: string, contents = relativePath): Promise<void> {
  const filePath = path.join(sourceRoot, ...relativePath.split("/"));
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function writeReleaseManifest(
  sourceRoot: string,
  manifest: ReleaseManifest & Record<string, unknown>,
): Promise<void> {
  await writeSourceFile(
    sourceRoot,
    "release/public-files.json",
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function createFixture(
  manifest: ReleaseManifest & Record<string, unknown> = {
    directories: [],
    files: ["release/public-files.json"],
  },
  temporaryDirectory?: string,
): Promise<{ outputRoot: string; sourceRoot: string; temporaryRoot: string }> {
  const temporaryRoot = await createTemporaryRoot("hooked-public-source-", temporaryDirectory);
  const sourceRoot = path.join(temporaryRoot, "source");
  const outputRoot = path.join(temporaryRoot, "output");
  await Promise.all([mkdir(sourceRoot), mkdir(outputRoot)]);
  await writeReleaseManifest(sourceRoot, manifest);
  return { outputRoot, sourceRoot, temporaryRoot };
}

async function createOutputRoot(): Promise<{ outputRoot: string; temporaryRoot: string }> {
  const temporaryRoot = await createTemporaryRoot();
  const outputRoot = path.join(temporaryRoot, "output");
  await mkdir(outputRoot);
  return { outputRoot, temporaryRoot };
}

async function writeApprovedTalk(
  sourceRoot: string,
  slug: string,
  {
    assets = {},
    references = [],
  }: {
    assets?: Record<string, string>;
    references?: string[];
  } = {},
): Promise<void> {
  const bundleRoot = path.join(sourceRoot, "content", "talks", slug);
  for (const document of canonicalTalkDocuments) {
    const contents = document === "manifest.json"
      ? {
          formatVersion: 2,
          published: true,
          resources: references,
          slug,
        }
      : {};
    await writeSourceFile(
      bundleRoot,
      document,
      `${JSON.stringify(contents)}\n`,
    );
  }
  for (const [asset, contents] of Object.entries(assets)) {
    await writeSourceFile(bundleRoot, `assets/${asset}`, contents);
  }
}

async function listRegularFiles(root: string, relativeDirectory = ""): Promise<string[]> {
  const directory = path.join(root, ...relativeDirectory.split("/").filter(Boolean));
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((left, right) => comparePaths(left.name, right.name))) {
    const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    const metadata = await lstat(path.join(directory, entry.name));
    if (metadata.isDirectory()) {
      files.push(...await listRegularFiles(root, relativePath));
    } else if (metadata.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`Unexpected non-regular fixture output: ${relativePath}`);
    }
  }
  return files;
}

async function sha256(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
}

async function hashManifest(root: string, files: string[]): Promise<Record<string, string>> {
  return Object.fromEntries(await Promise.all(files.map(async (file) => [
    file,
    await sha256(path.join(root, ...file.split("/"))),
  ])));
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

type InitialStagingLstatFaultResult = {
  errorMessage?: string;
  errorName?: string;
  resolved: boolean;
  stagingPath?: string;
};

async function runBuildWithInitialStagingLstatFault({
  outputRoot,
  replacementTarget,
  sourceRoot,
}: {
  outputRoot: string;
  replacementTarget?: string;
  sourceRoot: string;
}): Promise<InitialStagingLstatFaultResult> {
  const builderUrl = pathToFileURL(
    path.resolve(import.meta.dirname, "../../scripts/build-public-source.mjs"),
  ).href;
  const childScript = `
    import { createRequire, syncBuiltinESMExports } from "node:module";
    import path from "node:path";
    const require = createRequire(import.meta.url);
    const fsPromises = require("node:fs/promises");
    const originalLstat = fsPromises.lstat;
    let armed = true;
    let stagingPath;
    fsPromises.lstat = async (...arguments_) => {
      const filePath = arguments_[0];
      if (armed && typeof filePath === "string"
        && path.basename(filePath).startsWith(".build-public-source-")) {
        armed = false;
        stagingPath = filePath;
        const replacementTarget = ${JSON.stringify(replacementTarget ?? null)};
        if (replacementTarget) {
          await fsPromises.rm(filePath, { recursive: true });
          await fsPromises.symlink(replacementTarget, filePath);
        }
        throw new Error(${JSON.stringify(
          replacementTarget ? "injected initial staging replacement" : "injected initial staging lstat failure",
        )});
      }
      return Reflect.apply(originalLstat, fsPromises, arguments_);
    };
    syncBuiltinESMExports();
    const { buildPublicSource } = await import(${JSON.stringify(builderUrl)});
    let result = { resolved: true, stagingPath };
    try {
      await buildPublicSource({
        sourceRoot: ${JSON.stringify(sourceRoot)},
        outputRoot: ${JSON.stringify(outputRoot)},
      });
    } catch (error) {
      result = {
        errorMessage: error instanceof Error ? error.message : String(error),
        errorName: error?.constructor?.name,
        resolved: false,
        stagingPath,
      };
    }
    process.stdout.write(JSON.stringify(result));
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", childScript], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  child.stderr.on("data", (chunk: string) => { stderr += chunk; });
  const [exitCode, signal] = await once(child, "close");
  if (exitCode !== 0) throw new Error(`initial-lstat fixture failed (${signal ?? exitCode}): ${stderr}`);
  return JSON.parse(stdout) as InitialStagingLstatFaultResult;
}

function buildWithTestHooks(
  options: { outputRoot: string; sourceRoot: string },
  testHooks: BuildPublicSourceTestHooks,
): ReturnType<typeof buildPublicSource> {
  return buildPublicSource({ ...options, testHooks } as Parameters<typeof buildPublicSource>[0] & {
    testHooks: BuildPublicSourceTestHooks;
  });
}

async function startOutputNameObserver(outputRoot: string): Promise<{
  claimed: () => boolean;
  missing: () => boolean;
  stop: () => Promise<void>;
}> {
  const state = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 4));
  const worker = new Worker(`
    const { existsSync, mkdirSync, writeFileSync } = require("node:fs");
    const { workerData } = require("node:worker_threads");
    const state = new Int32Array(workerData.buffer);
    Atomics.store(state, 0, 1);
    Atomics.notify(state, 0);
    while (Atomics.load(state, 1) === 0) {
      if (!existsSync(workerData.outputRoot)) {
        Atomics.store(state, 2, 1);
        try {
          mkdirSync(workerData.outputRoot);
          writeFileSync(workerData.outputRoot + "/name-claimed", "claimed");
          Atomics.store(state, 3, 1);
        } catch {}
      }
    }
  `, {
    eval: true,
    workerData: { buffer: state.buffer, outputRoot },
  });
  const deadline = Date.now() + 2_000;
  while (Atomics.load(state, 0) !== 1) {
    if (Date.now() > deadline) {
      await worker.terminate();
      throw new Error("output-name observer did not start");
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  await new Promise((resolve) => setTimeout(resolve, 5));
  return {
    claimed: () => Atomics.load(state, 3) === 1,
    missing: () => Atomics.load(state, 2) === 1,
    stop: async () => {
      Atomics.store(state, 1, 1);
      await worker.terminate();
    },
  };
}

describe("buildPublicSource", () => {
  it("copies the public application, two approved Talks, their source assets, GAS, tests, and release tooling byte-for-byte", async () => {
    const sourceRoot = await realpath(path.resolve(import.meta.dirname, "../.."));
    const { outputRoot } = await createOutputRoot();

    const result = await buildPublicSource({ sourceRoot, outputRoot });

    expect(result.files).toEqual([...result.files].sort(comparePaths));
    expect(result.files).toEqual(await listRegularFiles(outputRoot));
    expect(result.files).toEqual(expect.arrayContaining([
      ".agents/skills/managing-tha-talks/SKILL.md",
      ".agents/skills/managing-tha-talks/agents/openai.yaml",
      ".agents/skills/managing-tha-talks/references/project-contract.md",
      ".claude/skills/managing-tha-talks/SKILL.md",
      ".env.example",
      ".gitignore",
      ".nvmrc",
      "README.md",
      "app/page.tsx",
      "components/story/StoryRenderer.tsx",
      "content/talks/ai-president-intro/manifest.json",
      "content/talks/long-lived-companies/manifest.json",
      ...expectedSourceAssets,
      "gas/Code.gs",
      "gas/appsscript.json",
      "gas/README.md",
      "lib/content/static-talk-params.ts",
      "next-env.d.ts",
      "next.config.ts",
      "package-lock.json",
      "package.json",
      "playwright.config.ts",
      "public/.gitkeep",
      "release/public-files.json",
      "scripts/build-public-source.d.mts",
      "scripts/build-public-source.mjs",
      "scripts/prepare-public-assets.mjs",
      "tests/e2e/talk-flow.spec.ts",
      "tests/unit/build-public-source.test.ts",
      "tsconfig.json",
      "vitest.config.ts",
    ]));

    const talkFiles = result.files.filter((file) => file.startsWith("content/talks/"));
    expect(new Set(talkFiles.map((file) => file.split("/")[2]))).toEqual(new Set(approvedTalkSlugs));
    expect(talkFiles.filter((file) => file.includes("/assets/"))).toEqual([...expectedSourceAssets]);
    expect(result.files.filter((file) => file.startsWith("public/"))).toEqual(["public/.gitkeep"]);
    expect(result.files.some((file) => (
      file === ".git"
      || file.startsWith(".git/")
      || (path.posix.basename(file).startsWith(".env") && file !== ".env.example")
      || file.startsWith(".local/")
      || file.startsWith(".superpowers/")
      || file.startsWith("docs/superpowers/")
      || file.startsWith("node_modules/")
      || file.startsWith(".next")
      || file.startsWith("out/")
      || file.startsWith("coverage/")
      || file.startsWith("test-results/")
      || file.startsWith("playwright-report/")
      || file.endsWith(".tsbuildinfo")
      || /(^|[/_.-])(live|presenter)([/_.-]|$)/i.test(file)
      || file.startsWith("app/api/")
      || file.startsWith("tina/")
    ))).toBe(false);
    expect(result.files.some((file) => /^licen[cs]e(?:\.|$)/i.test(path.posix.basename(file)))).toBe(false);

    for (const file of result.files) {
      const sourcePath = path.join(sourceRoot, ...file.split("/"));
      const outputPath = path.join(outputRoot, ...file.split("/"));
      expect(await sha256(outputPath), file).toBe(await sha256(sourcePath));
    }
  });

  it("keeps only approved content, referenced source assets, and the public sentinel when broad parents are allowed", async () => {
    const { outputRoot, sourceRoot } = await createFixture({
      directories: ["app", "content", "public"],
      files: ["release/public-files.json"],
    });
    await writeSourceFile(sourceRoot, "app/page.tsx", "approved app");
    await writeSourceFile(sourceRoot, "app/api/secret.ts", "server route");
    await writeSourceFile(sourceRoot, "app/live/control.ts", "live control");
    await writeSourceFile(sourceRoot, "app/presenter-console.tsx", "presenter control");
    await writeApprovedTalk(sourceRoot, "ai-president-intro", {
      assets: {
        "downloads/approved.pdf": "approved bytes",
        "downloads/unreferenced.pdf": "unreferenced bytes",
      },
      references: ["/downloads/approved.pdf"],
    });
    await writeApprovedTalk(sourceRoot, "long-lived-companies", {
      assets: {
        "media/approved.webp": "approved image bytes",
        "media/unreferenced.webp": "unreferenced image bytes",
      },
      references: ["/media/approved.webp"],
    });
    await writeSourceFile(sourceRoot, "content/talks/draft-talk/manifest.json", "{}");
    await writeSourceFile(sourceRoot, "public/.gitkeep", "\n");
    await writeSourceFile(sourceRoot, "public/downloads/generated.pdf", "generated bytes");
    await writeSourceFile(sourceRoot, "public/media/generated.webp", "generated bytes");

    const result = await buildPublicSource({ sourceRoot, outputRoot });

    expect(result.files).toEqual([
      "app/page.tsx",
      "content/talks/ai-president-intro/assets/downloads/approved.pdf",
      ...canonicalTalkDocuments.map((document) => `content/talks/ai-president-intro/${document}`),
      "content/talks/long-lived-companies/assets/media/approved.webp",
      ...canonicalTalkDocuments.map((document) => `content/talks/long-lived-companies/${document}`),
      "public/.gitkeep",
      "release/public-files.json",
    ].sort(comparePaths));
  });

  it("never copies Git metadata or private top-level state even when those entries exist", async () => {
    const { outputRoot, sourceRoot } = await createFixture({
      directories: ["app"],
      files: ["release/public-files.json"],
    });
    await writeSourceFile(sourceRoot, "app/page.tsx", "safe");
    await writeSourceFile(sourceRoot, "app/.git/config", "nested Git metadata");
    await writeSourceFile(sourceRoot, ".git/HEAD", "ref: refs/heads/private");
    await writeSourceFile(sourceRoot, ".env.local", "TOKEN=private");
    await writeSourceFile(sourceRoot, ".local/notes.md", "private notes");
    await writeSourceFile(sourceRoot, ".superpowers/progress.md", "internal progress");
    await writeSourceFile(sourceRoot, "docs/superpowers/plan.md", "internal plan");

    await expect(buildPublicSource({ sourceRoot, outputRoot })).resolves.toEqual({
      files: ["app/page.tsx", "release/public-files.json"],
    });
  });

  it("produces the same sorted manifest and hashes for repeated builds, while reflecting changed source bytes", async () => {
    const { sourceRoot, temporaryRoot } = await createFixture({
      directories: ["app"],
      files: ["README.md", "release/public-files.json"],
    });
    await writeSourceFile(sourceRoot, "README.md", "first readme");
    await writeSourceFile(sourceRoot, "app/z.ts", "z");
    await writeSourceFile(sourceRoot, "app/a.ts", "first a");
    const firstOutput = path.join(temporaryRoot, "first-output");
    const secondOutput = path.join(temporaryRoot, "second-output");
    const changedOutput = path.join(temporaryRoot, "changed-output");
    await Promise.all([mkdir(firstOutput), mkdir(secondOutput), mkdir(changedOutput)]);

    const first = await buildPublicSource({ sourceRoot, outputRoot: firstOutput });
    const second = await buildPublicSource({ sourceRoot, outputRoot: secondOutput });
    const firstHashes = await hashManifest(firstOutput, first.files);
    const secondHashes = await hashManifest(secondOutput, second.files);

    expect(second.files).toEqual(first.files);
    expect(secondHashes).toEqual(firstHashes);

    await writeSourceFile(sourceRoot, "app/a.ts", "changed a");
    const changed = await buildPublicSource({ sourceRoot, outputRoot: changedOutput });
    const changedHashes = await hashManifest(changedOutput, changed.files);

    expect(changed.files).toEqual(first.files);
    expect(changedHashes["app/a.ts"]).not.toBe(firstHashes["app/a.ts"]);
    expect(changedHashes["app/z.ts"]).toBe(firstHashes["app/z.ts"]);
  });

  it.each([
    {
      label: "unknown manifest keys",
      manifest: { directories: [], files: ["release/public-files.json"], unexpected: [] },
      message: /unknown manifest key/i,
    },
    {
      label: "duplicate directories",
      manifest: { directories: ["app", "app"], files: ["release/public-files.json"] },
      message: /duplicate manifest path/i,
    },
    {
      label: "duplicate exact files",
      manifest: {
        directories: [],
        files: ["README.md", "README.md", "release/public-files.json"],
      },
      message: /duplicate manifest path/i,
    },
    {
      label: "an exact file overlapping a broad directory",
      manifest: {
        directories: ["app"],
        files: ["app/page.tsx", "release/public-files.json"],
      },
      message: /overlap/i,
    },
    {
      label: "an unapproved broad directory",
      manifest: { directories: ["docs"], files: ["release/public-files.json"] },
      message: /directory is not approved/i,
    },
    {
      label: "an unapproved exceptional file",
      manifest: { directories: [], files: ["private.txt", "release/public-files.json"] },
      message: /file is not approved/i,
    },
    {
      label: "a backslash path",
      manifest: { directories: [], files: ["release\\public-files.json"] },
      message: /backslash|POSIX/i,
    },
    {
      label: "a Unicode path",
      manifest: { directories: [], files: ["caf\u00e9.txt", "release/public-files.json"] },
      message: /Unicode|ASCII|ambiguous/i,
    },
    {
      label: "a case-folded collision",
      manifest: {
        directories: [],
        files: ["README.md", "readme.md", "release/public-files.json"],
      },
      message: /case collision/i,
    },
  ])("rejects $label before copying", async ({ manifest, message }) => {
    const { outputRoot, sourceRoot } = await createFixture(manifest);

    await expect(buildPublicSource({ sourceRoot, outputRoot })).rejects.toThrow(message);
    expect(await readdir(outputRoot)).toEqual([]);
  });

  it("rejects duplicate top-level JSON keys instead of silently accepting the last value", async () => {
    const { outputRoot, sourceRoot } = await createFixture();
    await writeSourceFile(
      sourceRoot,
      "release/public-files.json",
      '{"directories":[],"files":["release/public-files.json"],"files":[]}\n',
    );

    await expect(buildPublicSource({ sourceRoot, outputRoot }))
      .rejects.toThrow(/duplicate manifest key/i);
    expect(await readdir(outputRoot)).toEqual([]);
  });

  it("requires explicit absolute roots and an existing empty directory outside the source", async () => {
    const { outputRoot, sourceRoot } = await createFixture();
    const relativeSource = path.relative(process.cwd(), sourceRoot);
    const relativeOutput = path.relative(process.cwd(), outputRoot);

    await expect(buildPublicSource({ sourceRoot: relativeSource, outputRoot }))
      .rejects.toThrow(/sourceRoot must be an absolute resolved path/i);
    await expect(buildPublicSource({ sourceRoot, outputRoot: relativeOutput }))
      .rejects.toThrow(/outputRoot must be an absolute resolved path/i);

    await writeSourceFile(outputRoot, "keep.txt", "existing");
    await expect(buildPublicSource({ sourceRoot, outputRoot }))
      .rejects.toThrow(/outputRoot must be empty/i);
    await expect(readFile(path.join(outputRoot, "keep.txt"), "utf8")).resolves.toBe("existing");

    const nestedOutput = path.join(sourceRoot, "candidate");
    await mkdir(nestedOutput);
    await expect(buildPublicSource({ sourceRoot, outputRoot: nestedOutput }))
      .rejects.toThrow(/sourceRoot and outputRoot must not contain each other/i);
    expect(await readdir(nestedOutput)).toEqual([]);
  });

  it("rejects an output root writable by group or other users", async () => {
    const { outputRoot, sourceRoot } = await createFixture();
    await chmod(outputRoot, 0o777);

    await expect(buildPublicSource({ sourceRoot, outputRoot }))
      .rejects.toThrow(/outputRoot.*deny group\/other writes/i);
    expect(await readdir(outputRoot)).toEqual([]);
  });

  it("rejects a source root reached through a symlinked ancestor while accepting its canonical path", async () => {
    const temporaryRoot = await createTemporaryRoot();
    const realParent = path.join(temporaryRoot, "real-parent");
    const sourceRoot = path.join(realParent, "source");
    const outputRoot = path.join(realParent, "output");
    const aliasParent = path.join(temporaryRoot, "alias-parent");
    await Promise.all([mkdir(sourceRoot, { recursive: true }), mkdir(outputRoot, { recursive: true })]);
    await writeReleaseManifest(sourceRoot, { directories: [], files: ["release/public-files.json"] });
    await symlink(realParent, aliasParent);

    await expect(buildPublicSource({
      sourceRoot: path.join(aliasParent, "source"),
      outputRoot,
    })).rejects.toThrow(/sourceRoot.*canonical realpath|symlinked ancestor/i);
    await expect(buildPublicSource({ sourceRoot, outputRoot })).resolves.toEqual({
      files: ["release/public-files.json"],
    });
  });

  it("rejects an output root reached through a symlinked ancestor while accepting its canonical path", async () => {
    const temporaryRoot = await createTemporaryRoot();
    const realParent = path.join(temporaryRoot, "real-parent");
    const sourceRoot = path.join(realParent, "source");
    const outputRoot = path.join(realParent, "output");
    const aliasParent = path.join(temporaryRoot, "alias-parent");
    await Promise.all([mkdir(sourceRoot, { recursive: true }), mkdir(outputRoot, { recursive: true })]);
    await writeReleaseManifest(sourceRoot, { directories: [], files: ["release/public-files.json"] });
    await symlink(realParent, aliasParent);

    await expect(buildPublicSource({
      sourceRoot,
      outputRoot: path.join(aliasParent, "output"),
    })).rejects.toThrow(/outputRoot.*canonical realpath|symlinked ancestor/i);
    await expect(buildPublicSource({ sourceRoot, outputRoot })).resolves.toEqual({
      files: ["release/public-files.json"],
    });
  });

  it("rejects source and output roots that are symlinks", async () => {
    const { outputRoot, sourceRoot, temporaryRoot } = await createFixture();
    const linkedSource = path.join(temporaryRoot, "linked-source");
    const linkedOutput = path.join(temporaryRoot, "linked-output");
    await Promise.all([
      symlink(sourceRoot, linkedSource),
      symlink(outputRoot, linkedOutput),
    ]);

    await expect(buildPublicSource({ sourceRoot: linkedSource, outputRoot }))
      .rejects.toThrow(/sourceRoot symlink not allowed/i);
    await expect(buildPublicSource({ sourceRoot, outputRoot: linkedOutput }))
      .rejects.toThrow(/outputRoot symlink not allowed/i);
  });

  it("keeps release secret rules absent until their exact exceptional path is listed", async () => {
    const { outputRoot, sourceRoot, temporaryRoot } = await createFixture();
    await writeSourceFile(sourceRoot, "release/secret-rules.json", "{\"rules\":[]}\n");

    await expect(buildPublicSource({ sourceRoot, outputRoot })).resolves.toEqual({
      files: ["release/public-files.json"],
    });
    expect(await pathExists(path.join(outputRoot, "release", "secret-rules.json"))).toBe(false);

    await writeReleaseManifest(sourceRoot, {
      directories: [],
      files: ["release/public-files.json", "release/secret-rules.json"],
    });
    const listedOutput = path.join(temporaryRoot, "listed-output");
    await mkdir(listedOutput);
    await expect(buildPublicSource({ sourceRoot, outputRoot: listedOutput })).resolves.toEqual({
      files: ["release/public-files.json", "release/secret-rules.json"],
    });
    await expect(readFile(path.join(listedOutput, "release", "secret-rules.json"), "utf8"))
      .resolves.toBe("{\"rules\":[]}\n");
  });

  it("uses the supported single rename primitive to replace an existing empty directory", async () => {
    const temporaryRoot = await createTemporaryRoot();
    const outputRoot = path.join(temporaryRoot, "output");
    const stagingRoot = path.join(temporaryRoot, "staging");
    await Promise.all([mkdir(outputRoot), mkdir(stagingRoot)]);
    await writeSourceFile(stagingRoot, "marker", "published");
    const outputReader = await open(outputRoot, "r");
    const [outputBefore, stagingBefore] = await Promise.all([
      outputReader.stat({ bigint: true }),
      stat(stagingRoot, { bigint: true }),
    ]);

    try {
      await rename(stagingRoot, outputRoot);

      const [outputAfter, heldReaderAfter] = await Promise.all([
        stat(outputRoot, { bigint: true }),
        outputReader.stat({ bigint: true }),
      ]);
      expect({ dev: outputAfter.dev, ino: outputAfter.ino }).toEqual({
        dev: stagingBefore.dev,
        ino: stagingBefore.ino,
      });
      expect({ dev: outputAfter.dev, ino: outputAfter.ino }).not.toEqual({
        dev: outputBefore.dev,
        ino: outputBefore.ino,
      });
      expect({ dev: heldReaderAfter.dev, ino: heldReaderAfter.ino }).toEqual({
        dev: outputBefore.dev,
        ino: outputBefore.ino,
      });
      await expect(readFile(path.join(outputRoot, "marker"), "utf8")).resolves.toBe("published");
      expect(await pathExists(stagingRoot)).toBe(false);
    } finally {
      await outputReader.close();
    }
  });

  it("publishes without exposing an absent or claimable output name to a concurrent observer", async () => {
    const { outputRoot, sourceRoot } = await createFixture();
    const outputBefore = await stat(outputRoot, { bigint: true });
    let observer: Awaited<ReturnType<typeof startOutputNameObserver>> | undefined;

    try {
      await buildWithTestHooks(
        { sourceRoot, outputRoot },
        {
          beforePublish: async () => {
            observer = await startOutputNameObserver(outputRoot);
          },
        },
      );
    } finally {
      if (observer) await observer.stop();
    }

    expect(observer).toBeDefined();
    expect(observer?.missing()).toBe(false);
    expect(observer?.claimed()).toBe(false);
    expect(await pathExists(path.join(outputRoot, "name-claimed"))).toBe(false);
    const outputAfter = await stat(outputRoot, { bigint: true });
    expect({ gid: outputAfter.gid, mode: Number(outputAfter.mode) & 0o777, uid: outputAfter.uid }).toEqual({
      gid: outputBefore.gid,
      mode: Number(outputBefore.mode) & 0o777,
      uid: outputBefore.uid,
    });
    await expect(readFile(path.join(outputRoot, "release", "public-files.json"), "utf8"))
      .resolves.toContain("public-files.json");
  });

  it("leaves the original empty output present when publication is interrupted before the atomic rename", async () => {
    const { outputRoot, sourceRoot, temporaryRoot } = await createFixture();
    const outputBefore = await stat(outputRoot, { bigint: true });

    await expect(buildWithTestHooks(
      { sourceRoot, outputRoot },
      { beforePublish: async () => { throw new Error("injected pre-publish stop"); } },
    )).rejects.toThrow(/injected pre-publish stop/);

    const outputAfter = await stat(outputRoot, { bigint: true });
    expect({ dev: outputAfter.dev, ino: outputAfter.ino }).toEqual({
      dev: outputBefore.dev,
      ino: outputBefore.ino,
    });
    expect(await readdir(outputRoot)).toEqual([]);
    expect((await readdir(temporaryRoot)).some((entry) => entry.startsWith(".build-public-source-")))
      .toBe(false);
  });

  it("keeps the original output present and the staged tree protected if the process crashes before rename", async () => {
    const { outputRoot, sourceRoot, temporaryRoot } = await createFixture();
    const outputBefore = await stat(outputRoot, { bigint: true });
    const readyFile = path.join(temporaryRoot, "crash-ready");
    const builderUrl = pathToFileURL(
      path.resolve(import.meta.dirname, "../../scripts/build-public-source.mjs"),
    ).href;
    const childScript = `
      import { writeFile } from "node:fs/promises";
      import { buildPublicSource } from ${JSON.stringify(builderUrl)};
      await buildPublicSource({
        sourceRoot: ${JSON.stringify(sourceRoot)},
        outputRoot: ${JSON.stringify(outputRoot)},
        testHooks: {
          beforePublish: async ({ stagingRoot }) => {
            await writeFile(${JSON.stringify(readyFile)}, stagingRoot, { flag: "wx" });
            await new Promise(() => { setInterval(() => {}, 1_000); });
          },
        },
      });
    `;
    const child = spawn(process.execPath, ["--input-type=module", "--eval", childScript], {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let childError = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => { childError += chunk; });

    try {
      const deadline = Date.now() + 5_000;
      while (!await pathExists(readyFile)) {
        if (child.exitCode !== null || child.signalCode !== null) {
          throw new Error(`crash fixture exited before publish boundary: ${childError}`);
        }
        if (Date.now() > deadline) throw new Error(`crash fixture did not become ready: ${childError}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      const stagingRoot = await readFile(readyFile, "utf8");
      expect(stagingRoot.startsWith(path.join(temporaryRoot, ".build-public-source-"))).toBe(true);
      const stagingMetadata = await stat(stagingRoot, { bigint: true });
      const stagingMode = Number(stagingMetadata.mode) & 0o777;
      expect({ gid: stagingMetadata.gid, mode: stagingMode, uid: stagingMetadata.uid }).toEqual({
        gid: outputBefore.gid,
        mode: Number(outputBefore.mode) & 0o777,
        uid: outputBefore.uid,
      });
      expect(stagingMode & 0o22).toBe(0);

      expect(child.kill("SIGKILL")).toBe(true);
      const [, signal] = await once(child, "exit");
      expect(signal).toBe("SIGKILL");

      const outputAfter = await stat(outputRoot, { bigint: true });
      expect({ dev: outputAfter.dev, ino: outputAfter.ino }).toEqual({
        dev: outputBefore.dev,
        ino: outputBefore.ino,
      });
      expect(await readdir(outputRoot)).toEqual([]);
      expect(await pathExists(stagingRoot)).toBe(true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
        await once(child, "exit");
      }
    }
  });

  it("cleans the exact local staging directory when initialization fails after mkdtemp", async () => {
    const { outputRoot, sourceRoot, temporaryRoot } = await createFixture();
    let stagingRoot: string | undefined;

    await expect(buildWithTestHooks(
      { sourceRoot, outputRoot },
      {
        afterStagingCreated: async (event) => {
          stagingRoot = event.stagingRoot;
          throw new Error("injected staging initialization failure");
        },
      },
    )).rejects.toThrow(/injected staging initialization failure/);

    expect(stagingRoot).toBeDefined();
    expect(await pathExists(stagingRoot!)).toBe(false);
    expect(await readdir(outputRoot)).toEqual([]);
    expect((await readdir(temporaryRoot)).some((entry) => entry.startsWith(".build-public-source-")))
      .toBe(false);
  });

  it("removes the genuine staging directory when its initial metadata capture fails", async () => {
    const { outputRoot, sourceRoot, temporaryRoot } = await createFixture();
    const result = await runBuildWithInitialStagingLstatFault({ sourceRoot, outputRoot });

    expect(result).toMatchObject({
      errorMessage: "injected initial staging lstat failure",
      resolved: false,
    });
    expect(result.stagingPath).toBeDefined();
    expect(await pathExists(result.stagingPath!)).toBe(false);
    expect(await readdir(outputRoot)).toEqual([]);
    expect((await readdir(temporaryRoot)).some((entry) => entry.startsWith(".build-public-source-")))
      .toBe(false);
  });

  it("refuses cleanup if the staging path is replaced while initial metadata capture fails", async () => {
    const { outputRoot, sourceRoot, temporaryRoot } = await createFixture();
    const replacementTarget = path.join(temporaryRoot, "replacement-target");
    await mkdir(replacementTarget);
    await writeFile(path.join(replacementTarget, "sentinel"), "keep");
    const result = await runBuildWithInitialStagingLstatFault({
      outputRoot,
      replacementTarget,
      sourceRoot,
    });

    expect(result).toMatchObject({
      errorMessage: expect.stringMatching(/staging initialization failed and cleanup was refused/),
      errorName: "AggregateError",
      resolved: false,
    });
    expect(result.stagingPath).toBeDefined();
    expect((await lstat(result.stagingPath!)).isSymbolicLink()).toBe(true);
    await expect(readFile(path.join(replacementTarget, "sentinel"), "utf8")).resolves.toBe("keep");
    expect(await readdir(outputRoot)).toEqual([]);
  });

  it("rejects a nested source symlink before any candidate bytes are published", async () => {
    const { outputRoot, sourceRoot, temporaryRoot } = await createFixture({
      directories: ["app"],
      files: ["release/public-files.json"],
    });
    await writeSourceFile(sourceRoot, "app/a-safe.ts", "safe bytes that sort first");
    const outside = path.join(temporaryRoot, "outside");
    await mkdir(outside);
    await writeSourceFile(outside, "secret.ts", "outside secret");
    await symlink(outside, path.join(sourceRoot, "app", "nested"));

    await expect(buildPublicSource({ sourceRoot, outputRoot }))
      .rejects.toThrow(/source symlink not allowed.*app\/nested/i);
    expect(await readdir(outputRoot)).toEqual([]);
  });

  it("rejects hardlinked source files before publishing", async () => {
    const { outputRoot, sourceRoot } = await createFixture({
      directories: ["app"],
      files: ["release/public-files.json"],
    });
    await writeSourceFile(sourceRoot, "original.ts", "shared inode");
    await mkdir(path.join(sourceRoot, "app"));
    await link(path.join(sourceRoot, "original.ts"), path.join(sourceRoot, "app", "linked.ts"));

    await expect(buildPublicSource({ sourceRoot, outputRoot }))
      .rejects.toThrow(/hardlink not allowed.*app\/linked\.ts/i);
    expect(await readdir(outputRoot)).toEqual([]);
  });

  it("rejects filesystem sockets and leaves the output empty", async () => {
    const { outputRoot, sourceRoot } = await createFixture(
      {
        directories: ["app"],
        files: ["release/public-files.json"],
      },
      "/tmp",
    );
    const appDirectory = path.join(sourceRoot, "app");
    await mkdir(appDirectory);
    const socketPath = path.join(appDirectory, "release.sock");
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });

    try {
      await expect(buildPublicSource({ sourceRoot, outputRoot }))
        .rejects.toThrow(/special source entry not allowed.*app\/release\.sock/i);
      expect(await readdir(outputRoot)).toEqual([]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
