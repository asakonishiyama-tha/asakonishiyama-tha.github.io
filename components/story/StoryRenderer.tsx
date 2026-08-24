"use client";

import { useEffect } from "react";
import { motion, useScroll } from "motion/react";

import type { Scene, Talk } from "@/lib/content/talk-types";
import {
  CardsScene,
  CaseStudyScene,
  HeroScene,
  LeadCtaScene,
  PhotoStoryScene,
  QuestCtaScene,
  StatementScene,
} from "@/components/story/scenes";
import styles from "@/components/story/story.module.css";
import { trackEventOnce } from "@/lib/analytics/track";
import { isStoryDevelopment } from "@/lib/story/runtime";
import { captureFirstTouchAcquisition } from "@/lib/leads/acquisition";
import { useHydrationSafeReducedMotion } from "@/lib/story/motion";

type StoryRendererProps = {
  talk: Talk;
};

export function StoryRenderer({ talk }: StoryRendererProps) {
  const { scrollYProgress } = useScroll();
  const reducedMotion = useHydrationSafeReducedMotion();

  useEffect(() => {
    captureFirstTouchAcquisition(talk.slug);
    trackEventOnce("talk_view", { talkSlug: talk.slug });
  }, [talk.slug]);

  return (
    <main
      className={styles.story}
      data-reduced-motion={reducedMotion ? "true" : "false"}
      data-talk-slug={talk.slug}
    >
      <div className={styles.orbit} aria-hidden="true">
        <motion.div
          className={styles.orbitProgress}
          data-scroll-progress
          style={reducedMotion ? { transform: "none" } : { scaleY: scrollYProgress }}
        />
      </div>
      <div className={styles.scenes}>{talk.scenes.map((scene) => renderScene(scene, talk))}</div>
    </main>
  );
}

type RuntimeScene = { id: string; type: string };

function renderScene(scene: RuntimeScene, talk: Talk) {
  if (!isKnownSceneType(scene.type)) {
    if (isStoryDevelopment) {
      console.warn(`Unknown story scene skipped: ${scene.id}`);
    }
    return null;
  }

  return renderKnownScene(scene as Scene, talk);
}

function renderKnownScene(scene: Scene, talk: Talk) {
  switch (scene.type) {
    case "hero":
      return <HeroScene key={scene.id} scene={scene} presentation={talk.presentation} />;
    case "statement":
      return <StatementScene key={scene.id} scene={scene} />;
    case "photoStory":
      return <PhotoStoryScene key={scene.id} scene={scene} />;
    case "cards":
      return <CardsScene key={scene.id} scene={scene} />;
    case "caseStudy":
      return <CaseStudyScene key={scene.id} scene={scene} />;
    case "questCta":
      return <QuestCtaScene key={scene.id} scene={scene} talkSlug={talk.slug} />;
    case "leadCta":
      return <LeadCtaScene key={scene.id} scene={scene} talkSlug={talk.slug} downloadEnabled={talk.lead.downloadEnabled} />;
    default:
      return assertNever(scene);
  }
}

function isKnownSceneType(type: string): type is Scene["type"] {
  return ["hero", "statement", "photoStory", "cards", "caseStudy", "questCta", "leadCta"].includes(type as Scene["type"]);
}

function assertNever(scene: never): never {
  throw new Error(`Unhandled story scene: ${String(scene)}`);
}
