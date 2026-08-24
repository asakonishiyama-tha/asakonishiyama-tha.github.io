import { mkdtemp, mkdir, rm, symlink, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateContent } from "../../scripts/validate-content.ts";

let temporaryRoot: string | undefined;

afterEach(async () => {
  if (temporaryRoot) {
    await rm(temporaryRoot, { force: true, recursive: true });
    temporaryRoot = undefined;
  }
});

async function createTalksDirectory(): Promise<string> {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "hooked-content-"));
  const talksDirectory = path.join(temporaryRoot, "content", "talks");
  await mkdir(talksDirectory, { recursive: true });
  return talksDirectory;
}

async function validTalkJson(): Promise<Record<string, unknown>> {
  const bundleDirectory = path.join(process.cwd(), "content", "talks", "ai-president-intro");
  const [manifest, presentation] = await Promise.all([
    readFile(path.join(bundleDirectory, "manifest.json"), "utf8").then(JSON.parse),
    readFile(path.join(bundleDirectory, "presentation.json"), "utf8").then(JSON.parse),
  ]);
  const { formatVersion: _formatVersion, sourceLinks: _sourceLinks, ...talk } = manifest;
  return {
    ...talk,
    scenes: presentation.scenes.map(({ evidenceRefs: _evidenceRefs, ...scene }: Record<string, unknown>) => scene),
  };
}

type BundleOptions = { manifestSlug?: string };

async function writeValidBundle(talksDirectory: string, slug = "bundle-talk", options: BundleOptions = {}): Promise<string> {
  const bundleDirectory = path.join(talksDirectory, slug);
  const worksheetsDirectory = path.join(bundleDirectory, "worksheets");
  await mkdir(worksheetsDirectory, { recursive: true });

  const bundleSlug = options.manifestSlug ?? slug;
  const manifest = {
    formatVersion: 2,
    slug: bundleSlug,
    title: "バンドルトーク",
    speaker: "THA",
    eventName: "Hooked Talk",
    published: true,
    questions: [
      { id: "question-1", prompt: "問い 1", options: [{ label: "選択肢", score: 0 }] },
      { id: "question-2", prompt: "問い 2", options: [{ label: "選択肢", score: 1 }] },
      { id: "question-3", prompt: "問い 3", options: [{ label: "選択肢", score: 2 }] },
    ],
    results: [
      { stage: "explore", title: "探索期", rpgSubtitle: "探索", description: "説明", nextQuest: "次へ" },
      { stage: "experiment", title: "実験期", rpgSubtitle: "実験", description: "説明", nextQuest: "次へ" },
      { stage: "systemize", title: "仕組み化期", rpgSubtitle: "仕組み化", description: "説明", nextQuest: "次へ" },
      { stage: "integrate", title: "統合期", rpgSubtitle: "統合", description: "説明", nextQuest: "次へ" },
    ],
    lead: {
      downloadEnabled: true,
      downloadUrl: "/downloads/bundle-talk.pdf",
      formHeading: "資料を受け取る",
      consentText: "同意文",
      thankYouMessage: "ありがとうございます",
      consultationCta: "相談する",
    },
    sourceLinks: [],
  };
  const presentation = {
    slug: bundleSlug,
    scenes: [
      { id: "hero", type: "hero", heading: "バンドルトーク", evidenceRefs: [] },
      { id: "quest", type: "questCta", heading: "診断する", description: "次の一歩を見つけます", buttonLabel: "始める", evidenceRefs: [] },
    ],
  };
  const handout = {
    slug: bundleSlug,
    title: "バンドルトーク",
    subtitle: "配布資料",
    summary: "概要です。",
    chapters: [{ id: "chapter-1", heading: "第一章", body: ["本文"], evidenceRefs: [] }],
    closingAction: "一歩を決める。",
  };
  const evidence = { slug: bundleSlug, items: [] };
  const worksheet = (stage: "explore" | "experiment" | "systemize" | "integrate") => ({
    slug: bundleSlug,
    stage,
    title: `${stage} worksheet`,
    currentState: "現在地を確認する。",
    prompts: ["最初の問い"],
    sevenDayAction: "7日以内に試す。",
    nextStageSignal: "次の段階へ進む。",
  });

  await Promise.all([
    writeFile(path.join(bundleDirectory, "manifest.json"), JSON.stringify(manifest)),
    writeFile(path.join(bundleDirectory, "presentation.json"), JSON.stringify(presentation)),
    writeFile(path.join(bundleDirectory, "handout.json"), JSON.stringify(handout)),
    writeFile(path.join(bundleDirectory, "evidence.json"), JSON.stringify(evidence)),
    ...(["explore", "experiment", "systemize", "integrate"] as const).map((stage) => (
      writeFile(path.join(worksheetsDirectory, `${stage}.json`), JSON.stringify(worksheet(stage)))
    )),
  ]);

  return bundleDirectory;
}

