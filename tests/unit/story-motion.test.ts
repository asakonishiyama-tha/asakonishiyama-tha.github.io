import { describe, expect, it } from "vitest";

import { getSceneRevealProps } from "@/lib/story/motion";

describe("getSceneRevealProps", () => {
  it("does not return transform animation props when reduced motion is requested", () => {
    expect(getSceneRevealProps(true)).toBeUndefined();
  });

  it("returns the scene reveal transform when motion is allowed", () => {
    expect(getSceneRevealProps(false)).toMatchObject({ initial: { opacity: 0, y: 30 } });
  });
});
