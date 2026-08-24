import { Suspense } from "react";
import { notFound } from "next/navigation";
import { IntentAwareResult } from "@/components/quest/IntentAwareResult";
import { getTalk } from "@/lib/content/talk-repository";
import { publishedTalkParams } from "@/lib/content/static-talk-params";
import { canRenderTalk } from "@/lib/content/talk-visibility";

export const generateStaticParams = publishedTalkParams;
export const dynamicParams = false;

export default async function ResultPage({ params }: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params;
  const talk = await getTalk(slug);
  if (!talk || !canRenderTalk(talk)) notFound();
  return <Suspense fallback={null}><IntentAwareResult talk={talk} /></Suspense>;
}
