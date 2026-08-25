import { describe, expect, it } from "vitest";

import { getTalkBundle } from "@/lib/content/talk-bundle-repository";

describe("ai-president-intro Talk content", () => {
  it("loads the approved AI president Talk as a complete bundle", async () => {
    const bundle = await getTalkBundle("ai-president-intro");
    expect(bundle?.manifest).toMatchObject({
      formatVersion: 2,
      slug: "ai-president-intro",
      published: true,
    });
    expect(bundle?.manifest.questions).toHaveLength(3);
    expect(bundle?.manifest.results.map(({ stage }) => stage)).toEqual([
      "explore", "experiment", "systemize", "integrate",
    ]);
    expect(bundle?.handout.chapters.length).toBeGreaterThan(0);
    expect(bundle?.manifest.lead.consentText).toBe(
      "入力いただいた情報は、資料提供、ご相談への対応、THAの関連サービス・セミナーのご案内、メールまたは任意入力された電話番号によるご連絡に利用します。",
    );
  });
});
