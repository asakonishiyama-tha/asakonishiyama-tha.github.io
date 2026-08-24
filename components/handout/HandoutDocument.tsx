import type {
  EvidenceItem,
  HandoutBlock,
  TalkBundle,
} from "@/lib/content/talk-bundle-types";

import styles from "./handout.module.css";

type HandoutFigure = {
  alt: string;
  caption?: string;
  id: string;
  sourceNote: string;
  src: string;
};

function imageFigures(bundle: TalkBundle): HandoutFigure[] {
  return bundle.presentation.scenes.flatMap((scene) => {
    if (!("image" in scene) || typeof scene.image !== "string" || scene.image.length === 0) return [];
    if (!("sourceNote" in scene) || typeof scene.sourceNote !== "string" || scene.sourceNote.length === 0) return [];

    if (!("alt" in scene) || typeof scene.alt !== "string" || scene.alt.length === 0) return [];
    const alt = scene.alt;
    const caption = "caption" in scene && typeof scene.caption === "string" ? scene.caption : undefined;

    return [{
      alt,
      ...(caption ? { caption } : {}),
      id: scene.id,
      sourceNote: scene.sourceNote,
      src: scene.image,
    }];
  });
}

function referencedEvidence(bundle: TalkBundle): EvidenceItem[] {
  const referencedIds = bundle.handout.chapters.flatMap((chapter) => chapter.evidenceRefs);
  const orderedUniqueIds = [...new Set(referencedIds)];
  const evidenceById = new Map(bundle.evidence.items.map((item) => [item.id, item]));

  return orderedUniqueIds.flatMap((id) => {
    const evidence = evidenceById.get(id);
    return evidence ? [evidence] : [];
  });
}

function evidenceLabel(evidence: EvidenceItem): "THA SYNTHESIS" | "THA VIEWPOINT" | null {
  if (evidence.kind === "tha-viewpoint") return "THA VIEWPOINT";
  if (evidence.provenance === "tha-synthesis") return "THA SYNTHESIS";
  return null;
}

function chapterLabels(bundle: TalkBundle, chapter: HandoutBlock): Array<"THA SYNTHESIS" | "THA VIEWPOINT"> {
  const evidenceById = new Map(bundle.evidence.items.map((item) => [item.id, item]));
  return [...new Set(chapter.evidenceRefs.flatMap((id) => {
    const evidence = evidenceById.get(id);
    const label = evidence ? evidenceLabel(evidence) : null;
    return label ? [label] : [];
  }))];
}

function provenanceLabel(evidence: EvidenceItem): string {
  if (evidence.provenance === "official") return "公式情報ベース";
  if (evidence.provenance === "interview") return "THA取材";
  if (evidence.provenance === "secondary") return "二次資料";
  return evidenceLabel(evidence) ?? "THA SYNTHESIS";
}

function Figure({ figure, cover = false }: Readonly<{ figure: HandoutFigure; cover?: boolean }>) {
  return (
    <figure className={`${styles.figure} ${cover ? styles.coverFigure : ""}`}>
      <img alt={figure.alt} src={figure.src} />
      <figcaption>
        {figure.caption ? <span>{figure.caption}</span> : null}
        <span>{figure.sourceNote}</span>
      </figcaption>
    </figure>
  );
}

function PageChrome({ eventName, title }: Readonly<{ eventName: string; title: string }>) {
  return (
    <>
      <div aria-hidden="true" className={styles.printHeader} data-print-chrome="header">
        <span>{eventName}</span>
        <span>READING HANDOUT</span>
      </div>
      <div aria-hidden="true" className={styles.printFooter} data-print-chrome="footer">
        <span>{title}</span>
      </div>
    </>
  );
}

