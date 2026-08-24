"use client";

import { useSearchParams } from "next/navigation";

import { ResultLoader } from "@/components/quest/ResultView";
import type { Talk } from "@/lib/content/talk-types";
import { parseLeadIntent } from "@/lib/story/lead-intent-url";

export function IntentAwareResult({ talk }: Readonly<{ talk: Talk }>) {
  const query = useSearchParams();
  const intent = parseLeadIntent(query.get("intent") ?? undefined);

  return <ResultLoader talk={talk} initialIntent={intent} />;
}
