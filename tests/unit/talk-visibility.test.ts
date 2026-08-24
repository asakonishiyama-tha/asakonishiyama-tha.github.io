import { describe, expect, it } from "vitest";
import { canRenderTalk } from "@/lib/content/talk-visibility";

describe("canRenderTalk", () => {
  it.each([
    [{ published: true }, "production", true],
    [{ published: true }, "development", true],
    [{ published: false }, "development", true],
    [{ published: false }, "production", false],
    [{ published: false }, "test", false],
  ] as const)("returns %s in %s", (talk, environment, expected) => {
    expect(canRenderTalk(talk, environment)).toBe(expected);
  });
});
