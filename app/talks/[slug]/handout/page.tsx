import { notFound } from "next/navigation";

import { HandoutDocument } from "@/components/handout/HandoutDocument";
import { getTalkBundle } from "@/lib/content/talk-bundle-repository";
import { publishedTalkParams } from "@/lib/content/static-talk-params";
import { canRenderTalk } from "@/lib/content/talk-visibility";

export const generateStaticParams = publishedTalkParams;
export const dynamicParams = false;

export default async function HandoutPage({ params }: Readonly<{ params: Promise<{ slug: string }> }>) {
  const { slug } = await params;
  const bundle = await getTalkBundle(slug);

  if (!bundle || !canRenderTalk(bundle.manifest)) {
    notFound();
  }

  return <HandoutDocument bundle={bundle} />;
}
