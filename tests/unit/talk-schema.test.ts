import { describe, expect, it } from "vitest";

import { validateTalk, validateTalkDocument } from "@/lib/content/talk-schema";
import type { Talk } from "@/lib/content/talk-types";

const talkFixture: Talk = {
  slug: "ai-president-intro",
  title: "会社に、もう一人の社長がいたら。",
  speaker: "西山朝子",
  eventName: "THA AI社長 登壇セッション",
  published: true,
  scenes: [
    { id: "hero", type: "hero", heading: "会社に、もう一人の社長がいたら。" },
    {
      id: "quest",
      type: "questCta",
      heading: "診断",
      description: "3問でわかります",
      buttonLabel: "診断を始める",
    },
  ],
  questions: [
    {
      id: "question-1",
      prompt: "AIの活用状況を教えてください。",
      options: [{ label: "まだ使っていない", score: 0 }],
    },
    {
      id: "question-2",
      prompt: "知識は残っていますか。",
      options: [{ label: "まだ残っていない", score: 1 }],
    },
    {
      id: "question-3",
      prompt: "継続する仕組みはありますか。",
      options: [{ label: "担当者がいる", score: 2 }],
    },
  ],
  results: [
    {
      stage: "explore",
      title: "探索期",
      rpgSubtitle: "旅立ちの勇者",
      description: "最初の用途を見つける段階です。",
      nextQuest: "一つ試しましょう。",
    },
    {
      stage: "experiment",
      title: "実験期",
      rpgSubtitle: "魔法を試す勇者",
      description: "学びを残す段階です。",
      nextQuest: "共有しましょう。",
    },
    {
      stage: "systemize",
      title: "仕組み化期",
      rpgSubtitle: "ギルドを率いる勇者",
      description: "仕組みを整える段階です。",
      nextQuest: "振り返りましょう。",
    },
    {
      stage: "integrate",
      title: "経営統合期",
      rpgSubtitle: "AI社長と共創する勇者",
      description: "判断とつなぐ段階です。",
      nextQuest: "改善へ接続しましょう。",
    },
  ],
  lead: {
    downloadEnabled: true,
    downloadUrl: "/downloads/action-sheet.pdf",
    formHeading: "次の一歩を、会社の資産にする。",
    consentText: "同意文",
    thankYouMessage: "受け付けました。",
    consultationCta: "AI活用を相談する",
    privacyPolicyUrl: "/privacy",
  },
};

