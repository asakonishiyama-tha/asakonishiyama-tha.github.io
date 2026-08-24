import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Talk } from "@/lib/content/talk-types";
import { StoryRenderer } from "@/components/story/StoryRenderer";
import { CardsScene, CaseStudyScene, HeroScene, LeadCtaScene, PhotoStoryScene, QuestCtaScene, StatementScene } from "@/components/story/scenes";

vi.mock("motion/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("motion/react")>();
  return { ...actual, useReducedMotion: () => true };
});

const runtimeState = vi.hoisted(() => ({
  configuredSiteUrl: undefined as string | undefined,
  isStoryDevelopment: true,
}));

vi.mock("@/lib/story/runtime", () => ({
  get configuredSiteUrl() {
    return runtimeState.configuredSiteUrl;
  },
  get isStoryDevelopment() {
    return runtimeState.isStoryDevelopment;
  },
}));

class IntersectionObserverStub {
  disconnect() {}
  observe() {}
  takeRecords() { return []; }
  unobserve() {}
}

vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  runtimeState.configuredSiteUrl = undefined;
  runtimeState.isStoryDevelopment = true;
});

const talkFixture: Talk = {
  slug: "ai-president-intro",
  title: "AI社長",
  speaker: "西山朝子",
  eventName: "THA",
  published: true,
  scenes: [
    { id: "opening", type: "hero", heading: "会社に、もう一人の社長がいたら。" },
    { id: "knowledge", type: "cards", heading: "使うたび、会社に何が残るか。", cards: [] },
  ],
  questions: [],
  results: [],
  lead: {
    downloadEnabled: false,
    formHeading: "資料請求",
    consentText: "同意文",
    thankYouMessage: "完了",
    consultationCta: "相談する",
  },
};

