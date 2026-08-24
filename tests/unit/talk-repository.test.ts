import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getTalk, listPublishedTalks } from "@/lib/content/talk-repository";

let temporaryContentRoot: string | undefined;

afterEach(async () => {
  vi.restoreAllMocks();

  if (temporaryContentRoot) {
    await rm(temporaryContentRoot, { force: true, recursive: true });
    temporaryContentRoot = undefined;
  }
});

async function useTemporaryTalk(slug: string, contents: string): Promise<void> {
  temporaryContentRoot = await mkdtemp(path.join(tmpdir(), "hooked-talk-repository-"));
  const talksDirectory = path.join(temporaryContentRoot, "content", "talks");
  await mkdir(talksDirectory, { recursive: true });
  await writeFile(path.join(talksDirectory, `${slug}.json`), contents, "utf8");
  vi.spyOn(process, "cwd").mockReturnValue(temporaryContentRoot);
}

async function useTemporaryTalks(talks: Array<{ slug: string; contents: string }>): Promise<void> {
  temporaryContentRoot = await mkdtemp(path.join(tmpdir(), "hooked-talk-repository-"));
  const talksDirectory = path.join(temporaryContentRoot, "content", "talks");
  await mkdir(talksDirectory, { recursive: true });
  await Promise.all(talks.map(({ slug, contents }) => (
    writeFile(path.join(talksDirectory, `${slug}.json`), contents, "utf8")
  )));
  vi.spyOn(process, "cwd").mockReturnValue(temporaryContentRoot);
}

async function canonicalLegacyTalkFixture(): Promise<Record<string, unknown>> {
  const bundleDirectory = path.join(process.cwd(), "content", "talks", "ai-president-intro");
  const [manifest, presentation] = await Promise.all([
    readFile(path.join(bundleDirectory, "manifest.json"), "utf8").then(JSON.parse),
    readFile(path.join(bundleDirectory, "presentation.json"), "utf8").then(JSON.parse),
  ]);
  const { formatVersion: _formatVersion, sourceLinks: _sourceLinks, ...talk } = manifest;
  return {
    ...talk,
    ...(presentation.presentation === undefined ? {} : { presentation: presentation.presentation }),
    scenes: presentation.scenes.map(({ evidenceRefs: _evidenceRefs, ...scene }: Record<string, unknown>) => scene),
  };
}

async function writeBundle(slug: string, sourceTalk: Record<string, unknown>): Promise<void> {
  const talksDirectory = path.join(temporaryContentRoot!, "content", "talks");
  const { presentation, scenes, ...manifest } = sourceTalk;
  const bundleDirectory = path.join(talksDirectory, slug);
  const worksheetsDirectory = path.join(bundleDirectory, "worksheets");
  await mkdir(worksheetsDirectory, { recursive: true });
  const worksheets = Object.fromEntries(["explore", "experiment", "systemize", "integrate"].map((stage) => [stage, {
    slug,
    stage,
    title: `${stage} worksheet`,
    currentState: "現在地を確認する。",
    prompts: ["最初の問い"],
    sevenDayAction: "7日以内に試す。",
    nextStageSignal: "次の段階へ進む。",
  }]));
  await Promise.all([
    writeFile(path.join(bundleDirectory, "manifest.json"), JSON.stringify({
      ...manifest,
      slug,
      formatVersion: 2,
      sourceLinks: [],
    }), "utf8"),
    writeFile(path.join(bundleDirectory, "presentation.json"), JSON.stringify({
      slug,
      ...(presentation === undefined ? {} : { presentation }),
      scenes: (scenes as Array<Record<string, unknown>>).map((scene) => ({ ...scene, evidenceRefs: [] })),
    }), "utf8"),
    writeFile(path.join(bundleDirectory, "handout.json"), JSON.stringify({
      slug,
      title: "配布資料",
      subtitle: "要約",
      summary: "要約です。",
      chapters: [{ id: "chapter-1", heading: "章", body: ["本文"], evidenceRefs: [] }],
      closingAction: "次の一歩を決める。",
    }), "utf8"),
    writeFile(path.join(bundleDirectory, "evidence.json"), JSON.stringify({ slug, items: [] }), "utf8"),
    ...Object.entries(worksheets).map(([stage, worksheet]) => (
      writeFile(path.join(worksheetsDirectory, `${stage}.json`), JSON.stringify(worksheet), "utf8")
    )),
  ]);
}

