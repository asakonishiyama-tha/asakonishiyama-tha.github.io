import { Suspense } from "react";
import { notFound } from "next/navigation";
import { IntentAwareQuest } from "@/components/quest/IntentAwareQuest";
import { getTalk } from "@/lib/content/talk-repository";
import { publishedTalkParams } from "@/lib/content/static-talk-params";
import { canRenderTalk } from "@/lib/content/talk-visibility";

export const generateStaticParams = publishedTalkParams;
export const dynamicParams = false;

export default async function QuestPage({ params }: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params;
  const talk = await getTalk(slug);
  if (!talk || !canRenderTalk(talk)) notFound();
  return <Suspense fallback={null}><IntentAwareQuest talk={talk} /></Suspense>;
}