describe("StoryRenderer", () => {
  it("renders configured presentation labels, case heading, and crisis tone", () => {
    render(<StoryRenderer talk={{
      ...talkFixture,
      presentation: {
        heroKicker: "THA / TIME ASSETS",
        scrollPrompt: "SCROLL THROUGH 1450 YEARS",
        resultEyebrow: "YOUR TIME-ASSET STAGE",
        nextActionLabel: "FIRST STEP",
      },
      scenes: [
        { id: "hero", type: "hero", heading: "御社らしさは、20年後も残るか。" },
        { id: "crisis", type: "statement", statement: "この宝は蒸発する。", tone: "crisis" },
        { id: "case", type: "caseStudy", organization: "豆子郎", heading: "守ったもの、変えたもの", challenge: "課題", approach: "実践", outcome: "変化" },
      ],
    }} />);

    expect(screen.getByText("THA / TIME ASSETS")).toBeVisible();
    expect(screen.getByText("SCROLL THROUGH 1450 YEARS")).toBeVisible();
    expect(screen.getByText("守ったもの、変えたもの")).toBeVisible();
    expect(screen.getByText("この宝は蒸発する。").closest("section")).toHaveAttribute("data-scene-tone", "crisis");
  });

  it("preserves the existing presentation and case-study labels by default", () => {
    render(<StoryRenderer talk={{
      ...talkFixture,
      scenes: [
        { id: "hero", type: "hero", heading: "会社に、もう一人の社長がいたら。" },
        { id: "case", type: "caseStudy", organization: "豆子郎", challenge: "課題", approach: "実践", outcome: "変化" },
      ],
    }} />);

    expect(screen.getByText("THA / AI PRESIDENT")).toBeVisible();
    expect(screen.getByText("SCROLL TO ACCUMULATE")).toBeVisible();
    expect(screen.getByRole("heading", { name: "豆子郎の強化魔法" })).toBeVisible();
  });

  it("visibly discloses the source of a configured hero concept image", () => {
    render(createElement(HeroScene, {
      scene: {
        id: "hero-concept",
        type: "hero",
        heading: "時間資産",
        image: "/media/time-assets.webp",
        sourceNote: "AI生成によるコンセプト画像（実在企業の写真ではありません）",
      },
    }));

    expect(screen.getByText("AI生成によるコンセプト画像（実在企業の写真ではありません）")).toBeVisible();
  });

  it("does not add a hero disclosure when an existing Talk omits it", () => {
    render(createElement(HeroScene, {
      scene: {
        id: "hero-existing",
        type: "hero",
        heading: "既存Talk",
        image: "/media/existing.webp",
      },
    }));

    expect(screen.queryByText("AI生成によるコンセプト画像（実在企業の写真ではありません）")).toBeNull();
  });

  it("renders the optional TIME MESH atmosphere as a static canvas for reduced motion", () => {
    const { container } = render(createElement(HeroScene, {
      scene: {
        id: "hero-time-mesh",
        type: "hero",
        heading: "時間資産",
        image: "/media/time-assets.webp",
        atmosphere: "timeMesh",
      },
    }));

    expect(container.querySelector("[data-hero-atmosphere='timeMesh']")).toHaveAttribute(
      "data-motion-state",
      "static",
    );
  });

  it("does not add an atmosphere canvas to existing Hero scenes", () => {
    const { container } = render(createElement(HeroScene, {
      scene: {
        id: "hero-without-atmosphere",
        type: "hero",
        heading: "既存Talk",
        image: "/media/existing.webp",
      },
    }));

    expect(container.querySelector("[data-hero-atmosphere]")).toBeNull();
  });

  it("assigns a distinct ambient motion language to every non-Hero scene family", () => {
    const { container } = render(<>
      <StatementScene scene={{ id: "statement", type: "statement", statement: "問い" }} />
      <CardsScene scene={{ id: "cards", type: "cards", heading: "知識", cards: [] }} />
      <PhotoStoryScene scene={{ id: "photo", type: "photoStory", image: "/photo.webp", alt: "写真" }} />
      <CaseStudyScene scene={{ id: "case", type: "caseStudy", organization: "企業", challenge: "課題", approach: "実践", outcome: "変化" }} />
      <QuestCtaScene scene={{ id: "quest", type: "questCta", heading: "診断", description: "説明", buttonLabel: "始める" }} talkSlug="talk" />
      <LeadCtaScene scene={{ id: "lead", type: "leadCta", heading: "次へ", description: "説明", downloadLabel: "資料", consultationLabel: "相談" }} talkSlug="talk" downloadEnabled={false} />
    </>);

    expect(Array.from(container.querySelectorAll("[data-scene-motion]")).map((node) => ({
      state: node.getAttribute("data-motion-state"),
      variant: node.getAttribute("data-scene-motion"),
    }))).toEqual([
      { state: "static", variant: "orbit" },
      { state: "static", variant: "timeline" },
      { state: "static", variant: "photo" },
      { state: "static", variant: "scan" },
      { state: "static", variant: "pulse" },
      { state: "static", variant: "pulse" },
    ]);
  });

  it("visibly distinguishes synthesis and case provenance when configured", () => {
    render(<>
      <CardsScene scene={{
        id: "five-soils",
        type: "cards",
        heading: "5つの土壌",
        cards: [],
        sourceNote: "THA SYNTHESIS / 元資料をもとにTHAが整理・解釈。",
      }} />
      <CaseStudyScene scene={{
        id: "case",
        type: "caseStudy",
        organization: "豆子郎",
        challenge: "課題",
        approach: "実践",
        outcome: "変化",
        sourceNote: "取材に基づく事例 / THAによる取材・書籍原稿。",
      }} />
    </>);

    expect(screen.getByText("THA SYNTHESIS / 元資料をもとにTHAが整理・解釈。")).toBeVisible();
    expect(screen.getByText("取材に基づく事例 / THAによる取材・書籍原稿。")).toBeVisible();
  });

  it("renders scenes in CMS order", () => {
    render(createElement(StoryRenderer, { talk: talkFixture }));

    const headings = screen.getAllByRole("heading").map((node) => node.textContent);
    expect(headings).toEqual(["会社に、もう一人の社長がいたら。", "使うたび、会社に何が残るか。"]);
  });

  it("skips an unknown scene and warns with its id in development", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unknownTalk = {
      ...talkFixture,
      scenes: [
        ...talkFixture.scenes,
        { id: "future-scene", type: "future" },
      ],
    } as unknown as Talk;

    render(createElement(StoryRenderer, { talk: unknownTalk }));

    expect(screen.queryByText("future-scene")).toBeNull();
    expect(warn).toHaveBeenCalledWith("Unknown story scene skipped: future-scene");
  });

  it("skips an unknown scene without a production warning", () => {
    runtimeState.isStoryDevelopment = false;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const unknownTalk = {
      ...talkFixture,
      scenes: [{ id: "future-scene", type: "future" }],
    } as unknown as Talk;

    render(createElement(StoryRenderer, { talk: unknownTalk }));

    expect(warn).not.toHaveBeenCalled();
  });

  it("renders an accessible video control above a fallback image and toggles playback", () => {
    const { container } = render(createElement(HeroScene, {
      scene: {
        id: "hero-video",
        type: "hero",
        heading: "動画のあるヒーロー",
        image: "/fallback.jpg",
        video: "/hero.mp4",
      },
    }));
    const video = container.querySelector("video");
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const control = screen.getByRole("button", { name: "映像を停止" });

    expect(video).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(control.className).toContain("videoControl");

    fireEvent.pause(video!);
    expect(screen.getByRole("button", { name: "映像を再生" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "映像を再生" }));
    expect(play).toHaveBeenCalledOnce();

    Object.defineProperty(video, "paused", { configurable: true, value: false });
    fireEvent.play(video!);
    fireEvent.click(screen.getByRole("button", { name: "映像を停止" }));
    expect(pause).toHaveBeenCalledOnce();
  });

  it("gives a supplied photo-story image a nonempty accessible alternative", () => {
    render(createElement(PhotoStoryScene, {
      scene: {
        id: "photo-story",
        type: "photoStory",
        image: "/media/team-workshop.jpg",
        alt: "ワークショップでAI活用の手順を共有する参加者",
      },
    }));

    expect(screen.getByRole("img", { name: "ワークショップでAI活用の手順を共有する参加者" })).toHaveAttribute("alt", "ワークショップでAI活用の手順を共有する参加者");
  });

  it("does not render a QR destination for a configured site URL with a pathname", () => {
    runtimeState.configuredSiteUrl = "https://example.com/presentation";

    render(createElement(QuestCtaScene, {
      talkSlug: "ai 社長",
      scene: {
        id: "quest",
        type: "questCta",
        heading: "診断",
        description: "診断を開始します",
        buttonLabel: "開始する",
      },
    }));

    expect(screen.queryByRole("link", { name: "開始する" })).toBeNull();
    expect(screen.getByText("診断リンクを準備中")).toBeTruthy();
    expect(screen.queryByLabelText("スマートフォンで診断を開くQRコード")).toBeNull();
  });

  it("routes lead CTAs through a valid diagnosis result while preserving intent and Talk", () => {
    render(createElement(LeadCtaScene, {
      talkSlug: "ai-president-intro",
      downloadEnabled: true,
      scene: {
        id: "lead",
        type: "leadCta",
        heading: "次の一歩",
        description: "診断結果から選べます",
        downloadLabel: "詳細資料を請求する",
        consultationLabel: "AI活用を相談する",
      },
    }));

    expect(screen.getByRole("link", { name: "詳細資料を請求する" })).toHaveAttribute(
      "href",
      "/talks/ai-president-intro/result?intent=download",
    );
    expect(screen.getByRole("link", { name: "AI活用を相談する" })).toHaveAttribute(
      "href",
      "/talks/ai-president-intro/result?intent=consultation",
    );
  });
});
