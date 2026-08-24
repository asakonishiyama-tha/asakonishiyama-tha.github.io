"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";

import { HeroAtmosphere } from "@/components/story/HeroAtmosphere";
import type {
  CardsScene as CardsSceneData,
  CaseStudyScene as CaseStudySceneData,
  HeroScene as HeroSceneData,
  LeadCtaScene as LeadCtaSceneData,
  PhotoStoryScene as PhotoStorySceneData,
  QuestCtaScene as QuestCtaSceneData,
  StatementScene as StatementSceneData,
  TalkPresentation,
} from "@/lib/content/talk-types";
import styles from "@/components/story/story.module.css";
import { configuredSiteUrl } from "@/lib/story/runtime";
import { getSceneRevealProps, useHydrationSafeReducedMotion } from "@/lib/story/motion";
import { createQuestUrl } from "@/lib/story/quest-url";
import { leadResultHref } from "@/lib/story/lead-intent-url";

type SceneMotion = "orbit" | "timeline" | "photo" | "scan" | "pulse";

function SceneShell({
  children,
  className,
  id,
  motionVariant,
  "data-scene-tone": sceneTone,
}: Readonly<{ children: React.ReactNode; className: string; id: string; motionVariant?: SceneMotion; "data-scene-tone"?: StatementSceneData["tone"] }>) {
  const reducedMotion = useHydrationSafeReducedMotion();

  return (
    <motion.section
      id={id}
      className={className}
      data-scene-tone={sceneTone}
      style={reducedMotion ? { opacity: 1, transform: "none" } : undefined}
      {...getSceneRevealProps(reducedMotion)}
    >
      {motionVariant ? (
        <div
          className={styles.sceneAtmosphere}
          data-scene-motion={motionVariant}
          data-motion-state={reducedMotion ? "static" : "animated"}
          aria-hidden="true"
        />
      ) : null}
      {children}
    </motion.section>
  );
}

export function HeroScene({ scene, presentation }: Readonly<{ scene: HeroSceneData; presentation?: TalkPresentation }>) {
  return (
    <SceneShell id={scene.id} className={`${styles.scene} ${styles.hero} ${scene.atmosphere === "timeMesh" ? styles.heroTimeMesh : ""}`}>
      <div className={styles.heroCopy}>
        <p className={styles.kicker}>{presentation?.heroKicker ?? "THA / AI PRESIDENT"}</p>
        <h1>{scene.heading}</h1>
        {scene.supportingText ? <p className={styles.heroSupporting}>{scene.supportingText}</p> : null}
        {scene.sourceNote ? <p className={styles.heroSourceNote}>{scene.sourceNote}</p> : null}
      </div>
      {scene.video ? <BackgroundVideo src={scene.video} /> : null}
      {scene.image && !scene.video ? <img className={styles.heroImage} src={scene.image} alt="" aria-hidden="true" data-hero-image /> : null}
      {scene.atmosphere === "timeMesh" ? <HeroAtmosphere /> : null}
      <div className={styles.heroHalo} aria-hidden="true" />
      <span className={styles.scrollPrompt}>{presentation?.scrollPrompt ?? "SCROLL TO ACCUMULATE"}</span>
    </SceneShell>
  );
}

function BackgroundVideo({ src }: Readonly<{ src: string }>) {
  const [playing, setPlaying] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      void video.play();
    } else {
      video.pause();
    }
  };

  return (
    <div className={styles.videoWrap}>
      <video
        ref={videoRef}
        className={styles.backgroundVideo}
        src={src}
        autoPlay
        loop
        muted
        playsInline
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <button className={styles.videoControl} type="button" onClick={togglePlayback}>
        {playing ? "映像を停止" : "映像を再生"}
      </button>
    </div>
  );
}

export function StatementScene({ scene }: Readonly<{ scene: StatementSceneData }>) {
  return (
    <SceneShell id={scene.id} className={`${styles.scene} ${styles.statement}`} motionVariant="orbit" data-scene-tone={scene.tone ?? "default"}>
      <p className={styles.sceneIndex}>01 / THE TURN</p>
      <blockquote>{scene.statement}</blockquote>
      {scene.emphasizedText ? <p className={styles.marker} data-motion-marker>{scene.emphasizedText}</p> : null}
    </SceneShell>
  );
}

