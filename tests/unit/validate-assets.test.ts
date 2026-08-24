import { chmod, mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { validateAssets } from "../../scripts/validate-assets.mjs";

let temporaryPublicDirectory: string | undefined;
let temporaryOutsideDirectory: string | undefined;

afterEach(async () => {
  if (temporaryPublicDirectory) {
    await rm(temporaryPublicDirectory, { force: true, recursive: true });
    temporaryPublicDirectory = undefined;
  }
  if (temporaryOutsideDirectory) {
    await rm(temporaryOutsideDirectory, { force: true, recursive: true });
    temporaryOutsideDirectory = undefined;
  }
});

async function createTemporaryPublicDirectory(): Promise<string> {
  temporaryPublicDirectory = await mkdtemp(path.join(tmpdir(), "hooked-assets-"));
  return temporaryPublicDirectory;
}

async function createAncestorPublicDirectory(mode: number): Promise<string> {
  temporaryOutsideDirectory = await mkdtemp(path.join(tmpdir(), "hooked-assets-ancestor-"));
  const writableAncestor = path.join(temporaryOutsideDirectory, "writable-ancestor");
  const protectedChild = path.join(writableAncestor, "protected-child");
  const publicDirectory = path.join(protectedChild, "public");
  await mkdir(publicDirectory, { recursive: true });
  await chmod(protectedChild, 0o755);
  await chmod(writableAncestor, mode);
  return publicDirectory;
}

describe("validateAssets", () => {
  it("reports an oversized download PDF by filename and measured limit", async () => {
    const publicDirectory = await createTemporaryPublicDirectory();
    const downloadsDirectory = path.join(publicDirectory, "downloads");
    await mkdir(downloadsDirectory, { recursive: true });
    await writeFile(path.join(downloadsDirectory, "too-large.pdf"), Buffer.alloc(21 * 1024 * 1024));

    await expect(validateAssets(publicDirectory)).resolves.toEqual([
      "downloads/too-large.pdf: 21.00MB exceeds 20.00MB",
    ]);
  });

  it("reports images wider than the presentation limit", async () => {
    const publicDirectory = await createTemporaryPublicDirectory();
    const mediaDirectory = path.join(publicDirectory, "media");
    await mkdir(mediaDirectory, { recursive: true });
    await sharp({
      create: { width: 2401, height: 1, channels: 3, background: "#2360F0" },
    }).png().toFile(path.join(mediaDirectory, "wide.png"));

    await expect(validateAssets(publicDirectory)).resolves.toEqual([
      "media/wide.png: 2401px exceeds 2400px",
    ]);
  });

  it("rejects symlinks instead of following a path outside public assets", async () => {
    const publicDirectory = await createTemporaryPublicDirectory();
    const downloadsDirectory = path.join(publicDirectory, "downloads");
    const outsideFile = path.join(publicDirectory, "outside.pdf");
    await mkdir(downloadsDirectory, { recursive: true });
    await writeFile(outsideFile, "not an asset");
    await symlink(outsideFile, path.join(downloadsDirectory, "linked.pdf"));

    await expect(validateAssets(publicDirectory)).resolves.toEqual([
      "downloads/linked.pdf: symlink not allowed",
    ]);
  });

  it("rejects a symlinked media directory instead of traversing it", async () => {
    const publicDirectory = await createTemporaryPublicDirectory();
    temporaryOutsideDirectory = await mkdtemp(path.join(tmpdir(), "hooked-assets-outside-"));
    await writeFile(path.join(temporaryOutsideDirectory, "untrusted.pdf"), "outside public assets");
    await symlink(temporaryOutsideDirectory, path.join(publicDirectory, "media"));

    await expect(validateAssets(publicDirectory)).resolves.toEqual([
      "media: symlink not allowed",
    ]);
  });

  it("rejects a symlink supplied as the public root instead of validating outside it", async () => {
    const publicDirectory = await createTemporaryPublicDirectory();
    temporaryOutsideDirectory = await mkdtemp(path.join(tmpdir(), "hooked-assets-outside-"));
    const linkedPublicDirectory = path.join(temporaryOutsideDirectory, "linked-public");
    await symlink(publicDirectory, linkedPublicDirectory);

    await expect(validateAssets(linkedPublicDirectory)).rejects.toThrow(/public root symlink not allowed/);
  });

  it("rejects a public-root identity swap before traversing generated assets", async () => {
    const publicDirectory = await createTemporaryPublicDirectory();
    temporaryOutsideDirectory = await mkdtemp(path.join(tmpdir(), "hooked-assets-outside-"));
    const displacedPublic = path.join(temporaryOutsideDirectory, "public-original");
    const outsidePublic = path.join(temporaryOutsideDirectory, "outside-public");
    await mkdir(outsidePublic);
    await writeFile(path.join(outsidePublic, "keep.pdf"), "keep");

    await expect(validateAssets(publicDirectory, {
      beforeTraversal: async () => {
        await rename(publicDirectory, displacedPublic);
        await symlink(outsidePublic, publicDirectory);
      },
    })).rejects.toThrow(/public root identity changed/);
  });

  it("rejects validation beneath a non-sticky writable ancestor", async () => {
    const publicDirectory = await createAncestorPublicDirectory(0o777);

    await expect(validateAssets(publicDirectory))
      .rejects.toThrow(/ancestor.*writable.*without protective sticky ownership/);
  });

  it("allows validation beneath a protective sticky ancestor", async () => {
    const publicDirectory = await createAncestorPublicDirectory(0o1777);

    await expect(validateAssets(publicDirectory)).resolves.toEqual([]);
  });

  it("rejects a protected ancestor identity swap at the traversal boundary", async () => {
    const publicDirectory = await createAncestorPublicDirectory(0o1777);
    const protectedChild = path.dirname(publicDirectory);
    const displacedChild = `${protectedChild}-displaced`;
    const outsideChild = path.join(temporaryOutsideDirectory!, "outside-child");
    await mkdir(outsideChild);
    await writeFile(path.join(outsideChild, "keep.txt"), "keep");

    await expect(validateAssets(publicDirectory, {
      beforeTraversal: async () => {
        await rename(protectedChild, displacedChild);
        await symlink(outsideChild, protectedChild);
      },
    })).rejects.toThrow(/public root.*identity changed/);
    await expect(readFile(path.join(outsideChild, "keep.txt"), "utf8")).resolves.toBe("keep");
  });

  it("documents that hostile same-uid replacement is outside the validator threat model", async () => {
    const publicDirectory = await createTemporaryPublicDirectory();

    await expect(validateAssets(publicDirectory, {
      threatModel: "hostile-same-uid",
    } as never)).rejects.toThrow(/hostile same-uid processes are outside the supported threat model/);
  });

  it("enforces image bytes recursively for uppercase file extensions", async () => {
    const publicDirectory = await createTemporaryPublicDirectory();
    const nestedDirectory = path.join(publicDirectory, "media", "nested");
    await mkdir(nestedDirectory, { recursive: true });
    await writeFile(path.join(nestedDirectory, "LARGE.PNG"), Buffer.alloc(2 * 1024 * 1024));

    await expect(validateAssets(publicDirectory, {
      readImageMetadata: async () => ({ width: 100 }),
    })).resolves.toEqual([
      "media/nested/LARGE.PNG: 2.00MB exceeds 1.50MB",
    ]);
  });

  it("enforces video duration for uppercase file extensions", async () => {
    const publicDirectory = await createTemporaryPublicDirectory();
    const mediaDirectory = path.join(publicDirectory, "media");
    await mkdir(mediaDirectory, { recursive: true });
    await writeFile(path.join(mediaDirectory, "long.MP4"), "fake video");

    await expect(validateAssets(publicDirectory, {
      probeVideoDuration: async () => 12.5,
    })).resolves.toEqual([
      "media/long.MP4: 12.50s exceeds 12.00s",
    ]);
  });

  it("reports an ffprobe failure without accepting the video", async () => {
    const publicDirectory = await createTemporaryPublicDirectory();
    const mediaDirectory = path.join(publicDirectory, "media");
    await mkdir(mediaDirectory, { recursive: true });
    await writeFile(path.join(mediaDirectory, "broken.mp4"), "fake video");

    await expect(validateAssets(publicDirectory, {
      probeVideoDuration: async () => { throw new Error("ffprobe unavailable"); },
    })).resolves.toEqual([
      "media/broken.mp4: video metadata could not be read",
    ]);
  });

  it.each([
    ["downloads", "unexpected.csv"],
    ["media", "vector.svg"],
    ["downloads", "hero.webp"],
    ["media", "handout.pdf"],
  ])("reports the unsupported public asset extension %s/%s", async (directory, filename) => {
    const publicDirectory = await createTemporaryPublicDirectory();
    const assetDirectory = path.join(publicDirectory, directory);
    await mkdir(assetDirectory, { recursive: true });
    await writeFile(path.join(assetDirectory, filename), "unsupported");

    await expect(validateAssets(publicDirectory)).resolves.toEqual([
      `${directory}/${filename}: unsupported asset extension`,
    ]);
  });
});
