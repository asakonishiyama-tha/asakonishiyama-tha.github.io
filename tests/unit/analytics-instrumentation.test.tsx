import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LeadForm } from "@/components/lead/LeadForm";
import { QuestFlow } from "@/components/quest/QuestFlow";
import { ResultView } from "@/components/quest/ResultView";
import { StoryRenderer } from "@/components/story/StoryRenderer";
import type { Talk } from "@/lib/content/talk-types";

type DataLayerWindow = { dataLayer?: Array<Record<string, unknown>> };

class IntersectionObserverStub {
  disconnect() {}
  observe() {}
  takeRecords() { return []; }
  unobserve() {}
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
});

const talk: Talk = {
  slug: "ai-president-intro",
  title: "AI社長",
  speaker: "西山朝子",
  eventName: "THA AI社長 登壇セッション",
  published: true,
  scenes: [{ id: "hero", type: "hero", heading: "会社に、もう一人の社長がいたら。" }],
  questions: [
    { id: "adoption", prompt: "AIは、経営のどこまで入っていますか。", options: [{ label: "個人の業務効率化で利用している", score: 1 }] },
    { id: "knowledge", prompt: "AIを使った後、会社に何が残っていますか。", options: [{ label: "個人のプロンプトやメモが残っている", score: 1 }] },
    { id: "continuity", prompt: "AI活用を継続する仕組みはありますか。", options: [{ label: "推進する担当者がいる", score: 1 }] },
  ],
  results: [{ stage: "experiment", title: "実験期", rpgSubtitle: "魔法を試す勇者", description: "学びを残す段階です。", nextQuest: "共有しましょう。" }],
  lead: {
    downloadEnabled: true,
    downloadUrl: "/downloads/tha-ai-management-action-sheet.pdf",
    formHeading: "次の一歩を、会社の資産にする。",
    consentText: "同意文",
    thankYouMessage: "お申し込みを受け付けました。",
    consultationCta: "AI活用を相談する",
  },
};

const excludedDraftSlug = ["long", "lived", "companies"].join("-");
const longLivedTalk: Talk = {
  ...talk,
  slug: excludedDraftSlug,
  title: "御社らしさは、20年後も残るか。",
  published: false,
  scenes: [{ id: "hero", type: "hero", heading: "御社らしさは、20年後も残るか。" }],
  questions: [
    { id: "language", prompt: "御社らしさを語れますか。", options: [{ label: "一部の社員が具体例と一緒に語れる", score: 2 }] },
    { id: "decision-assets", prompt: "判断理由は残っていますか。", options: [{ label: "成功・失敗事例と採否理由が共有されている", score: 2 }] },
    { id: "succession", prompt: "次の世代が再現できますか。", options: [{ label: "若手が過去事例を参照し、自分で判断できる", score: 2 }] },
  ],
  results: [{ stage: "systemize", title: "浸透期", rpgSubtitle: "言葉を日々の仕事へ広げる段階", description: "共有されています。", nextQuest: "判断事例を更新しましょう。" }],
};

