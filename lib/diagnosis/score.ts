export type DiagnosisStage = "explore" | "experiment" | "systemize" | "integrate";

export type DiagnosisResult = {
  total: number;
  stage: DiagnosisStage;
};

export function scoreDiagnosis(answers: readonly number[]): DiagnosisResult {
  if (
    answers.length !== 3 ||
    answers.some(
      (answer) => !Number.isInteger(answer) || answer < 0 || answer > 3,
    )
  ) {
    throw new Error("invalid answer");
  }

  const total = answers.reduce((sum, answer) => sum + answer, 0);
  const stage =
    total <= 2
      ? "explore"
      : total <= 5
        ? "experiment"
        : total <= 7
          ? "systemize"
          : "integrate";

  return { total, stage };
}
