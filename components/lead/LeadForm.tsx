"use client";

import { useEffect, useRef, useState } from "react";

import styles from "@/components/quest/quest.module.css";
import { trackEventOnce } from "@/lib/analytics/track";
import type { DownloadResource } from "@/lib/content/talk-types";
import type { DiagnosisStage } from "@/lib/diagnosis/score";
import {
  GasAbortError,
  GasNotFoundError,
  GasTimeoutError,
  submitAndConfirmLead,
} from "@/lib/forms/gas-client";
import {
  isLiteralLoopbackSiteOrigin,
  resolvePublicFormConfigurationFailClosed,
} from "@/lib/forms/public-form-config.js";
import { captureFirstTouchAcquisition } from "@/lib/leads/acquisition";
import {
  defaultConsultationTopicOptions,
  type ConsultationTopicOption,
} from "@/lib/leads/consultation-topics";
import {
  type LeadFieldErrors,
  type LeadFieldName,
  validateLeadFields,
} from "@/lib/validation/lead-client";
import {
  parseLead,
  type ConsultationTopic,
  type LeadIntent,
  type ValidatedLead,
} from "@/lib/validation/lead-schema";

const preparationMessage = "現在、受付機能を準備しています。資料の閲覧と診断はご利用いただけます。";
const downloadPreparationMessage = "資料を準備中です。相談フォームをご利用ください。";
const confirmationFailureMessage = "保存を確認できませんでした。確認メールが届いていない場合は、もう一度お試しください。";
const transportFailureMessage = "通信に失敗しました。接続を確認して、もう一度お試しください。";
const approvedDownloadPath = /^\/downloads\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/i;
const noAdditionalDownloads: DownloadResource[] = [];

type LeadFormProps = {
  intent: LeadIntent;
  talkSlug: string;
  eventName: string;
  resultStage: DiagnosisStage;
  consentText: string;
  privacyPolicyUrl?: string;
  downloadUrl?: string;
  additionalDownloads?: DownloadResource[];
  formHeading?: string;
  consultationHeading?: string;
  consultationTopics?: readonly ConsultationTopicOption[];
  thankYouMessage?: string;
};

type FormValues = {
  companyName: string;
  name: string;
  email: string;
  consent: boolean;
  consultationTopic: ConsultationTopic | "";
  website: string;
};

type SubmissionState = "idle" | "submitting" | "confirming" | "success" | "error";

const initialValues: FormValues = {
  companyName: "",
  name: "",
  email: "",
  consent: false,
  consultationTopic: "",
  website: "",
};

