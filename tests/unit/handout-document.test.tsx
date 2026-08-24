import { readFile } from "node:fs/promises";
import path from "node:path";

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HandoutDocument } from "@/components/handout/HandoutDocument";
import { getTalkBundle } from "@/lib/content/talk-bundle-repository";

afterEach(cleanup);

describe("HandoutDocument", () => {
  it("renders the reading handout as one semantic document in chapter order", async () => {
    const bundle = await getTalkBundle("ai-president-intro");
    expect(bundle).not.toBeNull();

    const { container } = render(<HandoutDocument bundle={bundle!} />);

    expect(container.querySelector("article")).toHaveAttribute("lang", "ja");
    const printHeaders = container.querySelectorAll('[data-print-chrome="header"]');
    const printFooters = container.querySelectorAll('[data-print-chrome="footer"]');
    expect(printHeaders).toHaveLength(6);
    expect(printFooters).toHaveLength(6);
    for (const header of printHeaders) {
      expect(header).toHaveAttribute("aria-hidden", "true");
      expect(header).toHaveTextContent(bundle!.manifest.eventName);
      expect(header).toHaveTextContent("READING HANDOUT");
    }
    for (const footer of printFooters) {
      expect(footer).toHaveAttribute("aria-hidden", "true");
      expect(footer).toHaveTextContent(bundle!.manifest.title);
    }
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(bundle!.handout.title);
    expect(screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent)).toEqual(
      bundle!.handout.chapters.map((chapter) => chapter.heading),
    );
    const cover = container.querySelector("article > header");
    expect(cover).not.toBeNull();
    expect(cover?.querySelector("p")).toHaveTextContent(bundle!.manifest.eventName);
    expect(container.querySelector("article > main")).not.toBeNull();
    const closingPage = screen.getByRole("region", { name: "行動ページ" });
    const closingAction = within(closingPage).getByText(bundle!.handout.closingAction);
    expect(closingAction).toBeVisible();
    expect(screen.queryByRole("list", { name: "参考文献一覧" })).toBeNull();
    expect(closingAction.closest("section")).toHaveAttribute("aria-label", "行動ページ");
  });

  it("prints only referenced evidence with its available metadata", async () => {
    const loaded = await getTalkBundle("ai-president-intro");
    expect(loaded).not.toBeNull();
    const referenced = loaded!.evidence.items[0];
    const bundle = {
      ...loaded!,
      handout: {
        ...loaded!.handout,
        chapters: loaded!.handout.chapters.map((chapter, index) => (
          index === 0 ? { ...chapter, evidenceRefs: [referenced.id] } : chapter
        )),
      },
      evidence: {
        ...loaded!.evidence,
        items: [
          ...loaded!.evidence.items,
          {
            id: "unused-source",
            kind: "tha-viewpoint" as const,
            claim: "AI利用が個人の時短だけで終わると、会社には何も残らない。",
            provenance: "tha-synthesis" as const,
            lastVerifiedAt: "2026-08-23",
            verifiedBy: "THA",
          },
        ],
      },
    };

    render(<HandoutDocument bundle={bundle} />);

    const references = screen.getAllByRole("list", { name: "参考文献一覧" });
    expect(within(references[0]).getAllByRole("listitem")).toHaveLength(1);
    expect(within(references[0]).getByText(referenced.claim)).toBeVisible();
    expect(within(references[0]).getByText("最終確認：2026-08-23", { exact: true })).toBeVisible();
    expect(within(references[0]).queryByRole("link")).toBeNull();
    expect(screen.queryByText("AI利用が個人の時短だけで終わると、会社には何も残らない。")).toBeNull();
  });

  it("keeps generated-image disclosures and accessible alternatives without motion-only elements", async () => {
    const loaded = await getTalkBundle("ai-president-intro");
    expect(loaded).not.toBeNull();
    const bundle = {
      ...loaded!,
      presentation: {
        ...loaded!.presentation,
        scenes: loaded!.presentation.scenes.map((scene, index) => index === 0 ? {
          ...scene,
          image: "/media/ai-president-intro.webp",
          alt: loaded!.handout.title,
          sourceNote: loaded!.evidence.items[0].claim,
        } : scene),
      },
    };

    const { container } = render(<HandoutDocument bundle={bundle} />);

    const image = screen.getByRole("img", {
      name: loaded!.handout.title,
    });
    expect(image).toBeVisible();
    expect(within(image.closest("figure")!).getByText(loaded!.evidence.items[0].claim)).toBeVisible();
    expect(container.querySelector("[data-scene-motion], video, canvas")).toBeNull();
  });

  it("labels THA viewpoints from evidence semantics without relying on ID or scene-note conventions", async () => {
    const loaded = await getTalkBundle("ai-president-intro");
    expect(loaded).not.toBeNull();
    const evidence = loaded!.evidence.items[0];
    const bundle = {
      ...loaded!,
      presentation: {
        ...loaded!.presentation,
        scenes: loaded!.presentation.scenes.map((scene) => ({ ...scene, evidenceRefs: [] })),
      },
      handout: {
        ...loaded!.handout,
        chapters: loaded!.handout.chapters.map((chapter, index) => (
          index === 0 ? { ...chapter, evidenceRefs: [evidence.id] } : chapter
        )),
      },
      evidence: { ...loaded!.evidence, items: [evidence] },
    };

    render(<HandoutDocument bundle={bundle} />);

    const chapter = screen.getByRole("heading", { name: loaded!.handout.chapters[0].heading }).closest("section");
    expect(chapter).not.toBeNull();
    expect(within(chapter!).getByText("THA VIEWPOINT", { exact: true })).toBeVisible();
    expect(within(screen.getByRole("list", { name: "参考文献一覧" })).getByText(
      "THA VIEWPOINT",
      { exact: true },
    )).toBeVisible();
  });
});

