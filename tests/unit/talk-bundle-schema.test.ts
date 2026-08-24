import { describe, expect, it } from "vitest";

import { composeTalk, validateTalkBundle } from "@/lib/content/talk-bundle-schema";

function validBundle() {
  return {
    manifest: {
      formatVersion: 2,
      slug: "ai-president-intro",
      title: "続く会社のつくり方",
      speaker: "西山朝子",
      eventName: "THA Hooked Talk",
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
        downloadUrl: "/downloads/tha-ai-management-action-sheet.pdf",
        formHeading: "資料を受け取る",
        consentText: "同意文",
        thankYouMessage: "ありがとうございます",
        consultationCta: "相談する",
      },
      sourceLinks: [{ label: "調査", url: "https://example.com/research", kind: "research" }],
    },
    presentation: {
      slug: "ai-president-intro",
      presentation: { heroKicker: "THA Hooked Talk" },
      scenes: [
        { id: "hero", type: "hero", heading: "続く会社のつくり方", evidenceRefs: ["japan-100-year"] },
        {
          id: "photo",
          type: "photoStory",
          image: "/media/company.webp",
          alt: "長く続く会社の建物",
          sourceNote: "THA撮影（掲載許諾済み）",
          evidenceRefs: ["japan-100-year"],
        },
        {
          id: "quest",
          type: "questCta",
          heading: "診断する",
          description: "次の一歩を見つけます",
          buttonLabel: "始める",
          evidenceRefs: [],
        },
      ],
    },
    handout: {
      slug: "ai-president-intro",
      title: "続く会社のつくり方",
      subtitle: "配布資料",
      summary: "長く続く会社の視点を解説します。",
      chapters: [
        {
          id: "chapter-1",
          heading: "100年企業",
          body: ["日本には長寿企業が多くあります。"],
          evidenceRefs: ["japan-100-year"],
          takeaway: "自社らしさを言葉にする。",
        },
      ],
      closingAction: "7日以内に一歩を決める。",
    },
    evidence: {
      slug: "ai-president-intro",
      items: [
        {
          id: "japan-100-year",
          kind: "fact",
          claim: "日本には100年以上の企業がある。",
          provenance: "secondary",
          value: "45,284",
          unit: "社",
          asOf: "2024-01-01",
          sourceTitle: "帝国データバンク調査",
          sourceUrl: "https://example.com/teikoku",
          publisher: "帝国データバンク",
          publishedAt: "2024-01-01",
          lastVerifiedAt: "2026-08-21",
          verifiedBy: "THA",
        },
      ],
    },
    worksheets: {
      explore: worksheet("explore"),
      experiment: worksheet("experiment"),
      systemize: worksheet("systemize"),
      integrate: worksheet("integrate"),
    },
  };
}

function worksheet(stage: "explore" | "experiment" | "systemize" | "integrate") {
  return {
    slug: "ai-president-intro",
    stage,
    title: `${stage} worksheet`,
    currentState: "現在地を確認する。",
    prompts: ["最初の問い"],
    sevenDayAction: "7日以内に試す。",
    nextStageSignal: "次の段階へ進む。",
  };
}

function bundleWithRef(reference: string) {
  const bundle = validBundle();
  bundle.presentation.scenes[0].evidenceRefs = [reference];
  return bundle;
}

function bundleWithInterviewPermission(permissionNote: string | undefined) {
  const bundle = validBundle();
  bundle.evidence.items[0] = {
    ...bundle.evidence.items[0],
    kind: "case",
    provenance: "interview",
    ...(permissionNote === undefined ? {} : { permissionNote }),
  };
  return bundle;
}