describe("validateContent", () => {
  it("accepts every repository-managed Talk document, including drafts", async () => {
    await expect(validateContent()).resolves.toEqual([]);
  });

  it("rejects an uppercase JSON extension while still discovering the file", async () => {
    const talksDirectory = await createTalksDirectory();
    await writeFile(path.join(talksDirectory, "ai-president-intro.JSON"), JSON.stringify(await validTalkJson()));

    await expect(validateContent(talksDirectory)).resolves.toEqual([
      "ai-president-intro.JSON: Talk JSON filenames must use the lowercase .json extension",
    ]);
  });

  it("rejects a noncanonical direct Talk directory before inspecting its contents", async () => {
    const talksDirectory = await createTalksDirectory();
    const nestedDirectory = path.join(talksDirectory, "legacy_nested");
    await mkdir(nestedDirectory);
    await writeFile(path.join(nestedDirectory, "ai-president-intro.JsOn"), JSON.stringify(await validTalkJson()));

    await expect(validateContent(talksDirectory)).resolves.toEqual([
      "legacy_nested: Talk bundle directory names must use a canonical lowercase slug",
    ]);
  });

  it.each([
    ["empty_directory", undefined],
    ["notes_directory", "notes.txt"],
  ])("rejects a noncanonical direct directory containing %s", async (directoryName, filename) => {
    const talksDirectory = await createTalksDirectory();
    const directory = path.join(talksDirectory, directoryName);
    await mkdir(directory);
    if (filename !== undefined) await writeFile(path.join(directory, filename), "not a talk");

    await expect(validateContent(talksDirectory)).resolves.toEqual([
      `${directoryName}: Talk bundle directory names must use a canonical lowercase slug`,
    ]);
  });

  it("rejects a flat file whose JSON slug does not match its basename", async () => {
    const talksDirectory = await createTalksDirectory();
    const mismatchedTalk = await validTalkJson();
    mismatchedTalk.slug = "bar";
    await writeFile(path.join(talksDirectory, "foo.json"), JSON.stringify(mismatchedTalk));

    await expect(validateContent(talksDirectory)).resolves.toEqual([
      "foo.json: Invalid talk: talk slug must match filename",
    ]);
  });

  it("accepts foo.json when its JSON slug is the matching flat basename", async () => {
    const talksDirectory = await createTalksDirectory();
    const matchingTalk = await validTalkJson();
    matchingTalk.slug = "foo";
    await writeFile(path.join(talksDirectory, "foo.json"), JSON.stringify(matchingTalk));

    await expect(validateContent(talksDirectory)).resolves.toEqual([]);
  });

  it("fails closed when content/talks is missing or has no JSON files", async () => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), "hooked-content-"));
    const missingDirectory = path.join(temporaryRoot, "content", "talks");
    await expect(validateContent(missingDirectory)).resolves.toEqual([
      "content/talks: directory is missing",
    ]);

    await mkdir(missingDirectory, { recursive: true });
    await writeFile(path.join(missingDirectory, "notes.txt"), "not a talk");
    await expect(validateContent(missingDirectory)).resolves.toEqual([
      "content/talks: no JSON files found",
    ]);
  });

  it("rejects symlinked paths instead of traversing them", async () => {
    const talksDirectory = await createTalksDirectory();
    const outsideTalk = path.join(temporaryRoot!, "outside.json");
    await writeFile(outsideTalk, JSON.stringify(await validTalkJson()));
    await symlink(outsideTalk, path.join(talksDirectory, "linked.JSON"));

    await expect(validateContent(talksDirectory)).resolves.toEqual([
      "linked.JSON: symlink not allowed",
    ]);
  });

  it("accepts a complete Talk bundle alongside legacy flat Talk files", async () => {
    const talksDirectory = await createTalksDirectory();
    await writeValidBundle(talksDirectory);
    await writeFile(path.join(talksDirectory, "legacy-talk.json"), JSON.stringify({ ...(await validTalkJson()), slug: "legacy-talk" }));

    await expect(validateContent(talksDirectory)).resolves.toEqual([]);
  });

  it("accepts bundle-owned downloads under the assets directory", async () => {
    const talksDirectory = await createTalksDirectory();
    const bundleDirectory = await writeValidBundle(talksDirectory);
    const downloadsDirectory = path.join(bundleDirectory, "assets", "downloads");
    await mkdir(downloadsDirectory, { recursive: true });
    await writeFile(path.join(downloadsDirectory, "action-sheet.pdf"), "%PDF-1.7\n");

    await expect(validateContent(talksDirectory)).resolves.toEqual([]);
  });

  it("rejects an unknown JSON document in a Talk bundle", async () => {
    const talksDirectory = await createTalksDirectory();
    const bundleDirectory = await writeValidBundle(talksDirectory);
    await writeFile(path.join(bundleDirectory, "notes.json"), "{}");

    await expect(validateContent(talksDirectory)).resolves.toEqual([
      "bundle-talk/notes.json: unexpected Talk bundle JSON document",
    ]);
  });

  it("names a missing worksheet document in a Talk bundle", async () => {
    const talksDirectory = await createTalksDirectory();
    const bundleDirectory = await writeValidBundle(talksDirectory);
    await rm(path.join(bundleDirectory, "worksheets", "integrate.json"));

    await expect(validateContent(talksDirectory)).resolves.toEqual([
      "bundle-talk/worksheets/integrate.json: required Talk bundle JSON document is missing",
    ]);
  });

  it("rejects an uppercase bundle JSON extension", async () => {
    const talksDirectory = await createTalksDirectory();
    const bundleDirectory = await writeValidBundle(talksDirectory);
    await writeFile(path.join(bundleDirectory, "notes.JSON"), "{}");

    await expect(validateContent(talksDirectory)).resolves.toEqual([
      "bundle-talk/notes.JSON: Talk bundle JSON filenames must use the lowercase .json extension",
    ]);
  });

  it("rejects symlinked bundle documents", async () => {
    const talksDirectory = await createTalksDirectory();
    const bundleDirectory = await writeValidBundle(talksDirectory);
    const outsideDocument = path.join(temporaryRoot!, "outside.json");
    await writeFile(outsideDocument, "{}");
    await symlink(outsideDocument, path.join(bundleDirectory, "extra.json"));

    await expect(validateContent(talksDirectory)).resolves.toEqual([
      "bundle-talk/extra.json: symlink not allowed",
    ]);
  });

  it("rejects a bundle whose directory name does not match its manifest slug", async () => {
    const talksDirectory = await createTalksDirectory();
    await writeValidBundle(talksDirectory, "bundle-talk", { manifestSlug: "another-talk" });

    await expect(validateContent(talksDirectory)).resolves.toEqual([
      "bundle-talk/manifest.json: Talk bundle directory name must match manifest slug",
    ]);
  });

  it("names malformed evidence in a Talk bundle", async () => {
    const talksDirectory = await createTalksDirectory();
    const bundleDirectory = await writeValidBundle(talksDirectory);
    await writeFile(path.join(bundleDirectory, "evidence.json"), JSON.stringify({
      slug: "bundle-talk",
      items: [{ id: "fact", kind: "fact", claim: "事実", provenance: "official", lastVerifiedAt: "2026-08-21", verifiedBy: "THA" }],
    }));

    await expect(validateContent(talksDirectory)).resolves.toEqual([
      "bundle-talk/evidence.json: Invalid talk bundle: fact evidence requires sourceTitle, sourceUrl, and asOf",
    ]);
  });

  it("names the evidence document when its JSON is syntactically invalid", async () => {
    const talksDirectory = await createTalksDirectory();
    const bundleDirectory = await writeValidBundle(talksDirectory);
    await writeFile(path.join(bundleDirectory, "evidence.json"), "{");

    await expect(validateContent(talksDirectory)).resolves.toEqual([
      expect.stringMatching(/^bundle-talk\/evidence\.json: /),
    ]);
  });
});
