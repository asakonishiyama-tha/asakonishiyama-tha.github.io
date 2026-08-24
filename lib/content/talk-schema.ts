import type { DiagnosisStage } from "../diagnosis/score";
import type {
  CardsScene,
  CaseStudyScene,
  DiagnosisQuestion,
  DiagnosisStageResult,
  DownloadResource,
  HeroScene,
  LeadCtaScene,
  PhotoStoryScene,
  QuestCtaScene,
  Scene,
  SceneTone,
  StageDownloadResource,
  StatementScene,
  Talk,
  TalkLead,
  TalkPresentation,
} from "./talk-types";
import { isConsultationTopic, type ConsultationTopicOption } from "../leads/consultation-topics.ts";

const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isCanonicalTalkSlug(value: unknown): value is string {
  return typeof value === "string" && slugPattern.test(value);
}
const downloadPdfPattern = /^\/downloads\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.pdf$/i;
const imageMediaPattern = /^\/media\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:avif|gif|jpe?g|png|tiff?|webp)$/i;
const videoMediaPattern = /^\/media\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)*[A-Za-z0-9][A-Za-z0-9._-]*\.(?:m4v|mov|mp4|ogv|webm)$/i;
const diagnosisStages = ["explore", "experiment", "systemize", "integrate"] as const;

type JsonRecord = Record<string, unknown>;
type TalkDocumentOrigins = { manifest: string; presentation: string };

export type TalkDocumentValidationError = Error & { document: string };

function invalid(message: string): never {
  throw new Error(`Invalid talk: ${message}`);
}

function documentValidationError(document: string, error: unknown): TalkDocumentValidationError {
  if (error !== null && typeof error === "object" && "document" in error && typeof error.document === "string") {
    return error as TalkDocumentValidationError;
  }
  const detail = error instanceof Error ? error.message : "unknown content error";
  return Object.assign(new Error(detail), { document });
}

function validateForDocument<T>(document: string | undefined, validator: () => T): T {
  try {
    return validator();
  } catch (error) {
    if (document === undefined) throw error;
    throw documentValidationError(document, error);
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && !Array.isArray(value) && typeof value === "object";
}

function record(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) {
    invalid(`${label} must be an object`);
  }

  return value;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    invalid(`${label} must be an array`);
  }

  return value;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    invalid(`${label} must be a non-empty string`);
  }

  return value;
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requiredString(value, label);
}

function optionalStringValue(value: unknown, label: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    invalid(`${label} must be a string`);
  }

  return value;
}

function requiredMediaPath(value: unknown, label: string, kind: "image" | "video"): string {
  const mediaPath = requiredString(value, label);
  const pattern = kind === "image" ? imageMediaPattern : videoMediaPattern;
  if (!pattern.test(mediaPath)) {
    invalid(`${label} must be a safe /media/ ${kind} path`);
  }
  return mediaPath;
}

function optionalMediaPath(value: unknown, label: string, kind: "image" | "video"): string | undefined {
  return value === undefined ? undefined : requiredMediaPath(value, label, kind);
}

function assertUniqueIds(items: Array<{ id: string }>, collection: string): void {
  const firstIndexById = new Map<string, number>();
  items.forEach((item, index) => {
    const firstIndex = firstIndexById.get(item.id);
    if (firstIndex !== undefined) {
      invalid(`${collection}[${index}].id is a duplicate of ${collection}[${firstIndex}].id: ${item.id}`);
    }
    firstIndexById.set(item.id, index);
  });
}

function isDiagnosisStage(value: string): value is DiagnosisStage {
  return diagnosisStages.some((stage) => stage === value);
}

function validatePresentation(value: unknown): TalkPresentation | undefined {
  if (value === undefined) {
    return undefined;
  }

  const presentationRecord = record(value, "presentation");
  const presentation: TalkPresentation = {};
  const heroKicker = optionalString(presentationRecord.heroKicker, "presentation heroKicker");
  const scrollPrompt = optionalString(presentationRecord.scrollPrompt, "presentation scrollPrompt");
  const resultEyebrow = optionalString(presentationRecord.resultEyebrow, "presentation resultEyebrow");
  const nextActionLabel = optionalString(presentationRecord.nextActionLabel, "presentation nextActionLabel");

  if (heroKicker !== undefined) presentation.heroKicker = heroKicker;
  if (scrollPrompt !== undefined) presentation.scrollPrompt = scrollPrompt;
  if (resultEyebrow !== undefined) presentation.resultEyebrow = resultEyebrow;
  if (nextActionLabel !== undefined) presentation.nextActionLabel = nextActionLabel;
  return presentation;
}

