import { beforeEach, describe, expect, it, vi } from "vitest";

const routeDependencies = vi.hoisted(() => ({
  canRenderTalk: vi.fn(),
  getTalkBundle: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not found");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: routeDependencies.notFound }));
vi.mock("@/lib/content/talk-bundle-repository", () => ({ getTalkBundle: routeDependencies.getTalkBundle }));
vi.mock("@/lib/content/talk-visibility", () => ({ canRenderTalk: routeDependencies.canRenderTalk }));
vi.mock("@/components/handout/HandoutDocument", () => ({ HandoutDocument: () => null }));

import HandoutPage, {
  dynamicParams,
  generateStaticParams,
} from "@/app/talks/[slug]/handout/page";
import { publishedTalkParams } from "@/lib/content/static-talk-params";

describe("HandoutPage", () => {
  beforeEach(() => {
    routeDependencies.canRenderTalk.mockReset();
    routeDependencies.getTalkBundle.mockReset();
    routeDependencies.notFound.mockClear();
  });

  it("limits static generation to published Talk parameters", () => {
    expect(dynamicParams).toBe(false);
    expect(generateStaticParams).toBe(publishedTalkParams);
  });

  it("rejects a draft bundle when production visibility denies it", async () => {
    routeDependencies.getTalkBundle.mockResolvedValueOnce({ manifest: { published: false } });
    routeDependencies.canRenderTalk.mockReturnValueOnce(false);

    await expect(HandoutPage({ params: Promise.resolve({ slug: "draft" }) })).rejects.toThrow("not found");
    expect(routeDependencies.notFound).toHaveBeenCalledOnce();
  });

  it("renders a published bundle when production visibility permits it", async () => {
    routeDependencies.getTalkBundle.mockResolvedValueOnce({ manifest: { published: true } });
    routeDependencies.canRenderTalk.mockReturnValueOnce(true);

    await expect(HandoutPage({ params: Promise.resolve({ slug: "published" }) })).resolves.toBeTruthy();
    expect(routeDependencies.notFound).not.toHaveBeenCalled();
  });
});
