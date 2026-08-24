// @vitest-environment node

import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { pruneStaticErrorDocuments } from "@/scripts/prune-static-error-documents.mjs";

let temporaryRoot: string | undefined;

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { force: true, recursive: true });
  temporaryRoot = undefined;
});

describe("pruneStaticErrorDocuments", () => {
  it("removes only browser-addressable framework error HTML", async () => {
    temporaryRoot = await mkdtemp(path.join(tmpdir(), "prune-static-error-documents-"));
    await mkdir(path.join(temporaryRoot, "404"));
    await writeFile(path.join(temporaryRoot, "404.html"), "flat error");
    await writeFile(path.join(temporaryRoot, "404", "index.html"), "nested error");
    await writeFile(path.join(temporaryRoot, "index.html"), "approved home");

    const report = await pruneStaticErrorDocuments(temporaryRoot);

    expect(report.removed).toEqual(["404.html", "404/index.html"]);
    await expect(access(path.join(temporaryRoot, "404.html"))).rejects.toThrow();
    await expect(access(path.join(temporaryRoot, "404", "index.html"))).rejects.toThrow();
    await expect(readFile(path.join(temporaryRoot, "index.html"), "utf8")).resolves.toBe("approved home");
  });
});
