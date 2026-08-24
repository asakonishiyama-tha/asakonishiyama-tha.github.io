import { describe, expect, it } from "vitest";

import { createQuestUrl } from "@/lib/story/quest-url";

describe("createQuestUrl", () => {
  it.each([
    "https://example.com/presentation",
    "https://example.com/presentation/",
  ])("rejects a configured site URL with a pathname: %s", (siteUrl) => {
    expect(createQuestUrl({ slug: "ai 社長", siteUrl, browserOrigin: "https://event.example" })).toBeNull();
  });

  it("uses the browser origin only when the configured site URL is absent", () => {
    expect(createQuestUrl({ slug: "ai-president", browserOrigin: "https://event.example" })).toBe("https://event.example/talks/ai-president/quest");
    expect(createQuestUrl({ slug: "ai-president", siteUrl: "not a url", browserOrigin: "https://event.example" })).toBeNull();
  });

  it("does not produce a QR destination before any absolute base is known", () => {
    expect(createQuestUrl({ slug: "ai-president" })).toBeNull();
  });

  it("never throws for an invalid slug string", () => {
    expect(() => createQuestUrl({ slug: "\ud800", siteUrl: "https://event.example" })).not.toThrow();
    expect(createQuestUrl({ slug: "\ud800", siteUrl: "https://event.example" })).toBeNull();
  });
});
