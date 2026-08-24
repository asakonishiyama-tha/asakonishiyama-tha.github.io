import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Mapping = Record<string, unknown>;

type WorkflowStep = Mapping & {
  env?: Mapping;
  id?: string;
  run?: string;
  uses?: string;
  with?: Mapping;
};

const require = createRequire(import.meta.url);
const requireFromEslintConfig = createRequire(require.resolve("@eslint/eslintrc"));
const { load: loadYaml } = requireFromEslintConfig("js-yaml") as {
  load: (source: string) => unknown;
};

const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const qualityGates = [
  "npm run validate:content",
  "npm run validate:assets",
  "npm test",
  "npm run typecheck",
  "npm run build",
  "npm run verify:static",
  "npm run release:scan -- out",
  "npm run test:e2e",
] as const;
const publicCandidateScript = [
  "mkdir -m 700 -- \"$PUBLIC_SOURCE_CANDIDATE\"",
  "npm run release:prepare -- --output \"$PUBLIC_SOURCE_CANDIDATE\"",
  "node \"$PUBLIC_SOURCE_CANDIDATE/scripts/scan-release-safety.mjs\" \"$PUBLIC_SOURCE_CANDIDATE\"",
].join("\n");
const canonicalDisabledEnvironment = {
  NEXT_PUBLIC_GAS_WEB_APP_URL: "",
  NEXT_PUBLIC_PRIVACY_POLICY_URL: "",
  NEXT_PUBLIC_SITE_URL: "https://asakonishiyama-tha.github.io",
};
const approvedActivationEnvironment = {
  NEXT_PUBLIC_GAS_WEB_APP_URL: "${{ vars.NEXT_PUBLIC_GAS_WEB_APP_URL || '' }}",
  NEXT_PUBLIC_PRIVACY_POLICY_URL: "${{ vars.NEXT_PUBLIC_PRIVACY_POLICY_URL || '' }}",
  NEXT_PUBLIC_SITE_URL: "https://asakonishiyama-tha.github.io",
};
const hostedVerificationCommand = [
  "node scripts/verify-hosted-deployment.mjs \\",
  "  --base-url \"$DEPLOYED_PAGE_URL\" \\",
  "  --gas-web-app-url \"$APPROVED_GAS_WEB_APP_URL\" \\",
  "  --privacy-policy-url \"$APPROVED_PRIVACY_POLICY_URL\"",
].join("\n");
const officialActionPins = {
  "actions/checkout": "3d3c42e5aac5ba805825da76410c181273ba90b1",
  "actions/configure-pages": "45bfe0192ca1faeb007ade9deae92b16b8254a0d",
  "actions/deploy-pages": "cd2ce8fcbc39b97be8ca5fce6e763baed58fa128",
  "actions/setup-node": "820762786026740c76f36085b0efc47a31fe5020",
  "actions/upload-pages-artifact": "fc324d3547104276b827a68afc52ff2a11cc49c9",
} as const;

