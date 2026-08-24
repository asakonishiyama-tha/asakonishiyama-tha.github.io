import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");

async function readRepositoryFile(relativePath: string): Promise<string> {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

function bodyWordCount(markdown: string): number {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, "");
  return body.trim().split(/\s+/u).filter(Boolean).length;
}

describe("project managing-tha-talks skill", () => {
  it("is discoverable, concise, and routes Claude Code to one canonical contract", async () => {
    const [skill, claudeLoader, interfaceYaml] = await Promise.all([
      readRepositoryFile(".agents/skills/managing-tha-talks/SKILL.md"),
      readRepositoryFile(".claude/skills/managing-tha-talks/SKILL.md"),
      readRepositoryFile(".agents/skills/managing-tha-talks/agents/openai.yaml"),
    ]);

    expect(skill).toMatch(/^---\nname: managing-tha-talks\ndescription: Use when /);
    expect(bodyWordCount(skill)).toBeLessThanOrEqual(500);
    expect(skill).toContain("references/project-contract.md");
    expect(claudeLoader).toContain("../../../.agents/skills/managing-tha-talks/SKILL.md");
    expect(claudeLoader).toMatch(/read[\s\S]+completely|完全に読む/i);
    expect(interfaceYaml).toContain("display_name:");
    expect(interfaceYaml).toContain("default_prompt:");
  });

  it("keeps the president conversation simple while resolving the five decision themes", async () => {
    const skill = await readRepositoryFile(".agents/skills/managing-tha-talks/SKILL.md");

    expect(skill).toMatch(/一度に1問|one question at a time/i);
    for (const theme of ["対象者", "変化", "行動", "根拠", "持ち帰り"]) {
      expect(skill).toContain(theme);
    }
    expect(skill).toMatch(/A\/B|2案|二案/);
    expect(skill).toMatch(/相談|Conversation/);
    for (const mode of ["Add", "Create", "Improve", "Review-only"]) {
      expect(skill).toContain(mode);
    }
    expect(skill).toMatch(/Review-only[\s\S]*(?:編集|commit|push|公開)[\s\S]*(?:しない|禁止)/i);
  });

  it("binds Talk work to current repository facts, private drafts, QA, and separate approvals", async () => {
    const contract = await readRepositoryFile(
      ".agents/skills/managing-tha-talks/references/project-contract.md",
    );

    expect(contract).toContain("github.com/asakonishiyama-tha/asakonishiyama-tha.github.io");
    expect(contract).toContain("github.com/THA-inc/ai_president_mock");
    expect(contract).toMatch(/公開リポジトリ[\s\S]*(?:下書き|未承認)[\s\S]*(?:入れない|pushしない)/);
    for (const command of [
      "npm run validate:content",
      "npm run validate:assets",
      "npm test",
      "npm run typecheck",
      "npm run build",
      "npm run verify:static",
      "npm run release:scan -- out",
      "npm run test:e2e",
    ]) {
      expect(contract).toContain(command);
    }
    expect(contract).toMatch(/desktop|1440/i);
    expect(contract).toContain("390");
    expect(contract).toContain("1920");
    expect(contract).toMatch(/reduced motion|prefers-reduced-motion/i);
    expect(contract).toMatch(/commit[\s\S]*push[\s\S]*(?:Pages|公開)[\s\S]*GAS[\s\S]*Sheet[\s\S]*(?:メール|autoresponder)[\s\S]*Slack/i);
    expect(contract).toMatch(/10個|10 gates|10ゲート/i);
    expect(contract).toMatch(/docs\/launch-checklist\.md/);
  });

  it("is included exactly in the deny-by-default public manifest and documented for non-engineers", async () => {
    const [manifestSource, readme] = await Promise.all([
      readRepositoryFile("release/public-files.json"),
      readRepositoryFile("README.md"),
    ]);
    const manifest = JSON.parse(manifestSource) as { directories: string[]; files: string[] };
    const expectedSkillFiles = [
      ".agents/skills/managing-tha-talks/SKILL.md",
      ".agents/skills/managing-tha-talks/agents/openai.yaml",
      ".agents/skills/managing-tha-talks/references/project-contract.md",
      ".claude/skills/managing-tha-talks/SKILL.md",
    ];

    for (const file of expectedSkillFiles) expect(manifest.files).toContain(file);
    expect(manifest.directories).not.toContain(".agents");
    expect(manifest.directories).not.toContain(".claude");
    expect(readme).toContain("$managing-tha-talks");
    expect(readme).toMatch(/西山社長|社長/);
    expect(readme).toMatch(/自然な日本語|技術用語.*不要/);
  });
});
