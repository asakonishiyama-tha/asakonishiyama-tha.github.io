import { afterEach, describe, expect, it, vi } from "vitest";

import { trackEvent, trackEventOnce, type AnalyticsEventName, type AnalyticsProperties } from "@/lib/analytics/track";

type DataLayerWindow = { dataLayer?: Array<Record<string, unknown>> };
const sessionStorageDescriptor = Object.getOwnPropertyDescriptor(window, "sessionStorage");

function withDataLayer() {
  const dataLayer: Array<Record<string, unknown>> = [];
  (window as unknown as DataLayerWindow).dataLayer = dataLayer;
  return dataLayer;
}

afterEach(() => {
  vi.unstubAllGlobals();
  if (sessionStorageDescriptor) {
    Object.defineProperty(window, "sessionStorage", sessionStorageDescriptor);
  } else {
    Reflect.deleteProperty(window, "sessionStorage");
  }
  sessionStorage.clear();
  delete (window as unknown as DataLayerWindow).dataLayer;
});

describe("trackEvent", () => {
  it("only emits the approved event and property keys", () => {
    const dataLayer = withDataLayer();
    const eventName: AnalyticsEventName = "result_view";
    // A future change that permits contact data in this public boundary must fail typechecking.
    const forbiddenProperties: AnalyticsProperties = {
      talkSlug: "ai-president-intro",
      // @ts-expect-error Analytics properties intentionally do not accept personal data.
      companyName: "E2E Company",
      name: "E2E Visitor",
      email: "visitor@example.com",
      answerLabel: "private answer",
    };

    trackEvent(eventName, { ...forbiddenProperties, resultStage: "experiment" } as never);

    expect(dataLayer).toEqual([{
      event: "result_view",
      talkSlug: "ai-president-intro",
      resultStage: "experiment",
    }]);
    expect(Object.keys(dataLayer[0] ?? {})).toEqual(["event", "talkSlug", "resultStage"]);
    expect(JSON.stringify(dataLayer)).not.toContain("E2E Company");
    expect(JSON.stringify(dataLayer)).not.toContain("E2E Visitor");
    expect(JSON.stringify(dataLayer)).not.toContain("visitor@example.com");
    expect(JSON.stringify(dataLayer)).not.toContain("private answer");
  });

  it("does nothing during SSR or when no data layer has been installed", () => {
    vi.stubGlobal("window", undefined);
    expect(() => trackEvent("talk_view", { talkSlug: "ai-president-intro" })).not.toThrow();

    vi.unstubAllGlobals();
    expect(() => trackEvent("talk_view", { talkSlug: "ai-president-intro" })).not.toThrow();
  });

  it("rejects runtime event, slug, and result-stage values outside the allowlists", () => {
    const dataLayer = withDataLayer();

    trackEvent("visitor_email_captured" as AnalyticsEventName, { talkSlug: "ai-president-intro" });
    trackEvent("talk_view", { talkSlug: "../../private" });
    trackEvent("result_view", { talkSlug: "ai-president-intro", resultStage: "unknown" as never });

    expect(dataLayer).toEqual([]);
  });

  it("pushes exactly one object for one valid call", () => {
    const dataLayer = withDataLayer();
    const push = vi.spyOn(dataLayer, "push");

    trackEvent("quest_complete", { talkSlug: "ai-president-intro", resultStage: "experiment" });

    expect(push).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith({
      event: "quest_complete",
      talkSlug: "ai-president-intro",
      resultStage: "experiment",
    });
  });

  it("dedupes one anonymous lifecycle event for the current tab session", () => {
    const dataLayer = withDataLayer();

    trackEventOnce("result_view", { talkSlug: "analytics-session", resultStage: "experiment" });
    trackEventOnce("result_view", { talkSlug: "analytics-session", resultStage: "experiment" });

    expect(dataLayer).toEqual([{ event: "result_view", talkSlug: "analytics-session", resultStage: "experiment" }]);
    expect([...Array(sessionStorage.length)].map((_, index) => sessionStorage.key(index))).toEqual([
      expect.stringMatching(/^tha-hooked:analytics:v1:/),
    ]);
    expect(JSON.stringify(sessionStorage)).not.toContain("email");
  });

  it("emits different anonymous keys for different talk, stage, and event combinations", () => {
    const dataLayer = withDataLayer();

    trackEventOnce("result_view", { talkSlug: "analytics-distinct-a", resultStage: "experiment" });
    trackEventOnce("result_view", { talkSlug: "analytics-distinct-a", resultStage: "systemize" });
    trackEventOnce("result_view", { talkSlug: "analytics-distinct-b", resultStage: "experiment" });
    trackEventOnce("download_form_view", { talkSlug: "analytics-distinct-a", resultStage: "experiment" });

    expect(dataLayer).toEqual([
      { event: "result_view", talkSlug: "analytics-distinct-a", resultStage: "experiment" },
      { event: "result_view", talkSlug: "analytics-distinct-a", resultStage: "systemize" },
      { event: "result_view", talkSlug: "analytics-distinct-b", resultStage: "experiment" },
      { event: "download_form_view", talkSlug: "analytics-distinct-a", resultStage: "experiment" },
    ]);
  });

  it("keeps deduping in memory when session storage rejects reads and writes", () => {
    const dataLayer = withDataLayer();
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: {
        getItem: () => { throw new DOMException("storage unavailable", "SecurityError"); },
        setItem: () => { throw new DOMException("storage unavailable", "QuotaExceededError"); },
      } as unknown as Storage,
    });

    expect(() => {
      trackEventOnce("quest_start", { talkSlug: "analytics-storage-fallback" });
      trackEventOnce("quest_start", { talkSlug: "analytics-storage-fallback" });
    }).not.toThrow();
    expect(dataLayer).toEqual([{ event: "quest_start", talkSlug: "analytics-storage-fallback" }]);
  });
});