describe("validateTalkBundle", () => {
  it("rejects duplicate scene, question, and handout chapter IDs with document paths", () => {
    const duplicateScene = validBundle();
    duplicateScene.presentation.scenes.push({ ...duplicateScene.presentation.scenes[0] });
    expect(() => validateTalkBundle(duplicateScene)).toThrow(/presentation scenes\[3\]\.id.*duplicate.*hero/i);

    const duplicateQuestion = validBundle();
    duplicateQuestion.manifest.questions[1] = { ...duplicateQuestion.manifest.questions[0] };
    expect(() => validateTalkBundle(duplicateQuestion)).toThrow(/questions\[1\]\.id.*duplicate/i);

    const duplicateChapter = validBundle();
    duplicateChapter.handout.chapters.push({ ...duplicateChapter.handout.chapters[0] });
    expect(() => validateTalkBundle(duplicateChapter)).toThrow(/handout chapters\[1\]\.id.*duplicate.*chapter-1/i);
  });

  it("requires an intentional hero image alternative instead of deriving one from the heading", () => {
    const bundle = validBundle();
    Object.assign(bundle.presentation.scenes[0], {
      image: "/media/hero.webp",
      sourceNote: "AI生成のコンセプト画像",
    });

    expect(() => validateTalkBundle(bundle)).toThrow(/hero scene 1 alt.*required when image/i);
  });
  it("accepts a complete version 2 bundle and composes a runtime Talk without evidence references", () => {
    const bundle = validBundle();

    expect(() => validateTalkBundle(bundle)).not.toThrow();
    const talk = composeTalk(validateTalkBundle(bundle));
    expect(talk.slug).toBe("ai-president-intro");
    expect(talk.presentation).toEqual({ heroKicker: "THA Hooked Talk" });
    expect(talk.scenes).toEqual([
      { id: "hero", type: "hero", heading: "続く会社のつくり方" },
      {
        id: "photo",
        type: "photoStory",
        image: "/media/company.webp",
        alt: "長く続く会社の建物",
        sourceNote: "THA撮影（掲載許諾済み）",
      },
      { id: "quest", type: "questCta", heading: "診断する", description: "次の一歩を見つけます", buttonLabel: "始める" },
    ]);
    expect(talk).not.toHaveProperty("formatVersion");
    expect(talk).not.toHaveProperty("sourceLinks");
  });

  it("rejects focused documents with mismatched slugs", () => {
    const bundle = validBundle();
    bundle.handout.slug = "another-talk";

    expect(() => validateTalkBundle(bundle)).toThrow("bundle document slug must match manifest slug");
  });

  it("rejects duplicate evidence IDs", () => {
    const bundle = validBundle();
    bundle.evidence.items.push({ ...bundle.evidence.items[0] });

    expect(() => validateTalkBundle(bundle)).toThrow("evidence IDs must be unique");
  });

  it("rejects an evidence reference that does not exist", () => {
    expect(() => validateTalkBundle(bundleWithRef("missing"))).toThrow("unknown evidence reference: missing");
  });

  it("rejects a presentation scene without evidence references", () => {
    const bundle = validBundle();
    delete (bundle.presentation.scenes[0] as { evidenceRefs?: string[] }).evidenceRefs;

    expect(() => validateTalkBundle(bundle)).toThrow("presentation scene 1 evidenceRefs must be an array");
  });

  it("rejects a fact without a source and an as-of date", () => {
    const bundle = validBundle();
    const evidence = bundle.evidence.items[0] as { sourceTitle?: string; sourceUrl?: string; asOf?: string };
    delete evidence.sourceTitle;
    delete evidence.sourceUrl;
    delete evidence.asOf;

    expect(() => validateTalkBundle(bundle)).toThrow("fact evidence requires sourceTitle, sourceUrl, and asOf");
  });

  it.each(["javascript:alert(1)", "data:text/html,unsafe", "https://user:secret@example.com/source"])(
    "rejects an unsafe manifest source URL: %s",
    (url) => {
      const bundle = validBundle();
      bundle.manifest.sourceLinks[0].url = url;

      expect(() => validateTalkBundle(bundle)).toThrow("manifest source link 1 url must be a safe HTTP(S) URL");
    },
  );

  it.each(["javascript:alert(1)", "data:text/html,unsafe", "https://user:secret@example.com/source"])(
    "rejects an unsafe evidence source URL: %s",
    (sourceUrl) => {
      const bundle = validBundle();
      bundle.evidence.items[0].sourceUrl = sourceUrl;

      expect(() => validateTalkBundle(bundle)).toThrow("evidence item 1 sourceUrl must be a safe HTTP(S) URL");
    },
  );

  it("accepts year precision when an evidence as-of source provides only a year", () => {
    const bundle = validBundle();
    bundle.evidence.items[0].asOf = "2024";

    expect(() => validateTalkBundle(bundle)).not.toThrow();
  });

  it("accepts an explicit THA synthesis kind distinct from a THA viewpoint", () => {
    const bundle = validBundle();
    bundle.evidence.items[0].kind = "tha-synthesis";
    bundle.evidence.items[0].provenance = "tha-synthesis";

    expect(validateTalkBundle(bundle).evidence.items[0].kind).toBe("tha-synthesis");
  });

  it.each([
    ["tha-synthesis", "official"],
    ["tha-viewpoint", "secondary"],
    ["fact", "tha-synthesis"],
  ])("rejects contradictory THA evidence classification: %s / %s", (kind, provenance) => {
    const bundle = validBundle();
    bundle.evidence.items[0].kind = kind;
    bundle.evidence.items[0].provenance = provenance;

    expect(() => validateTalkBundle(bundle)).toThrow(
      "THA synthesis/viewpoint kinds require tha-synthesis provenance and vice versa",
    );
  });

  it.each(["24", "2024-1", "2024-01", "2024/01/01"])("rejects a malformed partial as-of date: %s", (asOf) => {
    const bundle = validBundle();
    bundle.evidence.items[0].asOf = asOf;

    expect(() => validateTalkBundle(bundle)).toThrow("evidence item 1 asOf must use YYYY or YYYY-MM-DD");
  });

  it("keeps publishedAt restricted to a full calendar date", () => {
    const bundle = validBundle();
    bundle.evidence.items[0].publishedAt = "2024";

    expect(() => validateTalkBundle(bundle)).toThrow("evidence item 1 publishedAt must use YYYY-MM-DD");
  });

  it("rejects interview evidence without a permission note", () => {
    expect(() => validateTalkBundle(bundleWithInterviewPermission(undefined))).toThrow(
      "interview evidence requires permissionNote",
    );
  });

  it("rejects a scene image without alternative text", () => {
    const bundle = validBundle();
    const scene = bundle.presentation.scenes[1];
    if (scene.type === "photoStory") delete scene.alt;

    expect(() => validateTalkBundle(bundle)).toThrow("photo story scene 2 alt must be a non-empty string");
  });

  it("rejects a worksheet whose stage differs from its file key", () => {
    const bundle = validBundle();
    bundle.worksheets.explore.stage = "experiment";

    expect(() => validateTalkBundle(bundle)).toThrow("worksheet explore stage must match its record key");
  });

  it("rejects unsafe download URLs", () => {
    const bundle = validBundle();
    bundle.manifest.lead.downloadUrl = "/downloads/../tha-ai-management-action-sheet.pdf";

    expect(() => validateTalkBundle(bundle)).toThrow("download PDF URL must be a safe /downloads/*.pdf path");
  });

  it.each([1, "2", 3])("rejects a format version other than 2: %o", (formatVersion) => {
    const bundle = validBundle();
    (bundle.manifest as { formatVersion: unknown }).formatVersion = formatVersion;

    expect(() => validateTalkBundle(bundle)).toThrow("manifest formatVersion must be 2");
  });
});
