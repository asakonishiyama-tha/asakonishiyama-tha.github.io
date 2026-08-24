import { chmod, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getTalkBundle } from "@/lib/content/talk-bundle-repository";

let temporaryRoot: string | undefined;

afterEach(async () => {
  if (temporaryRoot) {
    await rm(temporaryRoot, { force: true, recursive: true });
    temporaryRoot = undefined;
  }
});

async function createTalksDirectory(): Promise<string> {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "hooked-talk-bundle-repository-"));
  const talksDirectory = path.join(temporaryRoot, "content", "talks");
  await mkdir(talksDirectory, { recursive: true });
  return talksDirectory;
}

async function validBundle(slug: string) {
  const bundleDirectory = path.join(process.cwd(), "content", "talks", "ai-president-intro");
  const [sourceManifest, sourcePresentation] = await Promise.all([
    readFile(path.join(bundleDirectory, "manifest.json"), "utf8").then(JSON.parse),
    readFile(path.join(bundleDirectory, "presentation.json"), "utf8").then(JSON.parse),
  ]);

  return {
    manifest: { ...sourceManifest, slug },
    presentation: {
      ...sourcePresentation,
      slug,
      scenes: sourcePresentation.scenes.map((scene: Record<string, unknown>) => ({ ...scene, evidenceRefs: [] })),
    },
    handout: {
      slug,
      title: "配布資料",
      subtitle: "要約",
      summary: "要約です。",
      chapters: [{ id: "chapter-1", heading: "章", body: ["本文"], evidenceRefs: [] }],
      closingAction: "次の一歩を決める。",
    },
    evidence: { slug, items: [] },
    worksheets: Object.fromEntries(["explore", "experiment", "systemize", "integrate"].map((stage) => [stage, {
      slug,
      stage,
      title: `${stage} worksheet`,
      currentState: "現在地を確認する。",
      prompts: ["最初の問い"],
      sevenDayAction: "7日以内に試す。",
      nextStageSignal: "次の段階へ進む。",
    }])),
  };
}

async function writeBundle(talksDirectory: string, slug: string): Promise<void> {
  const bundle = await validBundle(slug);
  const bundleDirectory = path.join(talksDirectory, slug);
  const worksheetsDirectory = path.join(bundleDirectory, "worksheets");
  await mkdir(worksheetsDirectory, { recursive: true });
  await Promise.all([
    writeFile(path.join(bundleDirectory, "manifest.json"), JSON.stringify(bundle.manifest), "utf8"),
    writeFile(path.join(bundleDirectory, "presentation.json"), JSON.stringify(bundle.presentation), "utf8"),
    writeFile(path.join(bundleDirectory, "handout.json"), JSON.stringify(bundle.handout), "utf8"),
    writeFile(path.join(bundleDirectory, "evidence.json"), JSON.stringify(bundle.evidence), "utf8"),
    ...Object.entries(bundle.worksheets).map(([stage, worksheet]) => (
      writeFile(path.join(worksheetsDirectory, `${stage}.json`), JSON.stringify(worksheet), "utf8")
    )),
  ]);
}