function ReferenceList({ evidence, start }: Readonly<{ evidence: EvidenceItem[]; start: number }>) {
  return (
    <div className={styles.referenceSection}>
      <p className={styles.referenceContinuation}>REFERENCE NOTES / 出典一覧</p>
      <ol aria-label="参考文献一覧" className={styles.referenceList} start={start}>
        {evidence.map((item, index) => (
          <li className={styles.referenceItem} key={item.id}>
            <span aria-hidden="true" className={styles.referenceNumber}>[{start + index}]</span>
            <p className={styles.referenceKind}>{provenanceLabel(item)}</p>
            <cite>{item.sourceTitle ?? item.claim}</cite>
            {item.sourceUrl ? <a href={item.sourceUrl}>{item.sourceUrl}</a> : null}
            <p className={styles.referenceMeta}>
              {item.asOf ? <span>情報時点：{item.asOf}</span> : null}
              <span>最終確認：{item.lastVerifiedAt}</span>
              {item.publisher ? <span>発行・取材：{item.publisher}</span> : null}
            </p>
            {item.permissionNote ? <p className={styles.permissionNote}>権利・掲載注記：{item.permissionNote}</p> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function HandoutDocument({ bundle }: Readonly<{ bundle: TalkBundle }>) {
  const figures = imageFigures(bundle);
  const evidence = referencedEvidence(bundle);
  const referenceNumbers = new Map(evidence.map((item, index) => [item.id, index + 1]));
  const evidencePages = Array.from(
    { length: Math.ceil(evidence.length / 4) },
    (_, index) => evidence.slice(index * 4, index * 4 + 4),
  );
  const [coverFigure, ...contentFigures] = figures;

  return (
    <article className={styles.document} data-handout-document lang="ja">
      <header className={styles.cover}>
        <PageChrome eventName={bundle.manifest.eventName} title={bundle.manifest.title} />
        <div className={styles.coverCopy}>
          <p className={styles.eyebrow}>{bundle.manifest.eventName}</p>
          <h1>{bundle.handout.title}</h1>
          <p className={styles.subtitle}>{bundle.handout.subtitle}</p>
          <p className={styles.summary}>{bundle.handout.summary}</p>
          <dl className={styles.coverMeta}>
            <div><dt>SESSION</dt><dd>{bundle.manifest.eventName}</dd></div>
            <div><dt>SPEAKER</dt><dd>{bundle.manifest.speaker}</dd></div>
          </dl>
        </div>
        {coverFigure ? <Figure cover figure={coverFigure} /> : null}
      </header>

      <main>
        {bundle.handout.chapters.map((chapter, index) => {
          const labels = chapterLabels(bundle, chapter);
          const isReferences = chapter.id === "references";
          const isRisk = chapter.id === "two-risks";
          const chapterReferences = chapter.evidenceRefs.flatMap((id) => {
            const number = referenceNumbers.get(id);
            return number ? [number] : [];
          });

          return (
            <section
              aria-labelledby={`${chapter.id}-heading`}
              className={`${styles.chapter} ${isRisk ? styles.riskChapter : ""}`}
              key={chapter.id}
            >
              <PageChrome eventName={bundle.manifest.eventName} title={bundle.manifest.title} />
              <p className={styles.chapterNumber}>CHAPTER {String(index + 1).padStart(2, "0")}</p>
              <h2 id={`${chapter.id}-heading`}>{chapter.heading}</h2>
              {labels.length > 0 ? (
                <div aria-label="THAによる整理・見解" className={styles.evidenceLabels}>
                  {labels.map((label) => <span key={label}>{label}</span>)}
                </div>
              ) : null}
              <div className={styles.chapterBody}>
                {chapter.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              </div>
              {chapter.id === "time-assets"
                ? contentFigures.map((figure) => <Figure figure={figure} key={figure.id} />)
                : null}
              {chapter.takeaway ? (
                <div aria-label="この章の要点" className={styles.takeaway} role="note">
                  <p className={styles.calloutLabel}>TAKEAWAY</p>
                  <p>{chapter.takeaway}</p>
                </div>
              ) : null}
              {!isReferences && chapterReferences.length > 0 ? (
                <p className={styles.inlineReferences}>参照：{chapterReferences.map((number) => `[${number}]`).join(" ")}</p>
              ) : null}
            </section>
          );
        })}
        <section aria-label="参考文献" className={styles.referencesAppendix}>
          {evidencePages.map((pageEvidence, index) => (
            <div className={styles.referencePage} key={pageEvidence[0]?.id ?? index}>
              <PageChrome eventName={bundle.manifest.eventName} title={bundle.manifest.title} />
              <ReferenceList evidence={pageEvidence} start={index * 4 + 1} />
            </div>
          ))}
        </section>
        <section aria-label="行動ページ" className={styles.closingPage}>
          <PageChrome eventName={bundle.manifest.eventName} title={bundle.manifest.title} />
          <div aria-label="7日以内の行動" className={styles.closingAction} role="note">
            <p className={styles.calloutLabel}>NEXT ACTION / 7 DAYS</p>
            <p>{bundle.handout.closingAction}</p>
          </div>
        </section>
      </main>
    </article>
  );
}