function mapping(value: unknown, label: string): Mapping {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a mapping`);
  }
  return value as Mapping;
}

async function readWorkflow(filename: "ci.yml" | "pages.yml"): Promise<Mapping> {
  const relativePath = `.github/workflows/${filename}`;
  let source: string;
  try {
    source = await readFile(path.join(repositoryRoot, relativePath), "utf8");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      throw new Error(`Missing workflow contract: ${relativePath}`);
    }
    throw error;
  }
  return mapping(loadYaml(source), relativePath);
}

function jobs(workflow: Mapping): Mapping {
  return mapping(workflow.jobs, "jobs");
}

function job(workflow: Mapping, name: string): Mapping {
  return mapping(jobs(workflow)[name], `jobs.${name}`);
}

function steps(workflowJob: Mapping): WorkflowStep[] {
  if (!Array.isArray(workflowJob.steps)) throw new TypeError("job steps must be an array");
  return workflowJob.steps.map((step, index) => mapping(step, `steps[${index}]`) as WorkflowStep);
}

function uses(workflow: Mapping): string[] {
  return Object.values(jobs(workflow)).flatMap((value) => steps(mapping(value, "job")))
    .map((step) => step.uses)
    .filter((value): value is string => typeof value === "string");
}

function gateCommands(workflowJob: Mapping): string[] {
  return steps(workflowJob).flatMap((step) => typeof step.run === "string" ? step.run.split("\n") : [])
    .map((command) => command.trim())
    .filter((command) => qualityGates.includes(command as typeof qualityGates[number]));
}

function runCommands(workflowJob: Mapping): string[] {
  return steps(workflowJob).map((step) => step.run)
    .filter((command): command is string => typeof command === "string");
}

function stepIndex(workflowJob: Mapping, predicate: (step: WorkflowStep) => boolean): number {
  return steps(workflowJob).findIndex(predicate);
}

function expectPinnedOfficialActions(workflow: Mapping, expectedRepositories: string[]): void {
  const invocations = uses(workflow);
  expect(invocations).toHaveLength(expectedRepositories.length);
  expect(invocations.map((invocation) => invocation.split("@")[0])).toEqual(expectedRepositories);
  for (const invocation of invocations) {
    expect(invocation).toMatch(/^[a-z0-9-]+\/[a-z0-9-]+@[0-9a-f]{40}$/);
    const [repository, sha] = invocation.split("@");
    expect(officialActionPins[repository as keyof typeof officialActionPins]).toBe(sha);
  }
}

function expectVerifiedPublicCandidateBeforeGates(workflowJob: Mapping): void {
  const candidateIndex = stepIndex(workflowJob, (step) => step.run === publicCandidateScript);
  expect(candidateIndex).toBeGreaterThan(-1);
  expect(steps(workflowJob)[candidateIndex]?.env).toEqual({
    PUBLIC_SOURCE_CANDIDATE: "${{ runner.temp }}/public-source-candidate",
  });
  const firstGateIndex = stepIndex(workflowJob, (step) => step.run === qualityGates[0]);
  expect(candidateIndex).toBeLessThan(firstGateIndex);
}

describe("GitHub workflow contracts", () => {
  it("runs non-deploying CI for every branch push and pull request with least privilege", async () => {
    const workflow = await readWorkflow("ci.yml");

    expect(workflow.on).toEqual({
      pull_request: null,
      push: { branches: ["**"] },
    });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(Object.keys(jobs(workflow))).toEqual(["verify"]);
    expect(workflow.env).toBeUndefined();
    expect(job(workflow, "verify").environment).toBeUndefined();
    expect(job(workflow, "verify").permissions).toBeUndefined();
    expect(JSON.stringify(workflow)).not.toMatch(/secrets\.|deploy-pages|pages:write|id-token:write/i);
  });

  it("runs Pages for main pushes or explicit dispatch while every job remains main-only", async () => {
    const workflow = await readWorkflow("pages.yml");

    expect(workflow.on).toEqual({
      push: { branches: ["main"] },
      workflow_dispatch: null,
    });
    expect(workflow.concurrency).toEqual({
      "cancel-in-progress": true,
      group: "pages",
    });
    expect(workflow.permissions).toEqual({ contents: "read" });
    expect(workflow.env).toBeUndefined();
    expect(JSON.stringify(workflow)).not.toMatch(/secrets\./i);
    expect(Object.keys(jobs(workflow))).toEqual(["build", "deploy", "verify"]);
    for (const name of ["build", "deploy", "verify"]) {
      expect(job(workflow, name).if).toBe("github.ref == 'refs/heads/main'");
    }
  });

  it("uses Node 24, npm ci, Chromium, approval-safe build env, and immutable official action pins", async () => {
    const ci = await readWorkflow("ci.yml");
    const pages = await readWorkflow("pages.yml");

    for (const [workflowJob, expectedEnvironment] of [
      [job(ci, "verify"), canonicalDisabledEnvironment],
      [job(pages, "build"), approvedActivationEnvironment],
    ] as const) {
      const workflowSteps = steps(workflowJob);
      expect(workflowJob.env).toBeUndefined();
      const setupNode = workflowSteps.find((step) => step.uses?.startsWith("actions/setup-node@"));
      const productionBuild = workflowSteps.find((step) => step.run === "npm run build");
      expect(setupNode?.with).toEqual({ cache: "npm", "node-version": 24 });
      expect(productionBuild?.env).toEqual(expectedEnvironment);
      expect(workflowSteps.some((step) => step.run === "npm ci")).toBe(true);
      const browserInstallIndex = stepIndex(
        workflowJob,
        (step) => step.run === "npx playwright install --with-deps chromium",
      );
      const e2eIndex = stepIndex(workflowJob, (step) => step.run === "npm run test:e2e");
      expect(browserInstallIndex).toBeGreaterThan(-1);
      expect(browserInstallIndex).toBeLessThan(e2eIndex);
    }
    expectPinnedOfficialActions(ci, ["actions/checkout", "actions/setup-node"]);
    expectPinnedOfficialActions(pages, [
      "actions/checkout",
      "actions/setup-node",
      "actions/configure-pages",
      "actions/upload-pages-artifact",
      "actions/deploy-pages",
      "actions/checkout",
      "actions/setup-node",
    ]);
  });

  it("builds and scans a public-source candidate before the exact ordered gates", async () => {
    const ci = await readWorkflow("ci.yml");
    const pages = await readWorkflow("pages.yml");

    for (const workflowJob of [job(ci, "verify"), job(pages, "build")]) {
      expectVerifiedPublicCandidateBeforeGates(workflowJob);
      expect(gateCommands(workflowJob)).toEqual(qualityGates);
      expect(runCommands(workflowJob)).toEqual([
        "npm ci",
        "npx playwright install --with-deps chromium",
        publicCandidateScript,
        ...qualityGates,
      ]);
    }
  });

  it("isolates the privileged deploy action from read-only hosted verification", async () => {
    const workflow = await readWorkflow("pages.yml");
    const build = job(workflow, "build");
    const deploy = job(workflow, "deploy");
    const verify = job(workflow, "verify");
    const uploadIndex = stepIndex(
      build,
      (step) => step.uses?.startsWith("actions/upload-pages-artifact@") === true,
    );
    const e2eIndex = stepIndex(build, (step) => step.run === "npm run test:e2e");
    const upload = steps(build)[uploadIndex];

    expect(uploadIndex).toBeGreaterThan(e2eIndex);
    expect(upload?.with).toEqual({ path: "out" });
    expect(deploy.needs).toBe("build");
    expect(deploy.permissions).toEqual({ "id-token": "write", pages: "write" });
    expect(deploy.outputs).toEqual({
      page_url: "${{ steps.deployment.outputs.page_url }}",
    });
    expect(deploy.environment).toEqual({
      name: "github-pages",
      url: "${{ steps.deployment.outputs.page_url }}",
    });
    const deploySteps = steps(deploy);
    expect(deploySteps).toEqual([expect.objectContaining({
      id: "deployment",
      uses: `actions/deploy-pages@${officialActionPins["actions/deploy-pages"]}`,
    })]);
    expect(deploySteps[0]?.run).toBeUndefined();
    expect(JSON.stringify(deploySteps)).not.toMatch(/checkout|persist-credentials|scripts\//i);

    expect(verify.needs).toBe("deploy");
    expect(verify.permissions).toEqual({ contents: "read" });
    expect(verify.environment).toBeUndefined();
    const verifySteps = steps(verify);
    expect(verifySteps.map((step) => step.uses).filter(Boolean)).toEqual([
      `actions/checkout@${officialActionPins["actions/checkout"]}`,
      `actions/setup-node@${officialActionPins["actions/setup-node"]}`,
    ]);
    expect(verifySteps[0]?.with).toEqual({ "persist-credentials": false });
    expect(verifySteps[1]?.with).toEqual({ "node-version": 24 });
    const hostedStep = verifySteps.find((step) => step.run === hostedVerificationCommand);
    expect(hostedStep?.env).toEqual({
      APPROVED_GAS_WEB_APP_URL: "${{ vars.NEXT_PUBLIC_GAS_WEB_APP_URL || '' }}",
      APPROVED_PRIVACY_POLICY_URL: "${{ vars.NEXT_PUBLIC_PRIVACY_POLICY_URL || '' }}",
      DEPLOYED_PAGE_URL: "${{ needs.deploy.outputs.page_url }}",
    });
    expect(JSON.stringify(verify)).not.toMatch(/secrets\.|pages:write|id-token:write|deploy-pages/i);
    expect(JSON.stringify(verifySteps)).not.toMatch(/delete|unpublish|disable-pages/i);
  });

  it("grants configure-pages only the read permissions its metadata request needs", async () => {
    const workflow = await readWorkflow("pages.yml");
    const build = job(workflow, "build");

    expect(build.permissions).toEqual({ contents: "read", pages: "read" });
    expect(steps(build).some((step) => (
      step.uses === `actions/configure-pages@${officialActionPins["actions/configure-pages"]}`
    ))).toBe(true);
    expect(JSON.stringify(build.permissions)).not.toMatch(/write|id-token/i);
  });

  it("offers no dispatch bypass around public-source scanning or the complete ordered gates", async () => {
    const workflow = await readWorkflow("pages.yml");
    const build = job(workflow, "build");
    const deploy = job(workflow, "deploy");
    const verify = job(workflow, "verify");

    expectVerifiedPublicCandidateBeforeGates(build);
    expect(gateCommands(build)).toEqual(qualityGates);
    expect(stepIndex(build, (step) => step.uses?.startsWith("actions/upload-pages-artifact@") === true))
      .toBeGreaterThan(stepIndex(build, (step) => step.run === qualityGates.at(-1)));
    expect(deploy.needs).toBe("build");
    expect(verify.needs).toBe("deploy");
    expect(workflow.on).not.toHaveProperty("workflow_call");
    expect(mapping(workflow.on, "on").workflow_dispatch).toBeNull();
  });

  it("publishes only the two exact workflow files through the deny-by-default manifest", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(repositoryRoot, "release/public-files.json"), "utf8"),
    ) as { directories: string[]; files: string[] };

    expect(manifest.directories).not.toContain(".github");
    expect(manifest.files.filter((file) => file.startsWith(".github/"))).toEqual([
      ".github/workflows/ci.yml",
      ".github/workflows/pages.yml",
    ]);
  });
});
