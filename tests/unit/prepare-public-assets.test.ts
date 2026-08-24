import { chmod, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { preparePublicAssets } from "../../scripts/prepare-public-assets.mjs";
import type { PreparePublicAssetsTestHooks } from "../../scripts/prepare-public-assets.mjs";

const bundleDocuments = [
  "handout.json",
  "evidence.json",
  "worksheets/explore.json",
  "worksheets/experiment.json",
  "worksheets/systemize.json",
  "worksheets/integrate.json",
] as const;

let temporaryRoot: string | undefined;

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { force: true, recursive: true });
  temporaryRoot = undefined;
});

async function createFixture(): Promise<{ publicDirectory: string; talksDirectory: string }> {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "hooked-prepare-assets-"));
  const talksDirectory = path.join(temporaryRoot, "content", "talks");
  const publicDirectory = path.join(temporaryRoot, "public");
  await Promise.all([
    mkdir(talksDirectory, { recursive: true }),
    mkdir(publicDirectory, { recursive: true }),
  ]);
  return { publicDirectory, talksDirectory };
}

async function writeBundle({
  assets = {},
  published = true,
  references = [],
  slug,
  talksDirectory,
}: {
  assets?: Record<string, string>;
  published?: boolean;
  references?: string[];
  slug: string;
  talksDirectory: string;
}): Promise<string> {
  const bundleDirectory = path.join(talksDirectory, slug);
  await mkdir(path.join(bundleDirectory, "worksheets"), { recursive: true });
  await Promise.all([
    writeFile(path.join(bundleDirectory, "manifest.json"), JSON.stringify({
      formatVersion: 2,
      published,
      slug,
      resources: references,
    })),
    writeFile(path.join(bundleDirectory, "presentation.json"), JSON.stringify({ scenes: [] })),
    ...bundleDocuments.map((document) => (
      writeFile(path.join(bundleDirectory, document), JSON.stringify({ slug }))
    )),
  ]);
  for (const [assetName, contents] of Object.entries(assets)) {
    const assetPath = path.join(bundleDirectory, "assets", assetName);
    await mkdir(path.dirname(assetPath), { recursive: true });
    await writeFile(assetPath, contents);
  }
  return bundleDirectory;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function withTestHooks(
  talksDirectory: string,
  publicDirectory: string,
  testHooks: PreparePublicAssetsTestHooks & Record<string, unknown>,
): Parameters<typeof preparePublicAssets>[0] {
  return { talksDirectory, publicDirectory, testHooks };
}

async function createAncestorFixture(mode: number): Promise<{
  publicDirectory: string;
  talksDirectory: string;
}> {
  temporaryRoot = await mkdtemp(path.join(tmpdir(), "hooked-prepare-ancestor-"));
  const writableAncestor = path.join(temporaryRoot, "writable-ancestor");
  const protectedChild = path.join(writableAncestor, "protected-child");
  const talksDirectory = path.join(protectedChild, "content", "talks");
  const publicDirectory = path.join(protectedChild, "public");
  await mkdir(talksDirectory, { recursive: true });
  await mkdir(publicDirectory);
  await chmod(protectedChild, 0o755);
  await chmod(writableAncestor, mode);
  return { publicDirectory, talksDirectory };
}

async function writeOriginalAndReplacementAssets(
  publicDirectory: string,
  talksDirectory: string,
): Promise<void> {
  await writeBundle({
    assets: {
      "downloads/new.pdf": "new download",
      "media/new.webp": "new media",
    },
    references: ["/downloads/new.pdf", "/media/new.webp"],
    slug: "published-talk",
    talksDirectory,
  });
  await mkdir(path.join(publicDirectory, "downloads"));
  await mkdir(path.join(publicDirectory, "media"));
  await writeFile(path.join(publicDirectory, "downloads", "original.pdf"), "original download");
  await writeFile(path.join(publicDirectory, "media", "original.webp"), "original media");
}

async function expectOriginalAssets(publicDirectory: string): Promise<void> {
  await expect(readFile(path.join(publicDirectory, "downloads", "original.pdf"), "utf8"))
    .resolves.toBe("original download");
  await expect(readFile(path.join(publicDirectory, "media", "original.webp"), "utf8"))
    .resolves.toBe("original media");
  expect(await pathExists(path.join(publicDirectory, "downloads", "new.pdf"))).toBe(false);
  expect(await pathExists(path.join(publicDirectory, "media", "new.webp"))).toBe(false);
}

describe("preparePublicAssets", () => {
  it("replaces generated asset directories with only references from published bundles", async () => {
    const { publicDirectory, talksDirectory } = await createFixture();
    await writeBundle({
      assets: {
        "downloads/approved-a.pdf": "approved a",
        "downloads/approved-b.pdf": "approved b",
        "downloads/unreferenced.pdf": "unreferenced",
      },
      references: ["/downloads/approved-b.pdf", "/downloads/approved-a.pdf"],
      slug: "published-talk",
      talksDirectory,
    });
    await writeBundle({
      assets: { "downloads/draft.pdf": "draft" },
      published: false,
      references: ["/downloads/draft.pdf"],
      slug: "draft-talk",
      talksDirectory,
    });
    await mkdir(path.join(publicDirectory, "downloads"), { recursive: true });
    await mkdir(path.join(publicDirectory, "media"), { recursive: true });
    await writeFile(path.join(publicDirectory, "downloads", "stale.pdf"), "stale");
    await writeFile(path.join(publicDirectory, "media", "stale.webp"), "stale");
    await writeFile(path.join(publicDirectory, "keep.txt"), "keep");

    const result = await preparePublicAssets({ talksDirectory, publicDirectory });

    expect(result.copied).toEqual([
      "downloads/approved-a.pdf",
      "downloads/approved-b.pdf",
    ]);
    expect(await readdir(path.join(publicDirectory, "downloads"))).toEqual([
      "approved-a.pdf",
      "approved-b.pdf",
    ]);
    expect(await pathExists(path.join(publicDirectory, "downloads", "draft.pdf"))).toBe(false);
    expect(await pathExists(path.join(publicDirectory, "media", "stale.webp"))).toBe(false);
    await expect(readFile(path.join(publicDirectory, "keep.txt"), "utf8")).resolves.toBe("keep");
  });

  it("rejects a symlink supplied as the Talks root", async () => {
    const { publicDirectory, talksDirectory } = await createFixture();
    await writeBundle({ slug: "published-talk", talksDirectory });
    const symlinkRoot = path.join(temporaryRoot!, "linked-talks");
    await symlink(talksDirectory, symlinkRoot);

    await expect(preparePublicAssets({ talksDirectory: symlinkRoot, publicDirectory }))
      .rejects.toThrow(/symlink not allowed/);
  });

  it("rejects a symlink in a referenced source path", async () => {
    const { publicDirectory, talksDirectory } = await createFixture();
    const bundleDirectory = await writeBundle({
      references: ["/downloads/linked.pdf"],
      slug: "published-talk",
      talksDirectory,
    });
    const outsideDirectory = path.join(temporaryRoot!, "outside-downloads");
    await mkdir(outsideDirectory);
    await writeFile(path.join(outsideDirectory, "linked.pdf"), "outside");
    await mkdir(path.join(bundleDirectory, "assets"));
    await symlink(outsideDirectory, path.join(bundleDirectory, "assets", "downloads"));

    await expect(preparePublicAssets({ talksDirectory, publicDirectory }))
      .rejects.toThrow(/symlink not allowed/);
  });

  it.each([
    "/downloads/../secret.pdf",
    "/downloads/nested/../../secret.pdf",
  ])("rejects path traversal in an asset reference: %s", async (reference) => {
    const { publicDirectory, talksDirectory } = await createFixture();
    await writeBundle({ references: [reference], slug: "published-talk", talksDirectory });

    await expect(preparePublicAssets({ talksDirectory, publicDirectory }))
      .rejects.toThrow(/invalid asset reference|path traversal/);
  });

  it("rejects an absolute filesystem source path", async () => {
    const { publicDirectory, talksDirectory } = await createFixture();
    await writeBundle({
      references: [path.join(temporaryRoot!, "outside.pdf")],
      slug: "published-talk",
      talksDirectory,
    });

    await expect(preparePublicAssets({ talksDirectory, publicDirectory }))
      .rejects.toThrow(/absolute filesystem path not allowed/);
  });

  it("rejects published bundles that map different bytes to one destination", async () => {
    const { publicDirectory, talksDirectory } = await createFixture();
    for (const [slug, contents] of [["first-talk", "first"], ["second-talk", "second"]]) {
      await writeBundle({
        assets: { "downloads/shared.pdf": contents },
        references: ["/downloads/shared.pdf"],
        slug,
        talksDirectory,
      });
    }

    await expect(preparePublicAssets({ talksDirectory, publicDirectory }))
      .rejects.toThrow(/conflicting bytes.*downloads\/shared\.pdf/);
  });

  it("deduplicates a shared destination when source bytes are identical", async () => {
    const { publicDirectory, talksDirectory } = await createFixture();
    for (const slug of ["first-talk", "second-talk"]) {
      await writeBundle({
        assets: { "downloads/shared.pdf": "same" },
        references: ["/downloads/shared.pdf"],
        slug,
        talksDirectory,
      });
    }

    await expect(preparePublicAssets({ talksDirectory, publicDirectory })).resolves.toEqual({
      copied: ["downloads/shared.pdf"],
    });
  });

  it("rejects a published reference whose bundle source is missing", async () => {
    const { publicDirectory, talksDirectory } = await createFixture();
    await writeBundle({
      references: ["/media/missing.webp"],
      slug: "published-talk",
      talksDirectory,
    });

    await expect(preparePublicAssets({ talksDirectory, publicDirectory }))
      .rejects.toThrow(/missing source.*media\/missing\.webp/);
  });

  it.each([
    ["downloads/unexpected.csv", "/downloads/unexpected.csv"],
    ["media/vector.svg", "/media/vector.svg"],
    ["downloads/hero.webp", "/downloads/hero.webp"],
    ["media/handout.pdf", "/media/handout.pdf"],
  ])("rejects the unsupported referenced asset extension %s", async (relativeAsset, reference) => {
    const { publicDirectory, talksDirectory } = await createFixture();
    await writeBundle({
      assets: { [relativeAsset]: "unsupported" },
      references: [reference],
      slug: "published-talk",
      talksDirectory,
    });

    await expect(preparePublicAssets({ talksDirectory, publicDirectory }))
      .rejects.toThrow(new RegExp(`unsupported asset extension: ${relativeAsset.replace(".", "\\.")}`));
  });

  it("rejects a generated output directory that resolves outside the public root", async () => {
    const { publicDirectory, talksDirectory } = await createFixture();
    await writeBundle({
      assets: { "downloads/approved.pdf": "approved" },
      references: ["/downloads/approved.pdf"],
      slug: "published-talk",
      talksDirectory,
    });
    const outsideDirectory = path.join(temporaryRoot!, "outside-public");
    await mkdir(outsideDirectory);
    await writeFile(path.join(outsideDirectory, "keep.txt"), "keep");
    await symlink(outsideDirectory, path.join(publicDirectory, "downloads"));

    await expect(preparePublicAssets({ talksDirectory, publicDirectory }))
      .rejects.toThrow(/symlink not allowed|outside public root/);
    await expect(readFile(path.join(outsideDirectory, "keep.txt"), "utf8")).resolves.toBe("keep");
  });

  it("rejects a symlink supplied as the public root", async () => {
    const { publicDirectory, talksDirectory } = await createFixture();
    const symlinkRoot = path.join(temporaryRoot!, "linked-public");
    await symlink(publicDirectory, symlinkRoot);

    await expect(preparePublicAssets({ talksDirectory, publicDirectory: symlinkRoot }))
      .rejects.toThrow(/symlink not allowed/);
  });

  it("rejects a public root writable by users outside the owning uid", async () => {
    const { publicDirectory, talksDirectory } = await createFixture();
    await chmod(publicDirectory, 0o777);

    await expect(preparePublicAssets({ talksDirectory, publicDirectory }))
      .rejects.toThrow(/public root.*deny group\/other writes/);
  });

  it("rejects a non-sticky writable ancestor above otherwise protected roots", async () => {
    const { publicDirectory, talksDirectory } = await createAncestorFixture(0o777);

    await expect(preparePublicAssets({ talksDirectory, publicDirectory }))
      .rejects.toThrow(/ancestor.*writable.*without protective sticky ownership/);
  });

  it("supports a sticky writable ancestor when the protected child entry is owned by the current uid", async () => {
    const { publicDirectory, talksDirectory } = await createAncestorFixture(0o1777);

    await expect(preparePublicAssets({ talksDirectory, publicDirectory })).resolves.toEqual({ copied: [] });
  });

  it("rejects a protected ancestor identity swap at the publication boundary", async () => {
    const { publicDirectory, talksDirectory } = await createAncestorFixture(0o1777);
    const protectedChild = path.dirname(publicDirectory);
    const displacedChild = `${protectedChild}-displaced`;
    const outsideChild = path.join(temporaryRoot!, "outside-child");
    await mkdir(outsideChild);
    await writeFile(path.join(outsideChild, "keep.txt"), "keep");

    await expect(preparePublicAssets(withTestHooks(talksDirectory, publicDirectory, {
      beforePublish: async ({ name }) => {
        if (name !== "downloads") return;
        await rename(protectedChild, displacedChild);
        await symlink(outsideChild, protectedChild);
      },
    }))).rejects.toThrow(/public root.*identity changed/);
    await expect(readFile(path.join(outsideChild, "keep.txt"), "utf8")).resolves.toBe("keep");
  });

  it("explicitly excludes hostile same-uid filesystem mutation from its threat model", async () => {
    const { publicDirectory, talksDirectory } = await createFixture();

    await expect(preparePublicAssets({
      talksDirectory,
      publicDirectory,
      threatModel: "hostile-same-uid",
    } as unknown as Parameters<typeof preparePublicAssets>[0]))
      .rejects.toThrow(/hostile same-uid processes are outside the supported threat model/);
  });

  it("rejects a manifest whose slug differs from its canonical bundle directory", async () => {
    const { publicDirectory, talksDirectory } = await createFixture();
    const bundleDirectory = await writeBundle({ slug: "published-talk", talksDirectory });
    const manifestPath = path.join(bundleDirectory, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    await writeFile(manifestPath, JSON.stringify({ ...manifest, slug: "another-talk" }));

    await expect(preparePublicAssets({ talksDirectory, publicDirectory }))
      .rejects.toThrow(/manifest slug must match.*published-talk/);
  });

  it("rejects a manifest without a canonical slug publication identity", async () => {
    const { publicDirectory, talksDirectory } = await createFixture();
    const bundleDirectory = await writeBundle({ slug: "published-talk", talksDirectory });
    const manifestPath = path.join(bundleDirectory, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    delete manifest.slug;
    await writeFile(manifestPath, JSON.stringify(manifest));

    await expect(preparePublicAssets({ talksDirectory, publicDirectory }))
      .rejects.toThrow(/manifest requires a canonical slug/);
  });

  it("binds a document read to the file identity validated before opening", async () => {
    const { publicDirectory, talksDirectory } = await createFixture();
    const bundleDirectory = await writeBundle({ slug: "published-talk", talksDirectory });
    const displacedManifest = path.join(bundleDirectory, "manifest.original.json");
    const outsideManifest = path.join(temporaryRoot!, "outside-manifest.json");
    await writeFile(outsideManifest, JSON.stringify({ published: false, slug: "published-talk" }));

    await expect(preparePublicAssets(withTestHooks(talksDirectory, publicDirectory, {
      afterFileValidation: async ({ kind, filePath }) => {
        if (kind !== "document" || path.basename(filePath) !== "manifest.json") return;
        await rename(filePath, displacedManifest);
        await symlink(outsideManifest, filePath);
      },
    }))).rejects.toThrow(/document.*(?:changed|symlink)/);
  });

  it("binds an asset read to the file identity validated before opening", async () => {
    const { publicDirectory, talksDirectory } = await createFixture();
    const bundleDirectory = await writeBundle({
      assets: { "downloads/approved.pdf": "approved" },
      references: ["/downloads/approved.pdf"],
      slug: "published-talk",
      talksDirectory,
    });
    const displacedAsset = path.join(bundleDirectory, "assets", "downloads", "approved.original.pdf");
    const outsideAsset = path.join(temporaryRoot!, "outside.pdf");
    await writeFile(outsideAsset, "outside");

    await expect(preparePublicAssets(withTestHooks(talksDirectory, publicDirectory, {
      afterFileValidation: async ({ kind, filePath }) => {
        if (kind !== "asset" || path.basename(filePath) !== "approved.pdf") return;
        await rename(filePath, displacedAsset);
        await symlink(outsideAsset, filePath);
      },
    }))).rejects.toThrow(/asset.*(?:changed|symlink)/);
    expect(await pathExists(path.join(publicDirectory, "downloads", "approved.pdf"))).toBe(false);
  });

  it("rejects a public-root identity swap immediately before publishing", async () => {
    const { publicDirectory, talksDirectory } = await createFixture();
    await writeBundle({
      assets: { "downloads/approved.pdf": "approved" },
      references: ["/downloads/approved.pdf"],
      slug: "published-talk",
      talksDirectory,
    });
    const displacedPublic = path.join(temporaryRoot!, "public-original");
    const outsidePublic = path.join(temporaryRoot!, "outside-public-root");
    await mkdir(outsidePublic);
    await writeFile(path.join(outsidePublic, "keep.txt"), "keep");

    await expect(preparePublicAssets(withTestHooks(talksDirectory, publicDirectory, {
      beforePublish: async ({ name }) => {
        if (name !== "downloads") return;
        await rename(publicDirectory, displacedPublic);
        await symlink(outsidePublic, publicDirectory);
      },
    }))).rejects.toThrow(/public root identity changed/);
    await expect(readFile(path.join(outsidePublic, "keep.txt"), "utf8")).resolves.toBe("keep");
  });

  it("rejects a generated-parent identity swap immediately before publishing", async () => {
    const { publicDirectory, talksDirectory } = await createFixture();
    await writeBundle({
      assets: { "downloads/approved.pdf": "approved" },
      references: ["/downloads/approved.pdf"],
      slug: "published-talk",
      talksDirectory,
    });
    const downloadsDirectory = path.join(publicDirectory, "downloads");
    const displacedDownloads = path.join(publicDirectory, "downloads-original");
    const outsideDownloads = path.join(temporaryRoot!, "outside-downloads-parent");
    await mkdir(downloadsDirectory);
    await writeFile(path.join(downloadsDirectory, "stale.pdf"), "stale");
    await mkdir(outsideDownloads);
    await writeFile(path.join(outsideDownloads, "keep.txt"), "keep");

    await expect(preparePublicAssets(withTestHooks(talksDirectory, publicDirectory, {
      beforePublish: async ({ name }) => {
        if (name !== "downloads") return;
        await rename(downloadsDirectory, displacedDownloads);
        await symlink(outsideDownloads, downloadsDirectory);
      },
    }))).rejects.toThrow(/generated output identity changed.*downloads/);
    await expect(readFile(path.join(outsideDownloads, "keep.txt"), "utf8")).resolves.toBe("keep");
  });

  it("never recursively cleans through a swapped private workspace path", async () => {
    const { publicDirectory, talksDirectory } = await createFixture();
    await writeBundle({
      assets: { "downloads/approved.pdf": "approved" },
      references: ["/downloads/approved.pdf"],
      slug: "published-talk",
      talksDirectory,
    });
    const outsideDirectory = path.join(temporaryRoot!, "outside-cleanup");
    await mkdir(outsideDirectory);
    await writeFile(path.join(outsideDirectory, "keep.txt"), "keep");

    await expect(preparePublicAssets(withTestHooks(talksDirectory, publicDirectory, {
      beforeCleanup: async ({ workspaceDirectory }) => {
        await rename(workspaceDirectory, `${workspaceDirectory}-displaced`);
        await symlink(outsideDirectory, workspaceDirectory);
      },
    }))).rejects.toThrow(/workspace identity changed/);
    await expect(readFile(path.join(outsideDirectory, "keep.txt"), "utf8")).resolves.toBe("keep");
  });

  it.each([
    "before-quarantine",
    "after-quarantine",
    "before-stage",
    "after-stage",
  ])("restores every original output when publication fails at %s", async (boundary) => {
    const { publicDirectory, talksDirectory } = await createFixture();
    await writeOriginalAndReplacementAssets(publicDirectory, talksDirectory);

    await expect(preparePublicAssets(withTestHooks(talksDirectory, publicDirectory, {
      publishBoundary: async (event: unknown) => {
        const candidate = event as { boundary: string; name: string };
        if (candidate.name === "media" && candidate.boundary === boundary) {
          throw new Error(`injected publish failure at ${boundary}`);
        }
      },
    }))).rejects.toThrow(`injected publish failure at ${boundary}`);
    await expectOriginalAssets(publicDirectory);
  });

  it("restores later rollback entries and preserves quarantine when one restoration fails", async () => {
    const { publicDirectory, talksDirectory } = await createFixture();
    await writeOriginalAndReplacementAssets(publicDirectory, talksDirectory);
    const outsideDirectory = path.join(temporaryRoot!, "outside-recovery");
    await mkdir(outsideDirectory);
    await writeFile(path.join(outsideDirectory, "keep.txt"), "keep");

    const error = await preparePublicAssets(withTestHooks(talksDirectory, publicDirectory, {
      publishBoundary: async (event: unknown) => {
        const candidate = event as { boundary: string; name: string };
        if (candidate.name === "media" && candidate.boundary === "after-quarantine") {
          throw new Error("trigger rollback");
        }
      },
      rollbackBoundary: async (event: unknown) => {
        const candidate = event as { boundary: string; name: string };
        if (candidate.name === "media" && candidate.boundary === "before-restore-original") {
          throw new Error("injected media restoration failure");
        }
      },
    })).then(() => null, (caught) => caught as Error & { recoveryPath?: string });

    expect(error).toMatchObject({ name: "AssetRecoveryError" });
    expect(error?.recoveryPath).toEqual(expect.any(String));
    await expect(readFile(path.join(publicDirectory, "downloads", "original.pdf"), "utf8"))
      .resolves.toBe("original download");
    await expect(readFile(path.join(error!.recoveryPath!, "quarantine", "media", "original.webp"), "utf8"))
      .resolves.toBe("original media");
    await expect(readFile(path.join(outsideDirectory, "keep.txt"), "utf8")).resolves.toBe("keep");
  });
});