describe("getTalkBundle", () => {
  it("loads a complete bundle from its canonical directory", async () => {
    const talksDirectory = await createTalksDirectory();
    await writeBundle(talksDirectory, "bundle-talk");

    await expect(getTalkBundle("bundle-talk", talksDirectory)).resolves.toMatchObject({
      manifest: { slug: "bundle-talk", formatVersion: 2 },
      presentation: { slug: "bundle-talk" },
      handout: { slug: "bundle-talk" },
      evidence: { slug: "bundle-talk" },
      worksheets: { explore: { stage: "explore" }, integrate: { stage: "integrate" } },
    });
  });

  it("returns null when the canonical bundle directory is absent", async () => {
    const talksDirectory = await createTalksDirectory();

    await expect(getTalkBundle("missing-talk", talksDirectory)).resolves.toBeNull();
  });

  it("rejects a symbolic-link document instead of following it", async () => {
    const talksDirectory = await createTalksDirectory();
    await writeBundle(talksDirectory, "bundle-talk");
    const bundleDirectory = path.join(talksDirectory, "bundle-talk");
    const outsideDocument = path.join(temporaryRoot!, "outside-evidence.json");
    await writeFile(outsideDocument, JSON.stringify({ slug: "bundle-talk", items: [] }), "utf8");
    await rm(path.join(bundleDirectory, "evidence.json"));
    await symlink(outsideDocument, path.join(bundleDirectory, "evidence.json"));

    await expect(getTalkBundle("bundle-talk", talksDirectory)).rejects.toThrow("evidence.json");
  });

  it.each(["../bundle-talk", "nested/bundle-talk", "https://example.com/talk"])(
    "rejects an unsafe slug: %s",
    async (slug) => {
      const talksDirectory = await createTalksDirectory();

      await expect(getTalkBundle(slug, talksDirectory)).resolves.toBeNull();
    },
  );

  it("names the broken document when bundle JSON is malformed", async () => {
    const talksDirectory = await createTalksDirectory();
    await writeBundle(talksDirectory, "bundle-talk");
    await writeFile(path.join(talksDirectory, "bundle-talk", "handout.json"), "{ not-json", "utf8");

    await expect(getTalkBundle("bundle-talk", talksDirectory)).rejects.toThrow("handout.json");
  });

  it("names the source document when parseable bundle content is structurally invalid", async () => {
    const talksDirectory = await createTalksDirectory();
    await writeBundle(talksDirectory, "bundle-talk");
    await writeFile(path.join(talksDirectory, "bundle-talk", "manifest.json"), JSON.stringify({
      formatVersion: 1,
    }), "utf8");

    await expect(getTalkBundle("bundle-talk", talksDirectory)).rejects.toThrow(
      'Invalid talk bundle document "manifest.json" for "bundle-talk"',
    );
  });

  it("names presentation.json when a presentation scene fails runtime validation", async () => {
    const talksDirectory = await createTalksDirectory();
    await writeBundle(talksDirectory, "bundle-talk");
    const presentationPath = path.join(talksDirectory, "bundle-talk", "presentation.json");
    const presentation = JSON.parse(await readFile(presentationPath, "utf8"));
    presentation.scenes[0] = { id: "hero", type: "hero", evidenceRefs: [] };
    await writeFile(presentationPath, JSON.stringify(presentation), "utf8");

    await expect(getTalkBundle("bundle-talk", talksDirectory)).rejects.toThrow(
      'Invalid talk bundle document "presentation.json" for "bundle-talk"',
    );
  });

  it("names presentation.json when its slug differs from the manifest", async () => {
    const talksDirectory = await createTalksDirectory();
    await writeBundle(talksDirectory, "bundle-talk");
    const presentationPath = path.join(talksDirectory, "bundle-talk", "presentation.json");
    const presentation = JSON.parse(await readFile(presentationPath, "utf8"));
    presentation.slug = "other-talk";
    await writeFile(presentationPath, JSON.stringify(presentation), "utf8");

    await expect(getTalkBundle("bundle-talk", talksDirectory)).rejects.toThrow(
      'Invalid talk bundle document "presentation.json" for "bundle-talk"',
    );
  });

  it("names presentation.json when it references unknown evidence", async () => {
    const talksDirectory = await createTalksDirectory();
    await writeBundle(talksDirectory, "bundle-talk");
    const presentationPath = path.join(talksDirectory, "bundle-talk", "presentation.json");
    const presentation = JSON.parse(await readFile(presentationPath, "utf8"));
    presentation.scenes[0].evidenceRefs = ["missing-evidence"];
    await writeFile(presentationPath, JSON.stringify(presentation), "utf8");

    await expect(getTalkBundle("bundle-talk", talksDirectory)).rejects.toThrow(
      'Invalid talk bundle document "presentation.json" for "bundle-talk"',
    );
  });

  it("names handout.json when it references unknown evidence", async () => {
    const talksDirectory = await createTalksDirectory();
    await writeBundle(talksDirectory, "bundle-talk");
    const handoutPath = path.join(talksDirectory, "bundle-talk", "handout.json");
    const handout = JSON.parse(await readFile(handoutPath, "utf8"));
    handout.chapters[0].evidenceRefs = ["missing-evidence"];
    await writeFile(handoutPath, JSON.stringify(handout), "utf8");

    await expect(getTalkBundle("bundle-talk", talksDirectory)).rejects.toThrow(
      'Invalid talk bundle document "handout.json" for "bundle-talk"',
    );
  });

  it("names manifest.json when checking it hits a non-not-found lstat error", async () => {
    const talksDirectory = await createTalksDirectory();
    await writeBundle(talksDirectory, "bundle-talk");
    const bundleDirectory = path.join(talksDirectory, "bundle-talk");
    await chmod(bundleDirectory, 0o000);

    try {
      await expect(getTalkBundle("bundle-talk", talksDirectory)).rejects.toThrow(
        'Invalid talk bundle document "manifest.json" for "bundle-talk"',
      );
    } finally {
      await chmod(bundleDirectory, 0o700);
    }
  });
});
