import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";
import { getTalk, listPublishedTalks } from "@/lib/content/talk-repository";
import { publishedTalkParams } from "@/lib/content/static-talk-params";

const excludedDraftSlug = ["long", "lived", "companies"].join("-");

describe("static publishing contract", () => {
  it("configures Next.js for a portable static export", () => {
    expect(nextConfig).toMatchObject({
      output: "export",
      trailingSlash: true,
      images: { unoptimized: true },
    });
  });

  it("generates route parameters only for the approved Talk", async () => {
    await expect(publishedTalkParams()).resolves.toEqual([
      { slug: "ai-president-intro" },
    ]);
  });

  it("selects only the approved initial Talk", async () => {
    const talks = await listPublishedTalks();

    expect(talks).toHaveLength(1);
    expect(talks).toMatchObject([
      { slug: "ai-president-intro", published: true },
    ]);
  });

  it("keeps the removed long-lived Talk out of the repository", async () => {
    await expect(getTalk(excludedDraftSlug)).resolves.toBeNull();
  });

  it("maps the package start command to the static-export preview server", async () => {
    const packageJson = JSON.parse(await readFile(
      path.resolve(import.meta.dirname, "../../package.json"),
      "utf8",
    )) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.start).toBe("npm run preview:static");
    expect(packageJson.scripts?.start).not.toContain("next start");
  });

  it("describes runtime validation as Talk JSON rather than a removed CMS", async () => {
    const schemaSource = await readFile(
      path.resolve(import.meta.dirname, "../../lib/content/talk-schema.ts"),
      "utf8",
    );

    expect(schemaSource).not.toMatch(/untrusted JSON from the CMS/i);
    expect(schemaSource).toMatch(/untrusted Talk JSON/i);
  });
});
