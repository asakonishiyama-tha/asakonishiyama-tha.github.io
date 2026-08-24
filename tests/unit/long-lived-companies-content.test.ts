import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { getTalkBundle } from "@/lib/content/talk-bundle-repository";
import { getTalk } from "@/lib/content/talk-repository";

const approvedPdfs = [
  ["long-lived-companies-explore.pdf", "827e80ef3034f4882a979b10f5b4a9833b1f725a5c31ac065b6717d03db51d20"],
  ["long-lived-companies-experiment.pdf", "1f70632d9d5d95292510c0b64b22ddbb9922cf2777125f9df77a41e311293680"],
  ["long-lived-companies-systemize.pdf", "00909ae94eed37cc2f1921e19798a553337ec50280c2b32898f8d627cd2f19ed"],
  ["long-lived-companies-integrate.pdf", "07a9f07ad7957e61389d04bece52670317a9adcfe430e9a8997d1151bbf19275"],
  ["long-lived-companies-handout.pdf", "e60dfbd48655e125ab4ec37e398cab66ed3625caca4a8d275b4c28e02cfae214"],
  ["long-lived-companies-talk.pdf", "a995f8747bbe8891738501dc8d925ff413b5a9aba8fa9fd30abd5b802c32a3c4"],
] as const;

const approvedImages = [
  ["long-lived-companies-hero.webp", "1e970a42ebfe926e70c33caa33f8b75c0349bdd57e4060639ad2bc6311638dc0"],
  ["long-lived-companies-time-assets.webp", "1ffc29e6bc7374a52ee15ffff6bfae7082ce643dcf7b3100d871ec06de7227da"],
] as const;

describe("long-lived-companies Talk content", () => {
  it("loads the approved 16-scene Talk as a published complete bundle", async () => {
    const bundle = await getTalkBundle("long-lived-companies");
    const talk = await getTalk("long-lived-companies");

    expect(bundle?.manifest).toMatchObject({
      formatVersion: 2,
      slug: "long-lived-companies",
      published: true,
      title: "御社らしさは、20年後も残るか。",
    });
    expect(bundle?.presentation.scenes).toHaveLength(16);
    expect(bundle?.presentation.presentation).toMatchObject({
      heroKicker: "THA / TIME ASSETS",
      scrollPrompt: "SCROLL THROUGH 1450 YEARS",
    });
    expect(bundle?.manifest.questions).toHaveLength(3);
    expect(bundle?.manifest.results.map(({ stage }) => stage)).toEqual([
      "explore", "experiment", "systemize", "integrate",
    ]);
    expect(bundle?.handout.chapters).toHaveLength(11);
    expect(talk?.scenes.map(({ id }) => id)).toEqual([
      "hero", "opening-question", "three-facts", "not-accidental", "five-soils",
      "time-assets-photo", "change-to-protect", "case-toushirou", "case-ohga",
      "case-kikkoman", "evaporation-crisis", "two-risks", "company-is-people",
      "quest", "twenty-years-later", "lead",
    ]);
    expect(talk?.scenes.find(({ id }) => id === "three-facts")).toMatchObject({
      cards: expect.arrayContaining([
        {
          title: "41.3%",
          description: "世界の100年企業に占める日本企業の割合（日経BPコンサルティング、2020年）。",
        },
      ]),
    });
    expect(talk?.scenes.filter((scene) => "image" in scene).map((scene) => ({
      id: scene.id,
      image: "image" in scene ? scene.image : undefined,
      alt: "alt" in scene ? scene.alt : undefined,
      sourceNote: "sourceNote" in scene ? scene.sourceNote : undefined,
    }))).toEqual([
      {
        id: "hero",
        image: "/media/long-lived-companies-hero.webp",
        alt: "時間を重ねた企業の知恵を、年輪と青い光で表現したコンセプト画像",
        sourceNote: "AI生成によるコンセプト画像（実在企業の写真ではありません）",
      },
      {
        id: "time-assets-photo",
        image: "/media/long-lived-companies-time-assets.webp",
        alt: "古い帳面と職人の手元に青い光が重なり、紙の記録からAIへ知恵が受け継がれるイメージ",
        sourceNote: "AI生成によるコンセプトイメージ。実在企業の実景ではありません。",
      },
    ]);
  });

  it("keeps all six approved source PDFs byte-exact inside the Talk bundle", async () => {
    for (const [filename, sha256] of approvedPdfs) {
      const bytes = await readFile(path.join(
        process.cwd(), "content", "talks", "long-lived-companies", "assets", "downloads", filename,
      ));
      expect(bytes.subarray(0, 5).toString(), filename).toBe("%PDF-");
      expect(createHash("sha256").update(bytes).digest("hex"), filename).toBe(sha256);
    }
  });

  it("keeps both disclosed WebP concept images byte-exact inside the Talk bundle", async () => {
    for (const [filename, sha256] of approvedImages) {
      const bytes = await readFile(path.join(
        process.cwd(), "content", "talks", "long-lived-companies", "assets", "media", filename,
      ));
      expect(bytes.subarray(0, 4).toString(), filename).toBe("RIFF");
      expect(bytes.subarray(8, 12).toString(), filename).toBe("WEBP");
      expect(createHash("sha256").update(bytes).digest("hex"), filename).toBe(sha256);
    }
  });
});
