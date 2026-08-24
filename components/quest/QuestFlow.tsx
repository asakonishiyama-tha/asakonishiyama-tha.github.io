"use client";

import { useEffect, useState } from "react";
import type { Talk } from "@/lib/content/talk-types";
import { trackEventOnce } from "@/lib/analytics/track";
import { scoreDiagnosis, type DiagnosisResult } from "@/lib/diagnosis/score";
import { saveAnswers } from "@/lib/diagnosis/session";
import { leadResultHref } from "@/lib/story/lead-intent-url";
import type { LeadIntent } from "@/lib/validation/lead-schema";
import { captureFirstTouchAcquisition } from "@/lib/leads/acquisition";
import styles from "./quest.module.css";

const questionCount = 3;

export function QuestFlow({ talk, intent }: Readonly<{ talk: Talk; intent?: LeadIntent }>) {
  const [activeQuestion, setActiveQuestion] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<DiagnosisResult | null>(null);
  const [storageUnavailable, setStorageUnavailable] = useState(false);

  useEffect(() => {
    captureFirstTouchAcquisition(talk.slug);
    trackEventOnce("quest_start", { talkSlug: talk.slug });
  }, [talk.slug]);

  if (talk.questions.length !== questionCount) return <main className={styles.quest}><div className={styles.shell}><p className={styles.eyebrow}>THA QUEST</p><h1>診断を準備中です。</h1></div></main>;
  const question = talk.questions[activeQuestion];
  const selectAnswer = (score: number) => {
    const nextAnswers = [...answers]; nextAnswers[activeQuestion] = score; setAnswers(nextAnswers);
    if (activeQuestion === questionCount - 1) {
      const nextResult = scoreDiagnosis(nextAnswers);
      trackEventOnce("quest_complete", { talkSlug: talk.slug, resultStage: nextResult.stage });
      setResult(nextResult);
      setStorageUnavailable(!saveAnswers(talk.slug, nextAnswers));
      return;
    }
    setActiveQuestion((current) => current + 1);
  };
  if (result) {
    const content = talk.results.find((item) => item.stage === result.stage);
    const resultHref = intent ? leadResultHref(talk.slug, intent) : `/talks/${encodeURIComponent(talk.slug)}/result`;
    return <main className={styles.quest}><div className={styles.shell}><p className={styles.eyebrow}>THA QUEST / COMPLETE</p><section className={styles.complete} aria-live="polite">{storageUnavailable && content ? <><h1>{content.title}</h1><p className={styles.subtitle}>{content.rpgSubtitle}</p><p className={styles.instruction}>{content.description}</p><p role="alert">この端末では診断結果を続けて開けません。結果をメモして、もう一度診断してください。</p></> : <><h1>3つの問いに答えました。</h1><p className={styles.instruction}>あなたの現在地と、次に進めるクエストを確認できます。</p><a className={styles.resultLink} href={resultHref}>診断結果を見る</a></>}<button className={styles.back} type="button" onClick={() => { setActiveQuestion(questionCount - 1); setResult(null); setStorageUnavailable(false); }}>回答を見直す</button></section></div></main>;
  }
  return <main className={styles.quest}><div className={styles.shell}><p className={styles.eyebrow}>THA QUEST / 60 SECOND DIAGNOSIS</p><div aria-label={`全${questionCount}問中${activeQuestion + 1}問目`} aria-valuemax={questionCount} aria-valuemin={1} aria-valuenow={activeQuestion + 1} className={styles.progress} role="progressbar"><span className={styles.progressTrack}><span className={styles.progressValue} style={{ width: `${((activeQuestion + 1) / questionCount) * 100}%` }} /></span><span className={styles.progressLabel}>QUEST {activeQuestion + 1} / {questionCount}</span></div><section className={styles.question} aria-labelledby={`question-${question.id}`}><h1 id={`question-${question.id}`}>{question.prompt}</h1><p className={styles.instruction}>もっとも近い答えを選んでください。選ぶと次の問いへ進みます。</p><div aria-label="回答の選択肢" className={styles.choices} role="group">{question.options.map((option, index) => { const selected = answers[activeQuestion] === option.score; return <button aria-pressed={selected} className={styles.choice} key={option.label} onClick={() => selectAnswer(option.score)} type="button"><span aria-hidden="true" className={styles.choiceIndex}>{index + 1}</span><span>{option.label}</span>{selected ? <span aria-hidden="true" className={styles.selectedText}>選択済み</span> : null}</button>; })}</div>{activeQuestion > 0 ? <button className={styles.back} onClick={() => setActiveQuestion((current) => current - 1)} type="button">前の質問へ</button> : null}</section></div></main>;
}
