import { beforeEach, describe, expect, it, vi } from "vitest";

const routeDependencies = vi.hoisted(() => ({
  canRenderTalk: vi.fn(),
  getTalk: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: routeDependencies.notFound }));
vi.mock("@/lib/content/talk-repository", () => ({ getTalk: routeDependencies.getTalk }));
vi.mock("@/lib/content/talk-visibility", () => ({ canRenderTalk: routeDependencies.canRenderTalk }));
vi.mock("@/components/story/StoryRenderer", () => ({ StoryRenderer: () => null }));

import TalkPage, {
  dynamicParams,
  generateStaticParams,
} from "@/app/talks/[slug]/page";
import { publishedTalkParams } from "@/lib/content/static-talk-params";

describe("TalkPage", () => {
  beforeEach(() => {
    routeDependencies.canRenderTalk.mockReset();
    routeDependencies.getTalk.mockReset();
    routeDependencies.notFound.mockClear();
  });

  it("limits static generation to published Talk parameters", () => {
    expect(dynamicParams).toBe(false);
    expect(generateStaticParams).toBe(publishedTalkParams);
  });

  it("uses notFound for a missing talk", async () => {
    routeDependencies.getTalk.mockResolvedValueOnce(null);

    await expect(TalkPage({ params: Promise.resolve({ slug: "missing" }) })).rejects.toThrow("not found");
    expect(routeDependencies.notFound).toHaveBeenCalledOnce();
  });

  it("renders an unpublished talk when visibility permits it", async () => {
    routeDependencies.getTalk.mockResolvedValueOnce({ published: false });
    routeDependencies.canRenderTalk.mockReturnValueOnce(true);

    await expect(TalkPage({ params: Promise.resolve({ slug: "draft" }) })).resolves.toBeTruthy();
    expect(routeDependencies.notFound).not.toHaveBeenCalled();
  });

  it("uses notFound for an unpublished talk when visibility rejects it", async () => {
    routeDependencies.getTalk.mockResolvedValueOnce({ published: false });
    routeDependencies.canRenderTalk.mockReturnValueOnce(false);

    await expect(TalkPage({ params: Promise.resolve({ slug: "hidden" }) })).rejects.toThrow("not found");
    expect(routeDependencies.notFound).toHaveBeenCalledOnce();
  });
});