function validateScene(value: unknown, index: number): Scene {
  const scene = record(value, `scene ${index + 1}`);
  const id = requiredString(scene.id, `scene ${index + 1} id`);
  const type = requiredString(scene.type, `scene ${index + 1} type`);

  switch (type) {
    case "hero": {
      const hero: HeroScene = {
        id,
        type,
        heading: requiredString(scene.heading, `hero scene ${index + 1} heading`),
      };
      const supportingText = optionalString(scene.supportingText, `hero scene ${index + 1} supportingText`);
      const image = optionalMediaPath(scene.image, `hero scene ${index + 1} image`, "image");
      const video = optionalMediaPath(scene.video, `hero scene ${index + 1} video`, "video");
      const alt = optionalString(scene.alt, `hero scene ${index + 1} alt`);
      const sourceNote = optionalString(scene.sourceNote, `hero scene ${index + 1} sourceNote`);
      const atmosphere = optionalString(scene.atmosphere, `hero scene ${index + 1} atmosphere`);

      if (atmosphere !== undefined && atmosphere !== "timeMesh") {
        invalid(`hero scene ${index + 1} atmosphere must be timeMesh`);
      }
      if ((image !== undefined || video !== undefined) && sourceNote === undefined) {
        invalid(`hero scene ${index + 1} sourceNote is required when media is configured`);
      }
      if (supportingText !== undefined) hero.supportingText = supportingText;
      if (image !== undefined) hero.image = image;
      if (video !== undefined) hero.video = video;
      if (alt !== undefined) hero.alt = alt;
      if (sourceNote !== undefined) hero.sourceNote = sourceNote;
      if (atmosphere === "timeMesh") hero.atmosphere = atmosphere;
      return hero;
    }
    case "statement": {
      const statement: StatementScene = {
        id,
        type,
        statement: requiredString(scene.statement, `statement scene ${index + 1} statement`),
      };
      const emphasizedText = optionalString(scene.emphasizedText, `statement scene ${index + 1} emphasizedText`);
      const tone = optionalString(scene.tone, `statement scene ${index + 1} tone`);

      if (tone !== undefined) {
        if (tone !== "default" && tone !== "crisis") {
          invalid(`statement scene ${index + 1} tone must be default or crisis`);
        }
        statement.tone = tone as SceneTone;
      }

      if (emphasizedText !== undefined) statement.emphasizedText = emphasizedText;
      return statement;
    }
    case "photoStory": {
      const photoStory: PhotoStoryScene = {
        id,
        type,
        image: requiredMediaPath(scene.image, `photo story scene ${index + 1} image`, "image"),
        alt: requiredString(scene.alt, `photo story scene ${index + 1} alt`),
      };
      const caption = optionalString(scene.caption, `photo story scene ${index + 1} caption`);
      const sourceNote = optionalString(scene.sourceNote, `photo story scene ${index + 1} sourceNote`);

      if (sourceNote === undefined) {
        invalid(`photo story scene ${index + 1} sourceNote is required when media is configured`);
      }

      if (caption !== undefined) photoStory.caption = caption;
      if (sourceNote !== undefined) photoStory.sourceNote = sourceNote;
      return photoStory;
    }
    case "cards": {
      const cards = array(scene.cards, `cards scene ${index + 1} cards`).map((card, cardIndex) => {
        const cardRecord = record(card, `cards scene ${index + 1} card ${cardIndex + 1}`);

        return {
          title: requiredString(cardRecord.title, `cards scene ${index + 1} card ${cardIndex + 1} title`),
          description: requiredString(cardRecord.description, `cards scene ${index + 1} card ${cardIndex + 1} description`),
        };
      });
      const cardsScene: CardsScene = {
        id,
        type,
        heading: requiredString(scene.heading, `cards scene ${index + 1} heading`),
        cards,
      };

      const sourceNote = optionalString(scene.sourceNote, `cards scene ${index + 1} sourceNote`);
      if (sourceNote !== undefined) cardsScene.sourceNote = sourceNote;

      return cardsScene;
    }
    case "caseStudy": {
      const caseStudy: CaseStudyScene = {
        id,
        type,
        organization: requiredString(scene.organization, `case study scene ${index + 1} organization`),
        challenge: requiredString(scene.challenge, `case study scene ${index + 1} challenge`),
        approach: requiredString(scene.approach, `case study scene ${index + 1} approach`),
        outcome: requiredString(scene.outcome, `case study scene ${index + 1} outcome`),
      };
      const heading = optionalString(scene.heading, `case study scene ${index + 1} heading`);
      const image = optionalMediaPath(scene.image, `case study scene ${index + 1} image`, "image");
      const alt = optionalString(scene.alt, `case study scene ${index + 1} alt`);
      const sourceNote = optionalString(scene.sourceNote, `case study scene ${index + 1} sourceNote`);

      if (image !== undefined && alt === undefined) {
        invalid(`case study scene ${index + 1} alt must be a non-empty string when image is configured`);
      }
      if (image !== undefined && sourceNote === undefined) {
        invalid(`case study scene ${index + 1} sourceNote is required when media is configured`);
      }

      if (heading !== undefined) caseStudy.heading = heading;
      if (image !== undefined) caseStudy.image = image;
      if (alt !== undefined) caseStudy.alt = alt;
      if (sourceNote !== undefined) caseStudy.sourceNote = sourceNote;
      return caseStudy;
    }
    case "questCta": {
      const questCta: QuestCtaScene = {
        id,
        type,
        heading: requiredString(scene.heading, `quest CTA scene ${index + 1} heading`),
        description: requiredString(scene.description, `quest CTA scene ${index + 1} description`),
        buttonLabel: requiredString(scene.buttonLabel, `quest CTA scene ${index + 1} buttonLabel`),
      };

      return questCta;
    }
    case "leadCta": {
      const leadCta: LeadCtaScene = {
        id,
        type,
        heading: requiredString(scene.heading, `lead CTA scene ${index + 1} heading`),
        description: requiredString(scene.description, `lead CTA scene ${index + 1} description`),
        downloadLabel: requiredString(scene.downloadLabel, `lead CTA scene ${index + 1} downloadLabel`),
        consultationLabel: requiredString(scene.consultationLabel, `lead CTA scene ${index + 1} consultationLabel`),
      };

      return leadCta;
    }
    default:
      return invalid(`scene ${index + 1} has an unsupported type`);
  }
}