describe("validateTalk", () => {
  it("rejects duplicate scene and question IDs with their collection paths", () => {
    const duplicateScene = structuredClone(talkFixture);
    duplicateScene.scenes.push({ ...duplicateScene.scenes[0] });
    expect(() => validateTalk(duplicateScene)).toThrow(/scenes\[2\]\.id.*duplicate.*hero/i);

    const duplicateQuestion = structuredClone(talkFixture);
    duplicateQuestion.questions[1] = { ...duplicateQuestion.questions[0] };
    expect(() => validateTalk(duplicateQuestion)).toThrow(/questions\[1\]\.id.*duplicate.*question-1/i);
  });
  it("returns a structurally valid published Talk", () => {
    expect(validateTalk(talkFixture)).toEqual(talkFixture);
  });

  it("returns a Talk only when its slug matches the expected filename slug", () => {
    expect(validateTalkDocument(talkFixture, "ai-president-intro")).toEqual(talkFixture);
  });

  it("rejects a Talk whose slug differs from the expected filename slug", () => {
    expect(() => validateTalkDocument(talkFixture, "another-talk")).toThrow(
      "talk slug must match filename",
    );
  });

  it("rejects a published talk without three questions", () => {
    expect(() => validateTalk({ ...talkFixture, questions: [] })).toThrow(
      "published talk requires three questions",
    );
  });

  it("rejects a published talk without four results", () => {
    expect(() => validateTalk({ ...talkFixture, results: talkFixture.results.slice(0, 3) })).toThrow(
      "published talk requires four results",
    );
  });

  it("rejects a published talk with duplicate result stages", () => {
    expect(() => validateTalk({
      ...talkFixture,
      results: [
        ...talkFixture.results.slice(0, 3),
        { ...talkFixture.results[3], stage: "explore" },
      ],
    })).toThrow("published talk requires four unique result stages");
  });

  it("rejects a published talk without a hero scene", () => {
    expect(() => validateTalk({
      ...talkFixture,
      scenes: talkFixture.scenes.filter((scene) => scene.type !== "hero"),
    })).toThrow("published talk requires a hero scene");
  });

  it("rejects a published talk without a quest CTA scene", () => {
    expect(() => validateTalk({
      ...talkFixture,
      scenes: talkFixture.scenes.filter((scene) => scene.type !== "questCta"),
    })).toThrow("published talk requires a quest CTA scene");
  });

  it("rejects a case-study image without a nonempty accessible alternative", () => {
    expect(() => validateTalk({
      ...talkFixture,
      scenes: [
        ...talkFixture.scenes,
        {
          id: "case",
          type: "caseStudy",
          organization: "導入企業",
          challenge: "知識が属人化していた",
          approach: "判断を記録した",
          outcome: "学びを再利用できた",
          image: "/media/case-study.jpg",
        },
      ],
    })).toThrow("case study scene 3 alt must be a non-empty string when image is configured");
  });

  it.each([
    {
      id: "hero",
      type: "hero",
      heading: "危険な外部画像",
      image: "https://tracker.example/hero.webp",
      sourceNote: "テスト用",
    },
    {
      id: "hero",
      type: "hero",
      heading: "危険な埋め込み動画",
      video: "data:video/mp4;base64,unsafe",
      sourceNote: "テスト用",
    },
    {
      id: "photo",
      type: "photoStory",
      image: "/media/../photo.webp",
      alt: "危険な写真",
      sourceNote: "テスト用",
    },
    {
      id: "case",
      type: "caseStudy",
      organization: "導入企業",
      challenge: "課題",
      approach: "方法",
      outcome: "成果",
      image: "//tracker.example/case.jpg",
      alt: "危険な事例画像",
      sourceNote: "テスト用",
    },
  ])("rejects a non-local or unsafe scene media path: %o", (scene) => {
    expect(() => validateTalk({
      ...talkFixture,
      scenes: scene.type === "hero"
        ? [scene, talkFixture.scenes[1]]
        : [talkFixture.scenes[0], scene, talkFixture.scenes[1]],
    })).toThrow("must be a safe /media/");
  });

  it.each([
    { id: "hero", type: "hero", heading: "画像", image: "/media/hero.webp" },
    { id: "hero", type: "hero", heading: "動画", video: "/media/hero.mp4" },
    { id: "photo", type: "photoStory", image: "/media/photo.webp", alt: "写真" },
    {
      id: "case",
      type: "caseStudy",
      organization: "導入企業",
      challenge: "課題",
      approach: "方法",
      outcome: "成果",
      image: "/media/case.jpg",
      alt: "事例画像",
    },
  ])("rejects scene media without a publication/source note: %o", (scene) => {
    expect(() => validateTalk({
      ...talkFixture,
      scenes: scene.type === "hero"
        ? [scene, talkFixture.scenes[1]]
        : [talkFixture.scenes[0], scene, talkFixture.scenes[1]],
    })).toThrow("sourceNote is required when media is configured");
  });

  it.each([-1, 4, 1.5, "3"])('rejects an invalid option score: %s', (score) => {
    expect(() => validateTalk({
      ...talkFixture,
      questions: [{
        ...talkFixture.questions[0],
        options: [{ label: "選択肢", score }],
      }, ...talkFixture.questions.slice(1)],
    })).toThrow("question 1 option 1 score must be an integer from 0 to 3");
  });

  it("rejects an enabled download without a PDF", () => {
    expect(() => validateTalk({
      ...talkFixture,
      lead: { ...talkFixture.lead, downloadUrl: "" },
    })).toThrow("download PDF is required");
  });

  it.each([
    "https://example.com/action-sheet.pdf",
    "/downloads/../action-sheet.pdf",
    "/downloads/action-sheet.pdf?version=2",
    "/media/action-sheet.pdf",
  ])("rejects an unsafe enabled-download PDF URL: %s", (downloadUrl) => {
    expect(() => validateTalk({
      ...talkFixture,
      lead: { ...talkFixture.lead, downloadUrl },
    })).toThrow("download PDF URL must be a safe /downloads/*.pdf path");
  });

  it("accepts labeled additional PDF downloads", () => {
    expect(validateTalk({
      ...talkFixture,
      lead: {
        ...talkFixture.lead,
        additionalDownloads: [{
          label: "講演資料をダウンロード",
          url: "/downloads/ai-philosophy-deck.pdf",
        }],
      },
    }).lead.additionalDownloads).toEqual([{
      label: "講演資料をダウンロード",
      url: "/downloads/ai-philosophy-deck.pdf",
    }]);
  });

  it("accepts reusable presentation labels and stage downloads", () => {
    const configured = validateTalk({
      ...talkFixture,
      presentation: {
        heroKicker: "THA / TIME ASSETS",
        scrollPrompt: "SCROLL THROUGH 1450 YEARS",
        resultEyebrow: "YOUR TIME-ASSET STAGE",
        nextActionLabel: "FIRST STEP",
      },
      scenes: [
        talkFixture.scenes[0],
        {
          id: "crisis",
          type: "statement",
          statement: "この宝は、放っておくと蒸発する。",
          tone: "crisis",
        },
        {
          id: "case",
          type: "caseStudy",
          organization: "豆子郎",
          heading: "守ったもの、変えたもの",
          challenge: "継承",
          approach: "対話",
          outcome: "判断資産",
        },
        talkFixture.scenes[1],
      ],
      lead: {
        ...talkFixture.lead,
        stageDownloads: [
          { stage: "explore", url: "/downloads/explore.pdf" },
          { stage: "experiment", url: "/downloads/experiment.pdf" },
          { stage: "systemize", url: "/downloads/systemize.pdf" },
          { stage: "integrate", url: "/downloads/integrate.pdf" },
        ],
      },
    });

    expect(configured.presentation?.resultEyebrow).toBe("YOUR TIME-ASSET STAGE");
    expect(configured.lead.stageDownloads).toHaveLength(4);
  });

  it("accepts optional Talk-specific consultation copy and semantic topic options", () => {
    const configured = validateTalk({
      ...talkFixture,
      lead: {
        ...talkFixture.lead,
        consultationHeading: "会社らしさと時間資産の継承を相談する",
        consultationTopics: [
          { value: "succession", label: "次世代への事業承継について相談したい" },
          { value: "time-assets", label: "会社らしさ・判断資産の言語化について相談したい" },
          { value: "other", label: "その他" },
        ],
        consultationThankYouMessage: "ご相談を受け付けました。担当者よりご連絡します。",
      },
    });

    expect(configured.lead).toMatchObject({
      consultationHeading: "会社らしさと時間資産の継承を相談する",
      consultationTopics: [
        { value: "succession", label: "次世代への事業承継について相談したい" },
        { value: "time-assets", label: "会社らしさ・判断資産の言語化について相談したい" },
        { value: "other", label: "その他" },
      ],
      consultationThankYouMessage: "ご相談を受け付けました。担当者よりご連絡します。",
    });
  });

  it.each([
    [[
      { value: "succession", label: "事業承継" },
      { value: "succession", label: "重複" },
    ]],
    [[{ value: "unsupported", label: "未対応" }]],
    [[{ value: "time-assets", label: "" }]],
  ])("rejects unsafe or ambiguous consultation topic options: %o", (consultationTopics) => {
    expect(() => validateTalk({
      ...talkFixture,
      lead: { ...talkFixture.lead, consultationTopics },
    })).toThrow("consultation topics");
  });

  it("preserves an optional hero image source note", () => {
    const configured = validateTalk({
      ...talkFixture,
      scenes: [
        {
          ...talkFixture.scenes[0],
          sourceNote: "AI生成によるコンセプト画像（実在企業の写真ではありません）",
        },
        talkFixture.scenes[1],
      ],
    });

    expect(configured.scenes[0]).toMatchObject({
      type: "hero",
      sourceNote: "AI生成によるコンセプト画像（実在企業の写真ではありません）",
    });
  });

  it("preserves the optional TIME MESH Hero atmosphere", () => {
    const configured = validateTalk({
      ...talkFixture,
      scenes: [
        { ...talkFixture.scenes[0], atmosphere: "timeMesh" },
        talkFixture.scenes[1],
      ],
    });

    expect(configured.scenes[0]).toMatchObject({ type: "hero", atmosphere: "timeMesh" });
  });

  it("rejects an unsupported Hero atmosphere", () => {
    expect(() => validateTalk({
      ...talkFixture,
      scenes: [
        { ...talkFixture.scenes[0], atmosphere: "particleGlobe" },
        talkFixture.scenes[1],
      ],
    })).toThrow("hero scene 1 atmosphere must be timeMesh");
  });

  it("accepts an enabled download with complete stage downloads and no legacy download URL", () => {
    const configured = validateTalk({
      ...talkFixture,
      lead: {
        ...talkFixture.lead,
        downloadUrl: undefined,
        stageDownloads: [
          { stage: "explore", url: "/downloads/explore.pdf" },
          { stage: "experiment", url: "/downloads/experiment.pdf" },
          { stage: "systemize", url: "/downloads/systemize.pdf" },
          { stage: "integrate", url: "/downloads/integrate.pdf" },
        ],
      },
    });

    expect(configured.lead.downloadEnabled).toBe(true);
    expect(configured.lead.downloadUrl).toBeUndefined();
    expect(configured.lead.stageDownloads).toHaveLength(4);
  });

  it("rejects a statement scene tone other than default or crisis", () => {
    expect(() => validateTalk({
      ...talkFixture,
      scenes: [{ id: "bad", type: "statement", statement: "危機", tone: "danger" }, ...talkFixture.scenes],
    })).toThrow("statement scene 1 tone must be default or crisis");
  });

  it("rejects stage downloads without four unique diagnosis stages", () => {
    expect(() => validateTalk({
      ...talkFixture,
      lead: {
        ...talkFixture.lead,
        stageDownloads: [
          { stage: "explore", url: "/downloads/explore.pdf" },
          { stage: "explore", url: "/downloads/duplicate.pdf" },
        ],
      },
    })).toThrow("stage downloads require four unique diagnosis stages");
  });

  it("rejects a stage download outside the safe PDF path", () => {
    expect(() => validateTalk({
      ...talkFixture,
      lead: {
        ...talkFixture.lead,
        stageDownloads: [
          { stage: "explore", url: "https://evil.example/explore.pdf" },
          { stage: "experiment", url: "/downloads/experiment.pdf" },
          { stage: "systemize", url: "/downloads/systemize.pdf" },
          { stage: "integrate", url: "/downloads/integrate.pdf" },
        ],
      },
    })).toThrow("stage download PDF URL must be a safe /downloads/*.pdf path");
  });

  it.each([
    [{ label: "", url: "/downloads/deck.pdf" }],
    [{ label: "講演資料", url: "https://evil.example/deck.pdf" }],
  ])("rejects an invalid additional PDF download: %o", (additionalDownloads) => {
    expect(() => validateTalk({
      ...talkFixture,
      lead: { ...talkFixture.lead, additionalDownloads },
    })).toThrow();
  });

  it("rejects malformed CMS JSON with a clear validation error", () => {
    expect(() => validateTalk({
      ...talkFixture,
      questions: { unexpected: true },
    })).toThrow("questions must be an array");
  });

  it("rejects a non-object CMS document without leaking a TypeError", () => {
    expect(() => validateTalk(null)).toThrow("talk must be an object");
  });
});
