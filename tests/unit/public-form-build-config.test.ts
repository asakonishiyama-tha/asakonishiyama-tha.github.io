import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const configUrl = pathToFileURL(path.join(repositoryRoot, "next.config.ts")).href;
const productionSiteUrl = "https://asakonishiyama-tha.github.io";
const validGasUrl = "https://script.google.com/macros/s/AKfycb_test-Deployment_123/exec";
const validPrivacyUrl = "https://privacy.example/policy";
const credentialedGasUrl = ["https://user:password", "script.google.com/macros/s/deployment/exec"].join("@");
const credentialedPrivacyUrl = ["https://user:password", "privacy.example/policy"].join("@");
const localGasUrl = ["http://127.0.0.1:3201", "exec"].join("/");

function evaluateConfig(environment: Record<string, string | undefined>) {
  const childEnvironment = { ...process.env };
  for (const key of [
    "NEXT_PUBLIC_GAS_WEB_APP_URL",
    "NEXT_PUBLIC_PRIVACY_POLICY_URL",
    "NEXT_PUBLIC_SITE_URL",
  ]) delete childEnvironment[key];
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined) childEnvironment[key] = value;
  }
  return spawnSync(process.execPath, [
    "--experimental-strip-types",
    "--input-type=module",
    "--eval",
    `await import(${JSON.stringify(`${configUrl}?case=${Math.random()}`)})`,
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: childEnvironment,
  });
}

describe("public form build activation contract", () => {
  it("keeps a production build disabled when both public form values are blank", () => {
    const result = evaluateConfig({
      NEXT_PUBLIC_GAS_WEB_APP_URL: "",
      NEXT_PUBLIC_PRIVACY_POLICY_URL: "",
      NEXT_PUBLIC_SITE_URL: productionSiteUrl,
    });

    expect(result.status).toBe(0);
  });

  it("accepts an exact Apps Script deployment URL paired with an absolute HTTPS privacy URL", () => {
    const result = evaluateConfig({
      NEXT_PUBLIC_GAS_WEB_APP_URL: validGasUrl,
      NEXT_PUBLIC_PRIVACY_POLICY_URL: validPrivacyUrl,
      NEXT_PUBLIC_SITE_URL: productionSiteUrl,
    });

    expect(result.status).toBe(0);
  });

  it.each([
    ["GAS only", validGasUrl, ""],
    ["privacy only", "", validPrivacyUrl],
    ["wrong HTTPS origin", "https://gas.example/macros/s/deployment/exec", validPrivacyUrl],
    ["GAS query", `${validGasUrl}?mode=prod`, validPrivacyUrl],
    ["GAS fragment", `${validGasUrl}#prod`, validPrivacyUrl],
    ["GAS credentials", credentialedGasUrl, validPrivacyUrl],
    ["GAS alias", "https://www.script.google.com/macros/s/deployment/exec", validPrivacyUrl],
    ["GAS trailing slash", `${validGasUrl}/`, validPrivacyUrl],
    ["overlong deployment ID", `https://script.google.com/macros/s/${"a".repeat(257)}/exec`, validPrivacyUrl],
    ["HTTP privacy", validGasUrl, "http://privacy.example/policy"],
    ["privacy credentials", validGasUrl, credentialedPrivacyUrl],
  ])("rejects a partial or invalid production pair without echoing values: %s", (_label, gas, privacy) => {
    const result = evaluateConfig({
      NEXT_PUBLIC_GAS_WEB_APP_URL: gas,
      NEXT_PUBLIC_PRIVACY_POLICY_URL: privacy,
      NEXT_PUBLIC_SITE_URL: productionSiteUrl,
    });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).not.toBe(0);
    expect(output).toMatch(/public form configuration is invalid/i);
    if (gas) expect(output).not.toContain(gas);
    if (privacy) expect(output).not.toContain(privacy);
  });

  it("allows an explicit loopback GAS endpoint only with a loopback site origin", () => {
    const local = evaluateConfig({
      NEXT_PUBLIC_GAS_WEB_APP_URL: localGasUrl,
      NEXT_PUBLIC_PRIVACY_POLICY_URL: validPrivacyUrl,
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
    });
    const production = evaluateConfig({
      NEXT_PUBLIC_GAS_WEB_APP_URL: localGasUrl,
      NEXT_PUBLIC_PRIVACY_POLICY_URL: validPrivacyUrl,
      NEXT_PUBLIC_SITE_URL: productionSiteUrl,
    });

    expect(local.status).toBe(0);
    expect(production.status).not.toBe(0);
  });
});