function validateQuestion(value: unknown, index: number): DiagnosisQuestion {
  const question = record(value, `question ${index + 1}`);
  const options = array(question.options, `question ${index + 1} options`);

  if (options.length === 0) {
    invalid(`question ${index + 1} requires at least one option`);
  }

  return {
    id: requiredString(question.id, `question ${index + 1} id`),
    prompt: requiredString(question.prompt, `question ${index + 1} prompt`),
    options: options.map((option, optionIndex) => {
      const optionRecord = record(option, `question ${index + 1} option ${optionIndex + 1}`);
      const score = optionRecord.score;

      if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 3) {
        invalid(`question ${index + 1} option ${optionIndex + 1} score must be an integer from 0 to 3`);
      }

      return {
        label: requiredString(optionRecord.label, `question ${index + 1} option ${optionIndex + 1} label`),
        score,
      };
    }),
  };
}

function validateResult(value: unknown, index: number): DiagnosisStageResult {
  const result = record(value, `result ${index + 1}`);
  const stage = requiredString(result.stage, `result ${index + 1} stage`);

  if (!isDiagnosisStage(stage)) {
    invalid(`result ${index + 1} stage is invalid`);
  }

  return {
    stage,
    title: requiredString(result.title, `result ${index + 1} title`),
    rpgSubtitle: requiredString(result.rpgSubtitle, `result ${index + 1} rpgSubtitle`),
    description: requiredString(result.description, `result ${index + 1} description`),
    nextQuest: requiredString(result.nextQuest, `result ${index + 1} nextQuest`),
  };
}