describe("getTalk", () => {
  it("loads a published talk", async () => {
    const talk = await getTalk("ai-president-intro");

    expect(talk?.published).toBe(true);
    expect(talk?.questions).toHaveLength(3);
    expect(talk?.results).toHaveLength(4);
  });

  it("returns null for an unknown talk", async () => {
    await expect(getTalk("missing")).resolves.toBeNull();
  });

  it.each(["../package", "nested/talk", "https://example.com/talk"])(
    "rejects an unsafe slug: %s",
    async (slug) => {
      await expect(getTalk(slug)).resolves.toBeNull();
    },
  );

  it("rejects structurally malformed CMS JSON instead of returning it as a Talk", async () => {
    const sourceTalk = await canonicalLegacyTalkFixture();
    await useTemporaryTalk("malformed", JSON.stringify({ ...sourceTalk, questions: [] }));

    await expect(getTalk("malformed")).rejects.toThrow(
      'Invalid talk content for "malformed": Invalid talk: published talk requires three questions',
    );
  });

  it("wraps invalid JSON syntax in a clear content error", async () => {
    await useTemporaryTalk("broken", "{ not-json");

    await expect(getTalk("broken")).rejects.toThrow(
      'Invalid talk content for "broken"',
    );
  });

  it("rejects a symbolic-link legacy JSON file instead of following it", async () => {
    const sourceTalk = await canonicalLegacyTalkFixture();
    await useTemporaryTalk("linked", JSON.stringify(sourceTalk));
    const talksDirectory = path.join(temporaryContentRoot!, "content", "talks");
    const outsideTalk = path.join(temporaryContentRoot!, "outside.json");
    await writeFile(outsideTalk, JSON.stringify(sourceTalk), "utf8");
    await rm(path.join(talksDirectory, "linked.json"));
    await symlink(outsideTalk, path.join(talksDirectory, "linked.json"));

    await expect(getTalk("linked")).rejects.toThrow(
      'Invalid talk content for "linked": symbolic links are not allowed',
    );
  });

  it("composes a bundle before considering a same-slug legacy JSON file", async () => {
    const sourceTalk = await canonicalLegacyTalkFixture();
    await useTemporaryTalk("bundle-talk", JSON.stringify({ ...sourceTalk, slug: "bundle-talk", title: "legacy title" }));
    await writeBundle("bundle-talk", { ...sourceTalk, title: "bundle title" });

    const talk = await getTalk("bundle-talk");

    expect(talk).toMatchObject({
      slug: "bundle-talk",
      title: "bundle title",
    });
    expect(talk?.scenes).toEqual(sourceTalk.scenes);
  });
});

describe("listPublishedTalks", () => {
  it("lists both approved Talks from the launch content", async () => {
    const talks = await listPublishedTalks();

    expect(talks).toHaveLength(2);
    expect(talks).toMatchObject([
      { slug: "ai-president-intro", published: true },
      { slug: "long-lived-companies", published: true },
    ]);
  });

  it("returns every published Talk and leaves drafts out of the library", async () => {
    const sourceTalk = await canonicalLegacyTalkFixture();
    await useTemporaryTalks([
      {
        slug: "regional-ai",
        contents: JSON.stringify({ ...sourceTalk, slug: "regional-ai", title: "地域企業とAI" }),
      },
      {
        slug: "private-draft",
        contents: JSON.stringify({ ...sourceTalk, slug: "private-draft", title: "下書き", published: false }),
      },
    ]);

    await expect(listPublishedTalks()).resolves.toMatchObject([
      { slug: "regional-ai", title: "地域企業とAI", published: true },
    ]);
  });

  it("includes a bundle once and retains unrelated legacy Talks", async () => {
    const sourceTalk = await canonicalLegacyTalkFixture();
    await useTemporaryTalks([
      { slug: "bundle-talk", contents: JSON.stringify({ ...sourceTalk, slug: "bundle-talk", title: "legacy title" }) },
      { slug: "legacy-talk", contents: JSON.stringify({ ...sourceTalk, slug: "legacy-talk", title: "legacy title" }) },
    ]);
    await writeBundle("bundle-talk", { ...sourceTalk, title: "bundle title" });

    const talks = await listPublishedTalks();

    expect(talks.map((talk) => talk.slug)).toEqual(["bundle-talk", "legacy-talk"]);
    expect(talks[0]).toMatchObject({ slug: "bundle-talk", title: "bundle title" });
  });
});
