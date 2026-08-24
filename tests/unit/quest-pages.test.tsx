import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, within } from "@testing-library/react";
import type { Talk } from "@/lib/content/talk-types";

const routeDependencies = vi.hoisted(() => ({
  canRenderTalk: vi.fn(),
  getTalk: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
  useSearchParams: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: routeDependencies.notFound,
  useSearchParams: routeDependencies.useSearchParams,
}));
vi.mock("@/lib/content/talk-repository", () => ({ getTalk: routeDependencies.getTalk }));
vi.mock("@/lib/content/talk-visibility", () => ({ canRenderTalk: routeDependencies.canRenderTalk }));
vi.mock("@/components/quest/QuestFlow", () => ({
  QuestFlow: ({ intent }: { intent?: string }) => <div data-testid="quest-intent">{intent ?? "none"}</div>,
}));
vi.mock("@/components/quest/ResultView", () => ({
  ResultLoader: ({ initialIntent }: { initialIntent?: string }) => <div data-testid="result-intent">{initialIntent ?? "none"}</div>,
}));

import QuestPage, {
  dynamicParams as questDynamicParams,
  generateStaticParams as generateQuestStaticParams,
} from "@/app/talks/[slug]/quest/page";
import ResultPage, {
  dynamicParams as resultDynamicParams,
  generateStaticParams as generateResultStaticParams,
} from "@/app/talks/[slug]/result/page";
import { publishedTalkParams } from "@/lib/content/static-talk-params";
import { IntentAwareQuest } from "@/components/quest/IntentAwareQuest";
import { IntentAwareResult } from "@/components/quest/IntentAwareResult";

const excludedDraftSlug = ["long", "lived", "companies"].join("-");
const talk: Talk = {
  slug: "ai-president-intro",
  title: "会社に、もう一人の社長がいたら。",
  speaker: "西山朝子",
  eventName: "THA Talk",
  published: true,
  scenes: [],
  questions: [],
  results: [],
  lead: {
    downloadEnabled: false,
    formHeading: "資料請求",
    consentText: "同意します",
    thankYouMessage: "ありがとうございます",
    consultationCta: "相談する",
  },
};

describe("diagnosis routes", () => {
  beforeEach(() => {
    routeDependencies.canRenderTalk.mockReset();
    routeDependencies.getTalk.mockReset();
    routeDependencies.notFound.mockClear();
    routeDependencies.useSearchParams.mockReset();
  });

  it("limits quest and result generation to published Talk parameters", () => {
    expect(questDynamicParams).toBe(false);
    expect(resultDynamicParams).toBe(false);
    expect(generateQuestStaticParams).toBe(publishedTalkParams);
    expect(generateResultStaticParams).toBe(publishedTalkParams);
  });

  it.each([
    [IntentAwareQuest, "quest-intent"],
    [IntentAwareResult, "result-intent"],
  ] as const)("passes a validated consultation intent from the browser query", (Wrapper, testId) => {
    routeDependencies.useSearchParams.mockReturnValue(new URLSearchParams("intent=consultation"));

    const view = render(<Wrapper talk={talk} />);

    expect(within(view.container).getByTestId(testId)).toHaveTextContent("consultation");
  });

  it.each([
    [IntentAwareQuest, "quest-intent"],
    [IntentAwareResult, "result-intent"],
  ] as const)("drops an unsupported browser intent", (Wrapper, testId) => {
    routeDependencies.useSearchParams.mockReturnValue(new URLSearchParams("intent=admin"));

    const view = render(<Wrapper talk={talk} />);

    expect(within(view.container).getByTestId(testId)).toHaveTextContent("none");
  });

  it.each([QuestPage, ResultPage])("rejects a missing talk", async (Page) => {
    routeDependencies.getTalk.mockResolvedValueOnce(null);

    await expect(Page({ params: Promise.resolve({ slug: "missing" }) })).rejects.toThrow("not found");
    expect(routeDependencies.notFound).toHaveBeenCalledOnce();
  });

  it.each([QuestPage, ResultPage])("renders an unpublished talk when visibility permits it", async (Page) => {
    routeDependencies.getTalk.mockResolvedValueOnce({ published: false });
    routeDependencies.canRenderTalk.mockReturnValueOnce(true);

    await expect(Page({ params: Promise.resolve({ slug: "draft" }) })).resolves.toBeTruthy();
    expect(routeDependencies.notFound).not.toHaveBeenCalled();
  });

  it.each([QuestPage, ResultPage])(`rejects ${excludedDraftSlug} when production visibility rejects it`, async (Page) => {
    routeDependencies.getTalk.mockResolvedValueOnce({ published: false });
    routeDependencies.canRenderTalk.mockReturnValueOnce(false);

    await expect(Page({ params: Promise.resolve({ slug: excludedDraftSlug }) })).rejects.toThrow("not found");
    expect(routeDependencies.notFound).toHaveBeenCalledOnce();
  });
});
