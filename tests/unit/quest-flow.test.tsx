import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QuestFlow } from "@/components/quest/QuestFlow";
import { ResultLoader, ResultView } from "@/components/quest/ResultView";
import type { Talk } from "@/lib/content/talk-types";
import { loadAnswers, saveAnswers } from "@/lib/diagnosis/session";

const replace = vi.fn();
const router = { replace };
const sessionStorageDescriptor = Object.getOwnPropertyDescriptor(window, "sessionStorage");

function makeSessionStorageUnavailable(name: "SecurityError" | "QuotaExceededError") {
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("storage unavailable", name);
      },
    } as unknown as Storage,
  });
}

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

const talkFixture: Talk = {
  slug: "ai-president-intro",
  title: "AI社長",
  speaker: "西山朝子",
  eventName: "THA AI社長 登壇セッション",
  published: true,
  scenes: [],
  questions: [
    {
      id: "adoption",
      prompt: "AIは、経営のどこまで入っていますか。",
      options: [
        { label: "まだ利用していない", score: 0 },
        { label: "個人の業務効率化で利用している", score: 1 },
      ],
    },
    {
      id: "knowledge",
      prompt: "AIを使った後、会社に何が残っていますか。",
      options: [
        { label: "再利用できるものは残っていない", score: 0 },
        { label: "個人のプロンプトやメモが残っている", score: 1 },
      ],
    },
    {
      id: "continuity",
      prompt: "AI活用を継続する仕組みはありますか。",
      options: [
        { label: "必要なときだけ各自で使う", score: 0 },
        { label: "推進する担当者がいる", score: 1 },
      ],
    },
  ],
  results: [
    { stage: "explore", title: "探索期", rpgSubtitle: "旅立ちの勇者", description: "最初の用途を見つける段階です。", nextQuest: "一つ試しましょう。" },
    { stage: "experiment", title: "実験期", rpgSubtitle: "魔法を試す勇者", description: "学びを残す段階です。", nextQuest: "共有しましょう。" },
    { stage: "systemize", title: "仕組み化期", rpgSubtitle: "ギルドを率いる勇者", description: "継続する段階です。", nextQuest: "振り返りましょう。" },
    { stage: "integrate", title: "経営統合期", rpgSubtitle: "AI社長と共創する勇者", description: "判断資産を磨く段階です。", nextQuest: "改善につなげましょう。" },
  ],
  lead: {
    downloadEnabled: false,
    formHeading: "資料請求",
    consentText: "同意文",
    thankYouMessage: "完了",
    consultationCta: "AI活用を相談する",
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (sessionStorageDescriptor) {
    Object.defineProperty(window, "sessionStorage", sessionStorageDescriptor);
  } else {
    Reflect.deleteProperty(window, "sessionStorage");
  }
  cleanup();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/");
  Object.defineProperty(document, "referrer", { configurable: true, value: "" });
  replace.mockReset();
});

describe("QuestFlow", () => {
  it("shows a result link and saves only after the third answer", async () => {
    const user = userEvent.setup();
    render(<QuestFlow talk={talkFixture} />);

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
    await user.click(screen.getByRole("button", { name: "個人の業務効率化で利用している" }));
    expect(loadAnswers(talkFixture.slug)).toBeNull();
    expect(screen.getByText("QUEST 2 / 3")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "個人のプロンプトやメモが残っている" }));
    expect(loadAnswers(talkFixture.slug)).toBeNull();
    await user.click(screen.getByRole("button", { name: "推進する担当者がいる" }));

    expect(screen.getByRole("link", { name: "診断結果を見る" })).toHaveAttribute("href", "/talks/ai-president-intro/result");
    expect(loadAnswers(talkFixture.slug)).toEqual([1, 1, 1]);
  });

  it("lets a visitor go back and replace a prior answer before completing", async () => {
    const user = userEvent.setup();
    render(<QuestFlow talk={talkFixture} />);

    await user.click(screen.getByRole("button", { name: "個人の業務効率化で利用している" }));
    await user.click(screen.getByRole("button", { name: "個人のプロンプトやメモが残っている" }));
    await user.click(screen.getByRole("button", { name: "前の質問へ" }));
    await user.click(screen.getByRole("button", { name: "前の質問へ" }));
    expect(screen.getByRole("button", { name: "まだ利用していない" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "個人の業務効率化で利用している" })).toHaveAttribute("aria-pressed", "true");

    await user.click(screen.getByRole("button", { name: "まだ利用していない" }));
    await user.click(screen.getByRole("button", { name: "個人のプロンプトやメモが残っている" }));
    await user.click(screen.getByRole("button", { name: "推進する担当者がいる" }));

    expect(loadAnswers(talkFixture.slug)).toEqual([0, 1, 1]);
  });

  it("keeps the computed result visible when session storage rejects a keyboard completion", async () => {
    const user = userEvent.setup();
    makeSessionStorageUnavailable("SecurityError");
    render(<QuestFlow talk={talkFixture} />);

    await user.click(screen.getByRole("button", { name: "個人の業務効率化で利用している" }));
    await user.click(screen.getByRole("button", { name: "個人のプロンプトやメモが残っている" }));
    screen.getByRole("button", { name: "推進する担当者がいる" }).focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("heading", { name: "実験期" })).toBeVisible();
    expect(screen.getByText("この端末では診断結果を続けて開けません。結果をメモして、もう一度診断してください。")).toBeVisible();
    expect(screen.queryByRole("link", { name: "診断結果を見る" })).toBeNull();
  });
});

