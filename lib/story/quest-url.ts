type QuestUrlInput = {
  slug: string;
  siteUrl?: string;
  browserOrigin?: string;
};

export function createQuestUrl({ slug, siteUrl, browserOrigin }: QuestUrlInput): string | null {
  const baseUrl = siteUrl === undefined ? toSiteOrigin(browserOrigin) : toSiteOrigin(siteUrl);

  if (!baseUrl) {
    return null;
  }

  try {
    return new URL(`/talks/${encodeURIComponent(slug)}/quest`, baseUrl).toString();
  } catch {
    return null;
  }
}

function toSiteOrigin(value?: string): URL | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }
    if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) return null;
    return url;
  } catch {
    return null;
  }
}