export function PhotoStoryScene({ scene }: Readonly<{ scene: PhotoStorySceneData }>) {
  return (
    <SceneShell id={scene.id} className={`${styles.scene} ${styles.photoStory}`} motionVariant="photo">
      <figure>
        <img src={scene.image} alt={scene.alt} data-photo-story-image />
        {scene.caption ? <figcaption>{scene.caption}</figcaption> : null}
      </figure>
      {scene.sourceNote ? <p className={styles.sourceNote}>{scene.sourceNote}</p> : null}
    </SceneShell>
  );
}

export function CardsScene({ scene }: Readonly<{ scene: CardsSceneData }>) {
  return (
    <SceneShell id={scene.id} className={`${styles.scene} ${styles.cardsScene}`} motionVariant="timeline">
      <div className={styles.cardsHeading}>
        <p className={styles.sceneIndex}>02 / KNOWLEDGE LOOP</p>
        <h2>{scene.heading}</h2>
        {scene.sourceNote ? <p className={styles.sourceNote}>{scene.sourceNote}</p> : null}
      </div>
      <ol className={styles.cards}>
        {scene.cards.map((card, index) => (
          <li key={card.title}>
            <span aria-hidden="true">0{index + 1}</span>
            <div>
              <h3>{card.title}</h3>
              <p>{card.description}</p>
            </div>
          </li>
        ))}
      </ol>
    </SceneShell>
  );
}

export function CaseStudyScene({ scene }: Readonly<{ scene: CaseStudySceneData }>) {
  return (
    <SceneShell id={scene.id} className={`${styles.scene} ${styles.caseStudy}`} motionVariant="scan">
      <div>
        <p className={styles.sceneIndex}>FIELD NOTE / {scene.organization}</p>
        <h2>{scene.heading ?? `${scene.organization}の強化魔法`}</h2>
        <dl>
          <div><dt>課題</dt><dd>{scene.challenge}</dd></div>
          <div><dt>実践</dt><dd>{scene.approach}</dd></div>
          <div><dt>変化</dt><dd>{scene.outcome}</dd></div>
        </dl>
        {scene.sourceNote ? <p className={styles.sourceNote}>{scene.sourceNote}</p> : null}
      </div>
      {scene.image ? <img className={styles.caseImage} src={scene.image} alt={scene.alt ?? ""} /> : null}
    </SceneShell>
  );
}

export function QuestCtaScene({
  scene,
  talkSlug,
}: Readonly<{ scene: QuestCtaSceneData; talkSlug: string }>) {
  const [browserOrigin, setBrowserOrigin] = useState<string>();
  const questUrl = createQuestUrl({ slug: talkSlug, siteUrl: configuredSiteUrl, browserOrigin });

  useEffect(() => {
    setBrowserOrigin(window.location.origin);
  }, []);

  return (
    <SceneShell id={scene.id} className={`${styles.scene} ${styles.quest}`} motionVariant="pulse">
      <div>
        <p className={styles.sceneIndex}>03 / YOUR QUEST</p>
        <h2>{scene.heading}</h2>
        <p>{scene.description}</p>
        {questUrl ? <a className={styles.questButton} href={questUrl}>{scene.buttonLabel}</a> : <span className={styles.questPending}>診断リンクを準備中</span>}
      </div>
      {questUrl ? (
        <aside className={styles.qr} aria-label="スマートフォンで診断を開くQRコード">
          <QRCodeSVG value={questUrl} size={168} bgColor="#FFFFFF" fgColor="#1F2A44" includeMargin />
          <span>SCAN TO START</span>
        </aside>
      ) : null}
    </SceneShell>
  );
}

export function LeadCtaScene({ scene, talkSlug, downloadEnabled }: Readonly<{ scene: LeadCtaSceneData; talkSlug: string; downloadEnabled: boolean }>) {
  return (
    <SceneShell id={scene.id} className={`${styles.scene} ${styles.lead}`} motionVariant="pulse">
      <div>
        <p className={styles.sceneIndex}>NEXT / KEEP THE KNOWLEDGE</p>
        <h2>{scene.heading}</h2>
        <p>{scene.description}</p>
      </div>
      <div className={styles.leadActions}>
        {downloadEnabled ? <a href={leadResultHref(talkSlug, "download")}>{scene.downloadLabel}</a> : null}
        <a href={leadResultHref(talkSlug, "consultation")}>{scene.consultationLabel}</a>
      </div>
    </SceneShell>
  );
}
