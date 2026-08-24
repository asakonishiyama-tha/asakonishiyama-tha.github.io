import { beforeEach, vi } from "vitest";

const blockedFetch = vi.fn(async () => {
  throw new Error("Network access is disabled in unit tests.");
});

vi.stubGlobal("fetch", blockedFetch);

beforeEach(() => {
  blockedFetch.mockClear();
});