function validateStageDownloads(value: unknown): StageDownloadResource[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const downloads = array(value, "lead stageDownloads").map((download, index) =>
    record(download, `lead stage download ${index + 1}`),
  );
  const stages = downloads.map((download) => download.stage);

  if (
    downloads.length !== diagnosisStages.length
    || stages.some((stage) => typeof stage !== "string" || !isDiagnosisStage(stage))
    || new Set(stages).size !== diagnosisStages.length
  ) {
    invalid("stage downloads require four unique diagnosis stages");
  }

  return downloads.map((download, index) => {
    const url = requiredString(download.url, `lead stage download ${index + 1} URL`);
    if (!downloadPdfPattern.test(url)) {
      invalid("stage download PDF URL must be a safe /downloads/*.pdf path");
    }

    return {
      stage: download.stage as DiagnosisStage,
      url,
    };
  });
}

function validateConsultationTopics(value: unknown): ConsultationTopicOption[] | undefined {
  if (value === undefined) return undefined;

  const topics = array(value, "consultation topics").map((topic, index) =>
    record(topic, `consultation topics option ${index + 1}`),
  );
  if (topics.length === 0) invalid("consultation topics require at least one option");

  const values = topics.map((topic) => topic.value);
  if (values.some((topic) => !isConsultationTopic(topic)) || new Set(values).size !== values.length) {
    invalid("consultation topics require unique supported values");
  }

  return topics.map((topic, index) => ({
    value: topic.value as ConsultationTopicOption["value"],
    label: requiredString(topic.label, `consultation topics option ${index + 1} label`),
  }));
}

function validateLead(value: unknown): TalkLead {
  const lead = record(value, "lead");

  if (typeof lead.downloadEnabled !== "boolean") {
    invalid("lead downloadEnabled must be a boolean");
  }

  const downloadUrl = optionalStringValue(lead.downloadUrl, "lead downloadUrl");
  const stageDownloads = validateStageDownloads(lead.stageDownloads);
  if (lead.downloadEnabled) {
    if ((downloadUrl === undefined || downloadUrl.length === 0) && stageDownloads === undefined) {
      invalid("download PDF is required");
    }
    if (downloadUrl !== undefined && downloadUrl.length > 0 && !downloadPdfPattern.test(downloadUrl)) {
      invalid("download PDF URL must be a safe /downloads/*.pdf path");
    }
  }

  const privacyPolicyUrl = optionalString(lead.privacyPolicyUrl, "lead privacyPolicyUrl");
  const consultationHeading = optionalString(lead.consultationHeading, "lead consultationHeading");
  const consultationTopics = validateConsultationTopics(lead.consultationTopics);
  const consultationThankYouMessage = optionalString(
    lead.consultationThankYouMessage,
    "lead consultationThankYouMessage",
  );
  const additionalDownloads = lead.additionalDownloads === undefined
    ? undefined
    : array(lead.additionalDownloads, "lead additionalDownloads").map((value, index): DownloadResource => {
      const download = record(value, `lead additional download ${index + 1}`);
      const url = requiredString(download.url, `lead additional download ${index + 1} url`);
      if (!downloadPdfPattern.test(url)) {
        invalid(`lead additional download ${index + 1} URL must be a safe /downloads/*.pdf path`);
      }
      return {
        label: requiredString(download.label, `lead additional download ${index + 1} label`),
        url,
      };
    });
  const validatedLead: TalkLead = {
    downloadEnabled: lead.downloadEnabled,
    formHeading: requiredString(lead.formHeading, "lead formHeading"),
    consentText: requiredString(lead.consentText, "lead consentText"),
    thankYouMessage: requiredString(lead.thankYouMessage, "lead thankYouMessage"),
    consultationCta: requiredString(lead.consultationCta, "lead consultationCta"),
  };

  if (downloadUrl !== undefined) validatedLead.downloadUrl = downloadUrl;
  if (additionalDownloads !== undefined) validatedLead.additionalDownloads = additionalDownloads;
  if (stageDownloads !== undefined) validatedLead.stageDownloads = stageDownloads;
  if (privacyPolicyUrl !== undefined) validatedLead.privacyPolicyUrl = privacyPolicyUrl;
  if (consultationHeading !== undefined) validatedLead.consultationHeading = consultationHeading;
  if (consultationTopics !== undefined) validatedLead.consultationTopics = consultationTopics;
  if (consultationThankYouMessage !== undefined) {
    validatedLead.consultationThankYouMessage = consultationThankYouMessage;
  }
  return validatedLead;
}

