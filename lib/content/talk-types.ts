import type { DiagnosisStage } from "@/lib/diagnosis/score";
import type { ConsultationTopicOption } from "@/lib/leads/consultation-topics";

export type Scene =
  | HeroScene
  | StatementScene
  | PhotoStoryScene
  | CardsScene
  | CaseStudyScene
  | QuestCtaScene
  | LeadCtaScene;

type BaseScene = {
  id: string;
};

export type HeroScene = BaseScene & {
  type: "hero";
  heading: string;
  alt?: string;
  supportingText?: string;
  image?: string;
  video?: string;
  sourceNote?: string;
  atmosphere?: HeroAtmosphere;
};

export type StatementScene = BaseScene & {
  type: "statement";
  statement: string;
  emphasizedText?: string;
  tone?: SceneTone;
};

export type PhotoStoryScene = BaseScene & {
  type: "photoStory";
  image: string;
  alt: string;
  caption?: string;
  sourceNote?: string;
};

export type CardsScene = BaseScene & {
  type: "cards";
  heading: string;
  cards: Array<{ title: string; description: string }>;
  sourceNote?: string;
};

export type CaseStudyScene = BaseScene & {
  type: "caseStudy";
  organization: string;
  heading?: string;
  challenge: string;
  approach: string;
  outcome: string;
  image?: string;
  alt?: string;
  sourceNote?: string;
};

export type QuestCtaScene = BaseScene & {
  type: "questCta";
  heading: string;
  description: string;
  buttonLabel: string;
};

export type LeadCtaScene = BaseScene & {
  type: "leadCta";
  heading: string;
  description: string;
  downloadLabel: string;
  consultationLabel: string;
};

export type DiagnosisQuestion = {
  id: string;
  prompt: string;
  options: Array<{ label: string; score: number }>;
};

export type DiagnosisStageResult = {
  stage: DiagnosisStage;
  title: string;
  rpgSubtitle: string;
  description: string;
  nextQuest: string;
};

export type DownloadResource = {
  label: string;
  url: string;
};

export type SceneTone = "default" | "crisis";
export type HeroAtmosphere = "timeMesh";

export type TalkPresentation = {
  heroKicker?: string;
  scrollPrompt?: string;
  resultEyebrow?: string;
  nextActionLabel?: string;
};

export type StageDownloadResource = {
  stage: DiagnosisStage;
  url: string;
};

export type TalkLead = {
  downloadEnabled: boolean;
  downloadUrl?: string;
  additionalDownloads?: DownloadResource[];
  stageDownloads?: StageDownloadResource[];
  formHeading: string;
  consentText: string;
  thankYouMessage: string;
  consultationCta: string;
  consultationHeading?: string;
  consultationTopics?: ConsultationTopicOption[];
  consultationThankYouMessage?: string;
  privacyPolicyUrl?: string;
};

export type Talk = {
  slug: string;
  title: string;
  speaker: string;
  eventName: string;
  published: boolean;
  scenes: Scene[];
  questions: DiagnosisQuestion[];
  results: DiagnosisStageResult[];
  lead: TalkLead;
  presentation?: TalkPresentation;
};