describe("diagnosis session", () => {
  it("isolates saved answers by slug and safely rejects corrupt storage", () => {
    saveAnswers("talk-a", [0, 1, 2]);
    saveAnswers("talk-b", [3, 2, 1]);
    sessionStorage.setItem("tha-hooked:broken:answers", "{not-json");
    sessionStorage.setItem("tha-hooked:wrong:answers", JSON.stringify([0, 1, 9]));

    expect(loadAnswers("talk-a")).toEqual([0, 1, 2]);
    expect(loadAnswers("talk-b")).toEqual([3, 2, 1]);
    expect(loadAnswers("broken")).toBeNull();
    expect(loadAnswers("wrong")).toBeNull();
  });

  it.each(["SecurityError", "QuotaExceededError"] as const)("returns false instead of throwing when %s prevents saving", (name) => {
    makeSessionStorageUnavailable(name);

    expect(saveAnswers("blocked", [0, 1, 2])).toBe(false);
    expect(loadAnswers("blocked")).toBeNull();
  });

  it("is safe to render without a browser window", () => {
    vi.stubGlobal("window", undefined);

    expect(saveAnswers("server", [0, 1, 2])).toBe(false);
    expect(loadAnswers("server")).toBeNull();
    expect(() => renderToStaticMarkup(<QuestFlow talk={talkFixture} />)).not.toThrow();
  });
});

describe("ResultView", () => {
  it("maps the scored stage to CMS result copy and a consultation action", () => {
    render(<ResultView talk={talkFixture} result={{ total: 3, stage: "experiment" }} />);

    expect(screen.getByRole("heading", { name: "実験期" })).toBeVisible();
    expect(screen.getByText("魔法を試す勇者")).toBeVisible();
    expect(screen.getByText("学びを残す段階です。")).toBeVisible();
    expect(screen.getByText("共有しましょう。")).toBeVisible();
    expect(screen.queryByRole("button", { name: "個別アクションシートを受け取る" })).toBeNull();
    expect(screen.getByRole("button", { name: "AI活用を相談する" })).toBeVisible();
  });

  it("returns to the quest route when the stored answers are absent or invalid", () => {
    const { unmount } = render(<ResultLoader talk={talkFixture} />);
    expect(replace).toHaveBeenCalledWith("/talks/ai-president-intro/quest");

    replace.mockReset();
    unmount();
    sessionStorage.setItem("tha-hooked:ai-president-intro:answers", JSON.stringify([0, 1, 5]));
    render(<ResultLoader talk={talkFixture} />);
    expect(replace).toHaveBeenCalledWith("/talks/ai-president-intro/quest");
  });

  it("captures first touch on a direct result entry before redirecting to the quest", () => {
    const directTalk = { ...talkFixture, slug: "direct-result-entry" };
    window.history.replaceState({}, "", "/talks/direct-result-entry/result?intent=consultation&utm_source=direct-result&utm_medium=email&utm_campaign=follow-up");
    Object.defineProperty(document, "referrer", { configurable: true, value: "https://newsletter.example/archive?subscriber=private" });

    render(<ResultLoader talk={directTalk} initialIntent="consultation" />);

    expect(replace).toHaveBeenCalledWith("/talks/direct-result-entry/quest?intent=consultation");
    expect(JSON.parse(sessionStorage.getItem("tha-hooked:direct-result-entry:acquisition:v1") ?? "null")).toEqual({
      referrer: "https://newsletter.example/archive",
      utmSource: "direct-result",
      utmMedium: "email",
      utmCampaign: "follow-up",
    });
  });

  it("recomputes the stored score before mapping the result", () => {
    sessionStorage.setItem("tha-hooked:ai-president-intro:answers", JSON.stringify([1, 1, 1]));
    render(<ResultLoader talk={talkFixture} />);

    expect(screen.getByRole("heading", { name: "実験期" })).toBeVisible();
  });
});
