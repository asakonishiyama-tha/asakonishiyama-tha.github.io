import type { DiagnosisStage } from "@/lib/diagnosis/score";

import type { Scene, Talk, TalkPresentation } from "./talk-types";

export type TalkSourceLink = {
  label: string;
  url: string;
  kind: "notion" | "official" | "research";
};

export type TalkManifest = Omit<Talk, "presentation" | "scenes"> & {
  formatVersion: 2;
  sourceLinks: TalkSourceLink[];
};

export type TalkPresentationDocument = {
  slug: string;
  presentation?: TalkPresentation;
  scenes: Array<Scene & { evidenceRefs: string[] }>;
};

export type EvidenceKind = "fact" | "case" | "quote" | "tha-synthesis" | "tha-viewpoint";
export type EvidenceProvenance = "official" | "interview" | "secondary" | "tha-synthesis";

export type EvidenceItem = {
  id: string;
  kind: EvidenceKind;
  claim: string;
  provenance: EvidenceProvenance;
  value?: string;
  unit?: string;
  asOf?: string;
  sourceTitle?: string;
  sourceUrl?: string;
  publisher?: string;
  publishedAt?: string;
  permissionNote?: string;
  lastVerifiedAt: string;
  verifiedBy: string;
};

export type TalkEvidenceDocument = { slug: string; items: EvidenceItem[] };

export type HandoutBlock = {
  id: string;
  heading: string;
  body: string[];
  evidenceRefs: string[];
  takeaway?: string;
};

export type TalkHandoutDocument = {
  slug: string;
  title: string;
  subtitle: string;
  summary: string;
  chapters: HandoutBlock[];
  closingAction: string;
};

export type TalkWorksheetDocument = {
  slug: string;
  stage: DiagnosisStage;
  title: string;
  currentState: string;
  prompts: string[];
  sevenDayAction: string;
  nextStageSignal: string;
};

export type TalkBundle = {
  manifest: TalkManifest;
  presentation: TalkPresentationDocument;
  handout: TalkHandoutDocument;
  evidence: TalkEvidenceDocument;
  worksheets: Record<DiagnosisStage, TalkWorksheetDocument>;
};
