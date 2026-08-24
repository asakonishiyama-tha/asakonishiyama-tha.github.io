import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const applicationRoots = ["app/", "components/", "lib/", "scripts/", "tina/"];
const forbiddenImportPatterns = [
  /(?:from\s+|import\s*\()\s*["']tinacms(?:\/[^"']*)?["']/,
  /(?:from\s+|import\s*\()\s*["']googleapis(?:\/[^"']*)?["']/,
  /(?:from\s+|import\s*\()\s*["']@?\/app\/api(?:\/[^"']*)?["']/,
  /(?:from\s+|import\s*\()\s*["']@?\/lib\/leads\/(?:google-sheets-sink|lead-route|lead-service|lead-sink|memory-lead-sink|rate-limit|slack-notifier)["']/,
];

function trackedApplicationFiles() {
  return execFileSync("git", ["ls-files", "-z", "--", ...applicationRoots], {
    cwd: projectRoot,
    encoding: "utf8",
  }).split("\0").filter((file) => file && existsSync(path.join(projectRoot, file)));
}

describe("static deployment dependency boundary", () => {
  it("keeps tracked application imports independent of CMS and server-only lead modules", () => {
    const violations = trackedApplicationFiles().flatMap((file) => {
      const source = readFileSync(path.join(projectRoot, file), "utf8");
      return forbiddenImportPatterns.some((pattern) => pattern.test(source)) ? [file] : [];
    });

    expect(violations).toEqual([]);
  });

  it("keeps CMS and Google server SDKs out of package dependencies", () => {
    const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const installedDependencies = {
      ...packageJson.dependencies,
      ...packageJson.devDependencies,
    };

    expect(installedDependencies).not.toHaveProperty("tinacms");
    expect(installedDependencies).not.toHaveProperty("@tinacms/cli");
    expect(installedDependencies).not.toHaveProperty("googleapis");
  });
});