describe("handout print styles", () => {
  it("defines A4 pagination, a 16pt body, THA colors, and exact print color output", async () => {
    const css = await readFile(path.join(process.cwd(), "components", "handout", "handout.module.css"), "utf8");

    expect(css).toMatch(/@page\s*\{/);
    expect(css).toMatch(/break-after:\s*page/);
    expect(css).toMatch(/font-size:\s*16pt/);
    expect(css.toLowerCase()).toContain("#2360f0");
    expect(css.toLowerCase()).toContain("#ffe93c");
    expect(css.toLowerCase()).toContain("#1f2a44");
    expect(css).toMatch(/(?:-webkit-)?print-color-adjust:\s*exact/);

    const printStyles = css.slice(css.indexOf("@media print"), css.indexOf("@page"));
    expect(printStyles).not.toMatch(/min-height:\s*calc\(297mm\s*-\s*38mm\)/);
    expect(printStyles).toMatch(/\.cover::before,[\s\S]*?\.chapter::before\s*\{[\s\S]*?display:\s*none/);
    expect(printStyles).toMatch(/\.referencesAppendix\s*\{[\s\S]*?break-before:\s*page/);
    expect(printStyles).toMatch(/\.closingPage\s*\{[\s\S]*?background:\s*#fff;[\s\S]*?break-before:\s*page/);
    expect(printStyles).toMatch(/\.closingPage \.closingAction\s*\{[\s\S]*?background:\s*#fff/);
    expect(printStyles).toMatch(/\.cover,[\s\S]*?\.chapter,[\s\S]*?\.referencePage,[\s\S]*?\.closingPage\s*\{[\s\S]*?height:\s*284mm;[\s\S]*?padding:\s*12mm 0 14mm;/);
    expect(printStyles).toMatch(/\.printHeader,[\s\S]*?\.printFooter\s*\{[\s\S]*?display:\s*flex;[\s\S]*?position:\s*absolute;/);
    expect(printStyles).toMatch(/\.printHeader\s*\{[\s\S]*?top:\s*0;/);
    expect(printStyles).toMatch(/\.printFooter\s*\{[\s\S]*?bottom:\s*0;/);
    expect(css).toMatch(/\.cover h1,[\s\S]*?\.subtitle,[\s\S]*?\.chapter h2\s*\{[\s\S]*?line-break:\s*strict;[\s\S]*?text-wrap:\s*balance;[\s\S]*?word-break:\s*auto-phrase;/);
    expect(css).not.toContain("@top-left");
    expect(css).not.toMatch(/@page\s*\{[\s\S]*?margin:/);

    const pinkRules = css.match(/[^{}]+\{[^{}]*(?:#fff3f8|#c2185b)[^{}]*\}/gi) ?? [];
    expect(pinkRules.length).toBeGreaterThan(0);
    expect(pinkRules.every((rule) => rule.includes(".riskChapter"))).toBe(true);
  });
});
