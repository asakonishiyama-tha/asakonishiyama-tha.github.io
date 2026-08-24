import { afterEach, describe, expect, it } from "vitest";

import { captureFirstTouchAcquisition } from "@/lib/leads/acquisition";

const sessionStorageDescriptor = Object.getOwnPropertyDescriptor(window, "sessionStorage");

afterEach(() => {
  if (sessionStorageDescriptor) Object.defineProperty(window, "sessionStorage", sessionStorageDescriptor);
  sessionStorage.clear();
});

describe("first-touch acquisition", () => {
  it("persists only allowlisted bounded fields and excludes same-origin referrers", () => {
    const metadata = captureFirstTouchAcquisition("bounded-entry", {
      origin: "https://talk.example",
      referrer: "https://talk.example/internal?email=private@example.com",
      search: `?utm_source=${"s".repeat(240)}&utm_medium=email&utm_campaign=${encodeURIComponent("bad\nvalue")}&email=private@example.com&unexpected=secret`,
    });

    expect(metadata).toEqual({
      referrer: "",
      utmSource: "s".repeat(200),
      utmMedium: "email",
      utmCampaign: "",
    });
    expect(JSON.parse(sessionStorage.getItem("tha-hooked:bounded-entry:acquisition:v1") ?? "null")).toEqual(metadata);
    expect(sessionStorage.getItem("tha-hooked:bounded-entry:acquisition:v1")).not.toContain("private@example.com");
    expect(sessionStorage.getItem("tha-hooked:bounded-entry:acquisition:v1")).not.toContain("unexpected");
  });

  it("does not overwrite a Talk's first touch during later internal navigation", () => {
    const first = captureFirstTouchAcquisition("no-overwrite-entry", {
      origin: "https://talk.example",
      referrer: "https://conference.example/program",
      search: "?utm_source=first&utm_medium=qr&utm_campaign=launch",
    });
    const later = captureFirstTouchAcquisition("no-overwrite-entry", {
      origin: "https://talk.example",
      referrer: "https://talk.example/talks/no-overwrite-entry/quest",
      search: "?utm_source=forged-later",
    });

    expect(later).toEqual(first);
    expect(later).toEqual({
      referrer: "https://conference.example/program",
      utmSource: "first",
      utmMedium: "qr",
      utmCampaign: "launch",
    });
  });

  it("strips arbitrary query and fragment data from an external referrer", () => {
    const metadata = captureFirstTouchAcquisition("referrer-privacy", {
      origin: "https://talk.example",
      referrer: "https://conference.example/program?email=private@example.com#attendee",
      search: "",
    });

    expect(metadata.referrer).toBe("https://conference.example/program");
    expect(sessionStorage.getItem("tha-hooked:referrer-privacy:acquisition:v1")).not.toContain("private@example.com");
    expect(sessionStorage.getItem("tha-hooked:referrer-privacy:acquisition:v1")).not.toContain("attendee");
  });

  it("retains the memory fallback when storage reads succeed but writes fail", () => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => { throw new DOMException("quota", "QuotaExceededError"); },
      },
    });
    const first = captureFirstTouchAcquisition("write-blocked-entry", {
      origin: "https://talk.example",
      referrer: "https://conference.example/program",
      search: "?utm_source=first-touch",
    });

    const later = captureFirstTouchAcquisition("write-blocked-entry", {
      origin: "https://talk.example",
      referrer: "https://talk.example/internal",
      search: "?utm_source=later-navigation",
    });

    expect(later).toEqual(first);
    expect(later.utmSource).toBe("first-touch");
  });
});
