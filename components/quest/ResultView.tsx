"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LeadForm } from "@/components/lead/LeadForm";
import { trackEventOnce } from "@/lib/analytics/track";
import type { Talk, TalkLead } from "@/lib/content/talk-types";
import { scoreDiagnosis, type DiagnosisResult, type DiagnosisStage } from "@/lib/diagnosis/score";
import { loadAnswers } from "@/lib/diagnosis/session";
import { leadQuestHref } from "@/lib/story/lead-intent-url";
import type { LeadIntent } from "@/lib/validation/lead-schema";
import { captureFirstTouchAcquisition } from "@/lib/leads/acquisition";
import styles from "./quest.module.css";

export function selectStageDownload(lead: TalkLead, stage: DiagnosisStage) {
  return lead.stageDownloads?.find((item) => item.stage === stage)?.url ?? lead.downloadUrl;
}

export function ResultView({ talk, result, initialIntent }: Readonly<{ talk: Talk; result: DiagnosisResult; initialIntent?: LeadIntent }>) {
  const allowedInitialIntent = initialIntent === "download" && !talk.lead.downloadEnabled ? undefined : initialIntent;
  const [activeIntent, setActiveIntent] = useState<LeadIntent | null>(allowedInitialIntent ?? null);
  const content = talk.results.find((item) => item.stage === result.stage);

  useEffect(() => {
    trackEventOnce("result_view", { talkSlug: talk.slug, resultStage: result.stage });
  }, [result.stage, talk.slug]);

  useEffect(() => {
    if (!activeIntent) return;
    trackEventOnce(activeIntent === "download" ? "download_form_view" : "consultation_form_view", {
      talkSlug: talk.slug,
      resultStage: result.stage,
    });
  }, [activeIntent, result.stage, talk.slug]);

  function showForm(intent: "download" | "consultation") {
    if (activeIntent === intent) return;
    setActiveIntent(intent);
  }

  if (!content) return <main className={styles.result}><div className={styles.shell}><p className={styles.eyebrow}>THA QUEST</p><h1>結果を準備中です。</h1></div></main>;

  const formProps = { talkSlug: talk.slug, eventName: talk.eventName, resultStage: result.stage, consentText: talk.lead.consentText, privacyPolicyUrl: talk.lead.privacyPolicyUrl, additionalDownloads: talk.lead.additionalDownloads };
  const downloadUrl = selectStageDownload(talk.lead, result.stage);
  return <main className={styles.result}><div className={styles.shell}><p className={styles.eyebrow}>{talk.presentation?.resultEyebrow ?? "YOUR AI MANAGEMENT STAGE"}</p><section aria-labelledby="result-stage"><h1 id="result-stage">{content.title}</h1><p className={styles.subtitle}>{content.rpgSubtitle}</p><p className={styles.resultDescription}>{content.description}</p><div className={styles.nextQuest}><h2>{talk.presentation?.nextActionLabel ?? "NEXT QUEST"}</h2><p>{content.nextQuest}</p></div><nav aria-label="次のアクション" className={styles.resultActions}>{talk.lead.downloadEnabled ? <button type="button" aria-expanded={activeIntent === "download"} aria-controls="download" onClick={() => showForm("download")}>個別アクションシートを受け取る</button> : null}<button type="button" aria-expanded={activeIntent === "consultation"} aria-controls="consultation" onClick={() => showForm("consultation")}>{talk.lead.consultationCta}</button></nav></section>{activeIntent === "download" ? <div id="download"><LeadForm key="download" {...formProps} intent="download" downloadUrl={downloadUrl} formHeading={talk.lead.formHeading} thankYouMessage={talk.lead.thankYouMessage} /></div> : null}{activeIntent === "consultation" ? <div id="consultation"><LeadForm key="consultation" {...formProps} intent="consultation" consultationHeading={talk.lead.consultationHeading} consultationTopics={talk.lead.consultationTopics} thankYouMessage={talk.lead.consultationThankYouMessage ?? talk.lead.thankYouMessage} /></div> : null}</div></main>;
}

export function ResultLoader({ talk, initialIntent }: Readonly<{ talk: Talk; initialIntent?: LeadIntent }>) {
  const router = useRouter();
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  useEffect(() => { captureFirstTouchAcquisition(talk.slug); const answers = loadAnswers(talk.slug); if (!answers) { router.replace(leadQuestHref(talk.slug, initialIntent)); return; } try { const nextResult = scoreDiagnosis(answers); if (!talk.results.some((item) => item.stage === nextResult.stage)) { router.replace(leadQuestHref(talk.slug, initialIntent)); return; } setResult(nextResult); } catch { router.replace(leadQuestHref(talk.slug, initialIntent)); } }, [initialIntent, router, talk]);
  if (!result) return <main className={styles.result}><div className={styles.shell}><p className={styles.eyebrow}>THA QUEST</p><p aria-live="polite">診断結果を確認しています。</p></div></main>;
  return <ResultView result={result} talk={talk} initialIntent={initialIntent} />;
}