function installDataLayer() {
  const dataLayer: Array<Record<string, unknown>> = [];
  (window as unknown as DataLayerWindow).dataLayer = dataLayer;
  return dataLayer;
}

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("会社名"), "THA株式会社");
  await user.type(screen.getByLabelText("お名前"), "西山朝子");
  await user.type(screen.getByLabelText("メールアドレス"), "asako@example.com");
  await user.click(screen.getByLabelText(/個人情報の取り扱いに同意する/));
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  delete (window as unknown as DataLayerWindow).dataLayer;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("anonymous lifecycle instrumentation", () => {
  it("tracks the long-lived Talk lifecycle as anonymous systemize events", async () => {
    const user = userEvent.setup();
    const dataLayer = installDataLayer();
    const story = render(<StoryRenderer talk={longLivedTalk} />);
    story.unmount();

    const quest = render(<QuestFlow talk={longLivedTalk} />);
    const answerLabels = longLivedTalk.questions.map((question) => question.options[0]!.label);
    for (const label of answerLabels) {
      await user.click(screen.getByRole("button", { name: label }));
    }
    quest.unmount();
    render(<ResultView talk={longLivedTalk} result={{ total: 6, stage: "systemize" }} />);

    expect(dataLayer).toEqual([
      { event: "talk_view", talkSlug: excludedDraftSlug },
      { event: "quest_start", talkSlug: excludedDraftSlug },
      { event: "quest_complete", talkSlug: excludedDraftSlug, resultStage: "systemize" },
      { event: "result_view", talkSlug: excludedDraftSlug, resultStage: "systemize" },
    ]);
    for (const payload of dataLayer) {
      expect(payload).not.toHaveProperty("companyName");
      expect(payload).not.toHaveProperty("name");
      expect(payload).not.toHaveProperty("email");
      for (const label of answerLabels) {
        expect(JSON.stringify(payload)).not.toContain(label);
      }
    }
  });

  it("tracks a talk view once despite Strict Mode remounts and rerenders", () => {
    const dataLayer = installDataLayer();
    const { rerender } = render(<StrictMode><StoryRenderer talk={talk} /></StrictMode>);

    rerender(<StrictMode><StoryRenderer talk={{ ...talk }} /></StrictMode>);

    expect(dataLayer).toEqual([{ event: "talk_view", talkSlug: "ai-president-intro" }]);
  });

  it("does not repeat a talk view after an actual unmount and fresh render in the same tab", () => {
    const dataLayer = installDataLayer();
    const remountTalk = { ...talk, slug: "analytics-remount" };
    const firstMount = render(<StoryRenderer talk={remountTalk} />);

    firstMount.unmount();
    render(<StoryRenderer talk={{ ...remountTalk }} />);

    expect(dataLayer).toEqual([{ event: "talk_view", talkSlug: "analytics-remount" }]);
  });

  it("tracks a quest start and completion once even when a visitor goes back to edit", async () => {
    const user = userEvent.setup();
    const dataLayer = installDataLayer();
    render(<StrictMode><QuestFlow talk={talk} /></StrictMode>);

    await user.click(screen.getByRole("button", { name: "個人の業務効率化で利用している" }));
    await user.click(screen.getByRole("button", { name: "個人のプロンプトやメモが残っている" }));
    await user.click(screen.getByRole("button", { name: "推進する担当者がいる" }));
    await user.click(screen.getByRole("button", { name: "回答を見直す" }));
    await user.click(screen.getByRole("button", { name: "推進する担当者がいる" }));

    expect(dataLayer).toEqual([
      { event: "quest_start", talkSlug: "ai-president-intro" },
      { event: "quest_complete", talkSlug: "ai-president-intro", resultStage: "experiment" },
    ]);
  });

  it("tracks each result form view once when the visitor switches forms", async () => {
    const user = userEvent.setup();
    const dataLayer = installDataLayer();
    render(<StrictMode><ResultView talk={talk} result={{ total: 3, stage: "experiment" }} /></StrictMode>);

    await user.click(screen.getByRole("button", { name: "個別アクションシートを受け取る" }));
    await user.click(screen.getByRole("button", { name: "AI活用を相談する" }));
    await user.click(screen.getByRole("button", { name: "個別アクションシートを受け取る" }));

    expect(dataLayer).toEqual([
      { event: "result_view", talkSlug: "ai-president-intro", resultStage: "experiment" },
      { event: "download_form_view", talkSlug: "ai-president-intro", resultStage: "experiment" },
      { event: "consultation_form_view", talkSlug: "ai-president-intro", resultStage: "experiment" },
    ]);
  });

  it.each([
    ["download", "download_form_view"],
    ["consultation", "consultation_form_view"],
  ] as const)("tracks an initially visible %s form exactly once", (initialIntent, expectedEvent) => {
    const dataLayer = installDataLayer();
    const initialTalk = { ...talk, slug: `initial-${initialIntent}-intent` };
    const { rerender } = render(
      <StrictMode>
        <ResultView talk={initialTalk} result={{ total: 3, stage: "experiment" }} initialIntent={initialIntent} />
      </StrictMode>,
    );

    rerender(
      <StrictMode>
        <ResultView talk={{ ...initialTalk }} result={{ total: 3, stage: "experiment" }} initialIntent={initialIntent} />
      </StrictMode>,
    );

    expect(dataLayer).toEqual([
      { event: "result_view", talkSlug: initialTalk.slug, resultStage: "experiment" },
      { event: expectedEvent, talkSlug: initialTalk.slug, resultStage: "experiment" },
    ]);
  });

  it("does not emit a submission-success event while lead collection is unavailable", async () => {
    const user = userEvent.setup();
    const dataLayer = installDataLayer();
    render(<StrictMode><LeadForm intent="download" talkSlug={talk.slug} eventName={talk.eventName} resultStage="experiment" consentText={talk.lead.consentText} downloadUrl={talk.lead.downloadUrl} /></StrictMode>);

    await fillRequiredFields(user);
    expect(screen.getByRole("button", { name: "資料を受け取る" })).toBeDisabled();

    expect(dataLayer).toEqual([]);
    expect(JSON.stringify(dataLayer)).not.toContain("asako@example.com");
    expect(JSON.stringify(dataLayer)).not.toContain("THA株式会社");
    expect(JSON.stringify(dataLayer)).not.toContain("西山朝子");
  });
});
