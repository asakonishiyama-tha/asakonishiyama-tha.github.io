import { describe, expect, it } from "vitest";

import { scoreDiagnosis } from "@/lib/diagnosis/score";

describe("scoreDiagnosis", () => {
  it.each([
    [[0, 0, 0], "explore"],
    [[1, 1, 1], "experiment"],
    [[2, 2, 2], "systemize"],
    [[3, 3, 3], "integrate"],
  ] as const)("maps %j to %s", (answers, stage) => {
    expect(scoreDiagnosis(answers).stage).toBe(stage);
  });

  it.each([
    [[0, 0, 2], "explore"],
    [[1, 1, 1], "experiment"],
    [[3, 2, 0], "experiment"],
    [[2, 2, 2], "systemize"],
    [[3, 3, 1], "systemize"],
    [[3, 3, 2], "integrate"],
  ] as const)("maps transition boundary %j to %s", (answers, stage) => {
    expect(scoreDiagnosis(answers).stage).toBe(stage);
  });

  it("rejects answers outside 0..3", () => {
    expect(() => scoreDiagnosis([0, 1, 4])).toThrow("invalid answer");
  });

  it("rejects an answer list that does not contain three answers", () => {
    expect(() => scoreDiagnosis([0, 1])).toThrow("invalid answer");
  });

  it("rejects noninteger answers", () => {
    expect(() => scoreDiagnosis([0, 1, 1.5])).toThrow("invalid answer");
  });
});