function configuredSiteOrigin(): string | null | undefined {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (!configured) return null;
  try {
    const parsed = new URL(configured);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      || parsed.pathname !== "/"
      || parsed.search
      || parsed.hash
      || parsed.username
      || parsed.password
    ) return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function resolveSafeDownloadHref(value: string | undefined): string | undefined {
  if (typeof window === "undefined" || !value || !approvedDownloadPath.test(value)) return undefined;
  let browserOrigin: URL;
  try {
    browserOrigin = new URL(window.location.origin);
  } catch {
    return undefined;
  }
  const siteOrigin = configuredSiteOrigin();
  if (
    (browserOrigin.protocol !== "https:" && browserOrigin.protocol !== "http:")
    || siteOrigin === undefined
    || (siteOrigin !== null && siteOrigin !== browserOrigin.origin)
  ) return undefined;

  const destination = new URL(value, browserOrigin.origin);
  if (destination.origin !== browserOrigin.origin || destination.username || destination.password) return undefined;
  return destination.pathname;
}

function submissionErrorMessage(error: unknown) {
  return error instanceof GasNotFoundError || error instanceof GasTimeoutError
    ? confirmationFailureMessage
    : transportFailureMessage;
}

export function LeadForm({
  intent,
  talkSlug,
  eventName,
  resultStage,
  consentText,
  privacyPolicyUrl,
  downloadUrl,
  additionalDownloads,
  formHeading,
  consultationHeading,
  consultationTopics,
  thankYouMessage = "お申し込みを受け付けました。",
}: Readonly<LeadFormProps>) {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [state, setState] = useState<SubmissionState>("idle");
  const [summaryError, setSummaryError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<LeadFieldErrors>({});
  const [safeDownload, setSafeDownload] = useState<string>();
  const [safeAdditionalDownloads, setSafeAdditionalDownloads] = useState<DownloadResource[]>([]);
  const summaryRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<Record<LeadFieldName, HTMLElement | null>>({
    companyName: null,
    name: null,
    email: null,
    consultationTopic: null,
    consent: null,
  });
  const inFlightRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  const environmentPrivacyPolicyUrl = process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL;
  const formConfiguration = resolvePublicFormConfigurationFailClosed({
    gasWebAppUrl: process.env.NEXT_PUBLIC_GAS_WEB_APP_URL,
    privacyPolicyUrl: environmentPrivacyPolicyUrl === undefined
      ? privacyPolicyUrl
      : environmentPrivacyPolicyUrl,
  }, {
    allowLoopback: isLiteralLoopbackSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL),
  });
  const endpoint = formConfiguration.enabled ? formConfiguration.gasWebAppUrl : undefined;
  const configuredAdditionalDownloads = additionalDownloads ?? noAdditionalDownloads;
  const configuredTopicOptions = consultationTopics?.length
    ? consultationTopics
    : defaultConsultationTopicOptions;
  const isBusy = state === "submitting" || state === "confirming";
  const canSubmit = endpoint !== undefined
    && !isBusy
    && (intent !== "download" || safeDownload !== undefined);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
      controllerRef.current = null;
      inFlightRef.current = false;
    };
  }, []);

  useEffect(() => {
    setSafeDownload(resolveSafeDownloadHref(downloadUrl));
    setSafeAdditionalDownloads(configuredAdditionalDownloads.flatMap((download) => {
      const href = resolveSafeDownloadHref(download.url);
      return href && download.label.trim() ? [{ label: download.label, url: href }] : [];
    }));
  }, [configuredAdditionalDownloads, downloadUrl]);

  useEffect(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    inFlightRef.current = false;
    setValues(initialValues);
    setState("idle");
    setSummaryError("");
    setFieldErrors({});
  }, [intent]);

  useEffect(() => {
    const firstInvalid = (Object.keys(controlsRef.current) as LeadFieldName[])
      .find((field) => fieldErrors[field]);
    if (firstInvalid) {
      controlsRef.current[firstInvalid]?.focus();
    } else if (state === "error") {
      summaryRef.current?.focus();
    } else if (state === "success") {
      successRef.current?.focus();
    }
  }, [fieldErrors, state]);

  function updateValue<Key extends keyof FormValues>(key: Key, value: FormValues[Key]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function fieldId(field: LeadFieldName) {
    return `${intent}-${field}-error`;
  }

  function describedBy(field: LeadFieldName) {
    return fieldErrors[field] ? fieldId(field) : undefined;
  }

  function isInvalid(field: LeadFieldName) {
    return fieldErrors[field] ? true : undefined;
  }

  function candidateLead(): unknown {
    const common = {
      companyName: values.companyName,
      name: values.name,
      email: values.email,
      consent: values.consent,
      talkSlug,
      eventName,
      diagnosisStage: resultStage,
      ...captureFirstTouchAcquisition(talkSlug),
    };
    return intent === "consultation"
      ? { intent, ...common, consultationTopic: values.consultationTopic }
      : { intent, ...common };
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit || inFlightRef.current || endpoint === undefined || values.website !== "") return;

    const candidate = candidateLead();
    const nextErrors = validateLeadFields(candidate);
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      setSummaryError("入力内容をご確認ください。");
      setState("error");
      return;
    }

    let lead: ValidatedLead;
    try {
      lead = parseLead(candidate);
    } catch {
      setSummaryError("入力内容をご確認ください。");
      setState("error");
      return;
    }

    inFlightRef.current = true;
    const controller = new AbortController();
    controllerRef.current = controller;
    setFieldErrors({});
    setSummaryError("");
    setState("submitting");

    try {
      await submitAndConfirmLead(lead, {
        allowLoopbackEndpoint: isLiteralLoopbackSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL),
        endpoint,
        signal: controller.signal,
        onConfirming: () => {
          if (mountedRef.current && !controller.signal.aborted && controllerRef.current === controller) {
            setState("confirming");
          }
        },
      });
      if (!mountedRef.current || controller.signal.aborted || controllerRef.current !== controller) return;
    } catch (error) {
      if (!mountedRef.current || controller.signal.aborted || error instanceof GasAbortError) return;
      setSummaryError(submissionErrorMessage(error));
      setState("error");
      return;
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        inFlightRef.current = false;
      }
    }

    setState("success");
    try {
      trackEventOnce(
        intent === "download" ? "download_submit_success" : "consultation_submit_success",
        { talkSlug, resultStage },
      );
    } catch {
      // Analytics is best-effort and must never contradict a verified saved receipt.
    }
  }

  const heading = intent === "download"
    ? formHeading ?? "個別アクションシートを受け取る"
    : consultationHeading ?? "AI活用を相談する";
  const submitLabel = intent === "download" ? "資料を受け取る" : "相談を申し込む";
  const currentSubmitLabel = state === "submitting"
    ? "送信中…"
    : state === "confirming"
      ? "保存を確認中…"
      : submitLabel;
  const policyUrl = formConfiguration.enabled ? formConfiguration.privacyPolicyUrl : undefined;
  const fieldError = (field: LeadFieldName) => fieldErrors[field]
    ? <p className={styles.fieldError} id={fieldId(field)}>{fieldErrors[field]}</p>
    : null;

  if (state === "success") {
    return <section className={styles.leadSection} aria-labelledby={`${intent}-success`}>
      <div
        className={styles.leadSuccess}
        id={`${intent}-success`}
        ref={successRef}
        role="status"
        tabIndex={-1}
      >
        {intent === "download" && safeDownload ? <>
          <p>{thankYouMessage}</p>
          <p>資料はこの画面から直接ダウンロードできます。</p>
          <div className={styles.downloadLinks}>
            <a className={styles.downloadLink} href={safeDownload} download>資料をダウンロード</a>
            {safeAdditionalDownloads.map((download) => <a
              className={styles.downloadLink}
              href={download.url}
              download
              key={`${download.label}:${download.url}`}
            >
              {download.label}
            </a>)}
          </div>
        </> : <p>{thankYouMessage}</p>}
      </div>
    </section>;
  }

  return <section className={styles.leadSection} aria-labelledby={`${intent}-heading`}>
    <div className={styles.leadHeading}>
      <p className={styles.eyebrow}>{intent === "download" ? "ACTION SHEET" : "CONSULTATION"}</p>
      <h2 id={`${intent}-heading`}>{heading}</h2>
    </div>
    {endpoint === undefined ? <p className={styles.leadUnavailable}>{preparationMessage}</p> : null}
    {endpoint !== undefined && intent === "download" && safeDownload === undefined
      ? <p className={styles.leadUnavailable}>{downloadPreparationMessage}</p>
      : null}
    {summaryError ? <div
      className={styles.leadError}
      ref={summaryRef}
      role="alert"
      tabIndex={-1}
    >
      {summaryError}
    </div> : null}
    <form className={styles.leadForm} onSubmit={submit} noValidate>
      <div className={styles.honeypot} aria-hidden="true">
        <label htmlFor={`${intent}-website`}>Webサイト</label>
        <input
          id={`${intent}-website`}
          name="website"
          value={values.website}
          onChange={(event) => updateValue("website", event.target.value)}
          autoComplete="off"
          tabIndex={-1}
        />
      </div>
      <div className={styles.leadFields}>
        <label htmlFor={`${intent}-company`}>会社名</label>
        <input
          ref={(node) => { controlsRef.current.companyName = node; }}
          id={`${intent}-company`}
          name="companyName"
          type="text"
          autoComplete="organization"
          required
          aria-invalid={isInvalid("companyName")}
          aria-describedby={describedBy("companyName")}
          value={values.companyName}
          onChange={(event) => updateValue("companyName", event.target.value)}
        />
        {fieldError("companyName")}
        <label htmlFor={`${intent}-name`}>お名前（任意）</label>
        <input
          ref={(node) => { controlsRef.current.name = node; }}
          id={`${intent}-name`}
          name="name"
          type="text"
          autoComplete="name"
          aria-invalid={isInvalid("name")}
          aria-describedby={describedBy("name")}
          value={values.name}
          onChange={(event) => updateValue("name", event.target.value)}
        />
        {fieldError("name")}
        <label htmlFor={`${intent}-email`}>メールアドレス</label>
        <input
          ref={(node) => { controlsRef.current.email = node; }}
          id={`${intent}-email`}
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={isInvalid("email")}
          aria-describedby={describedBy("email")}
          value={values.email}
          onChange={(event) => updateValue("email", event.target.value)}
        />
        {fieldError("email")}
      </div>
      {intent === "consultation" ? <fieldset
        className={styles.topicFieldset}
        aria-invalid={isInvalid("consultationTopic")}
        aria-describedby={describedBy("consultationTopic")}
      >
        <legend>相談したいテーマ</legend>
        {configuredTopicOptions.map((topic, index) => <label key={topic.value} className={styles.topicOption}>
          <input
            ref={index === 0 ? (node) => { controlsRef.current.consultationTopic = node; } : undefined}
            type="radio"
            name="consultationTopic"
            value={topic.value}
            checked={values.consultationTopic === topic.value}
            onChange={() => updateValue("consultationTopic", topic.value)}
          />
          {topic.label}
        </label>)}
        {fieldError("consultationTopic")}
      </fieldset> : null}
      <label className={styles.consent}>
        <input
          ref={(node) => { controlsRef.current.consent = node; }}
          name="consent"
          type="checkbox"
          required
          aria-invalid={isInvalid("consent")}
          aria-describedby={describedBy("consent")}
          checked={values.consent}
          onChange={(event) => updateValue("consent", event.target.checked)}
        />
        個人情報の取り扱いに同意する
      </label>
      {fieldError("consent")}
      <p className={styles.consentCopy}>
        {consentText}{" "}
        {policyUrl
          ? <a href={policyUrl} target="_blank" rel="noreferrer">プライバシーポリシー</a>
          : <span>プライバシーポリシー（準備中）</span>}
      </p>
      <button
        className={styles.leadSubmit}
        type="submit"
        disabled={!canSubmit}
        aria-live={state === "confirming" ? "polite" : undefined}
      >
        {currentSubmitLabel}
      </button>
    </form>
  </section>;
}
