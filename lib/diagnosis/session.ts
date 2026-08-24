const sessionKey = (slug: string) => `tha-hooked:${slug}:answers`;

function isValidAnswers(value: unknown): value is number[] {
  return Array.isArray(value) && value.length === 3 && value.every((answer) => Number.isInteger(answer) && answer >= 0 && answer <= 3);
}

export function saveAnswers(slug: string, answers: readonly number[]): boolean {
  if (typeof window === "undefined" || !isValidAnswers(answers)) return false;

  try {
    window.sessionStorage.setItem(sessionKey(slug), JSON.stringify(answers));
    return true;
  } catch {
    return false;
  }
}

export function loadAnswers(slug: string): number[] | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = window.sessionStorage.getItem(sessionKey(slug));
    if (!stored) return null;
    const answers: unknown = JSON.parse(stored);
    return isValidAnswers(answers) ? answers : null;
  } catch {
    return null;
  }
}
