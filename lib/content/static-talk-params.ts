import { listPublishedTalks } from "@/lib/content/talk-repository";

export async function publishedTalkParams(): Promise<Array<{ slug: string }>> {
  return (await listPublishedTalks()).map(({ slug }) => ({ slug }));
}
