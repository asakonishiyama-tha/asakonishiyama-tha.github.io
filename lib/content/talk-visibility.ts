import type { Talk } from "@/lib/content/talk-types";

export function canRenderTalk(
  talk: Pick<Talk, "published">,
  environment: string | undefined = process.env.NODE_ENV,
): boolean {
  return talk.published || environment === "development";
}
