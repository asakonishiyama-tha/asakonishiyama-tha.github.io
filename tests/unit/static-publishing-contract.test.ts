import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import nextConfig from "@/next.config";
import { getTalk, listPublishedTalks } from "@/lib/content/talk-repository";
import { publishedTalkParams } from "@/lib/content/static-talk-params";

describe("static publishing contract", () => {
  it("configures Next.js for a portable static export", () => {
    expect(nextConfig).toMatchObject({
      output: "export",
      trailingSlash: true,
      images: { unoptimized: true },
    });
  });

  it("generates route parameters for both approved Talks", async () => {
    await expect(publishedTalkParams()).resolves.toEqual([
      { slug: "ai-president-intro" },
      { slug: "long-lived-companies" },
    ]);
  });

  it("selects both approved Talks", async () => {
    const talks = await listPublishedTalks();

    expect(talks).toHaveLength(2);
    expect(talks).toMatchObject([
      { slug: "ai-president-intro", published: true },
      { slug: "long-lived-companies", published: true },
    ]);
  });

  it("loads the approved long-lived Talk from the repository", async () => {
    await expect(getTalk("long-lived-companies")).resolves.toMatchObject({
      slug: "long-lived-companies",
      published: true,
      title: "御社らしさは、20年後も残るか。",
    });
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