/**
 * Converts untrusted Talk JSON into a Talk only after its runtime
 * structure and published-content requirements have been checked.
 */
function validateTalkWithOrigins(value: unknown, origins?: TalkDocumentOrigins): Talk {
  const manifestDocument = origins?.manifest;
  const presentationDocument = origins?.presentation;
  const talk = validateForDocument(manifestDocument, () => record(value, "talk"));
  const slug = validateForDocument(manifestDocument, () => requiredString(talk.slug, "talk slug"));

  const published = validateForDocument(manifestDocument, () => {
    if (!isCanonicalTalkSlug(slug)) {
      invalid("talk slug is invalid");
    }
    if (typeof talk.published !== "boolean") {
      invalid("talk published must be a boolean");
    }
    return talk.published;
  });

  const scenes = validateForDocument(presentationDocument, () => array(talk.scenes, "scenes").map(validateScene));
  const questions = validateForDocument(manifestDocument, () => array(talk.questions, "questions").map(validateQuestion));
  validateForDocument(presentationDocument, () => assertUniqueIds(scenes, "scenes"));
  validateForDocument(manifestDocument, () => assertUniqueIds(questions, "questions"));

  const validatedTalk: Talk = {
    slug,
    title: validateForDocument(manifestDocument, () => requiredString(talk.title, "talk title")),
    speaker: validateForDocument(manifestDocument, () => requiredString(talk.speaker, "talk speaker")),
    eventName: validateForDocument(manifestDocument, () => requiredString(talk.eventName, "talk eventName")),
    published,
    scenes,
    questions,
    results: validateForDocument(manifestDocument, () => array(talk.results, "results").map(validateResult)),
    lead: validateForDocument(manifestDocument, () => validateLead(talk.lead)),
  };
  const presentation = validateForDocument(presentationDocument, () => validatePresentation(talk.presentation));
  if (presentation !== undefined) validatedTalk.presentation = presentation;

  if (!validatedTalk.published) {
    return validatedTalk;
  }

  validateForDocument(manifestDocument, () => {
    if (validatedTalk.questions.length !== 3) {
      invalid("published talk requires three questions");
    }
    if (validatedTalk.results.length !== 4) {
      invalid("published talk requires four results");
    }
    if (new Set(validatedTalk.results.map((result) => result.stage)).size !== 4) {
      invalid("published talk requires four unique result stages");
    }
  });
  validateForDocument(presentationDocument, () => {
    if (!validatedTalk.scenes.some((scene) => scene.type === "hero")) {
      invalid("published talk requires a hero scene");
    }
    if (!validatedTalk.scenes.some((scene) => scene.type === "questCta")) {
      invalid("published talk requires a quest CTA scene");
    }
  });

  return validatedTalk;
}

export function validateTalk(value: unknown): Talk {
  return validateTalkWithOrigins(value);
}

export function validateTalkBundleRuntime(value: unknown): Talk {
  return validateTalkWithOrigins(value, { manifest: "manifest.json", presentation: "presentation.json" });
}

/**
 * Validates a Talk document together with the flat filename contract used by
 * getTalk: content/talks/<slug>.json and JSON.slug must be the same slug.
 */
export function validateTalkDocument(value: unknown, expectedSlug: string): Talk {
  if (!isCanonicalTalkSlug(expectedSlug)) {
    invalid("talk filename must be a valid lowercase slug");
  }

  const talk = validateTalk(value);
  if (talk.slug !== expectedSlug) {
    invalid("talk slug must match filename");
  }
  return talk;
}
