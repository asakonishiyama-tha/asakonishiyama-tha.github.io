"use client";

import { useSearchParams } from "next/navigation";

import { QuestFlow } from "@/components/quest/QuestFlow";
import type { Talk } from "@/lib/content/talk-types";
import { parseLeadIntent } from "@/lib/story/lead-intent-url";

export function IntentAwareQuest({ talk }: Readonly<{ talk: Talk }>) {
  const query = useSearchParams();
  const intent = parseLeadIntent(query.get("intent") ?? undefined);

  return <QuestFlow talk={talk} intent={intent} />;
}
