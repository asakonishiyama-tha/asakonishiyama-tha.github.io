import { cp, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { verifyStaticExport } from "./verify-static-export.mjs";

const argumentsByName = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  argumentsByName.set(process.argv[index], process.argv[index + 1]);
}

const hostname = argumentsByName.get("--hostname");
const port = argumentsByName.get("--port");
const loopbackHostnames = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);
const explicitLoopbackGasUrl = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d{1,5}\/exec$/i;

if (!hostname || !loopbackHostnames.has(hostname) || !port || !/^\d{1,5}$/.test(port)) {
  throw new Error("E2E server requires a loopback hostname and numeric port.");
}

function validatedFakeGasEndpoint(value) {
  if (!value || !explicitLoopbackGasUrl.test(value)) {
    throw new Error("E2E GAS endpoint must be an explicit loopback http /exec URL with a port.");
  }
  const parsed = new URL(value);
  if (
    parsed.protocol !== "http:"
    || !loopbackHostnames.has(parsed.hostname)
    || parsed.pathname !== "/exec"
    || parsed.search
    || parsed.hash
    || parsed.username
    || parsed.password
    || !parsed.port
  ) {
    throw new Error("E2E GAS endpoint must be an explicit loopback http /exec URL with a port.");
  }
  const appHostname = hostname.includes(":") && !hostname.startsWith("[") ? `[${hostname}]` : hostname;
  if (parsed.origin === `http://${appHostname}:${port}`) {
    throw new Error("E2E GAS endpoint must use a separate loopback origin.");
  }
  return parsed.toString();
}

const fakeGasEndpoint = validatedFakeGasEndpoint(process.env.E2E_GAS_WEB_APP_URL);

const projectRoot = process.cwd();
const temporaryPrefix = path.join(tmpdir(), "hooked-presentation-e2e-");
const workspace = await mkdtemp(temporaryPrefix);
const excludedTopLevelPaths = new Set([
  ".git",
  ".tina",
  "coverage",
  "node_modules",
  "out",
  "playwright-report",
  "test-results",
]);

function shouldCopy(source) {
  const relativePath = path.relative(projectRoot, source);
  if (relativePath === "") return true;
  const topLevelPath = relativePath.split(path.sep)[0];

  return !excludedTopLevelPaths.has(topLevelPath)
    && !topLevelPath.startsWith(".next")
    && !topLevelPath.startsWith(".env");
}

async function cleanup() {
  if (!workspace.startsWith(temporaryPrefix)) {
    throw new Error("Refusing to clean an unexpected E2E workspace path.");
  }
  await rm(workspace, { force: true, recursive: true });
}

try {
  await cp(projectRoot, workspace, { filter: shouldCopy, recursive: true });
  await symlink(path.join(projectRoot, "node_modules"), path.join(workspace, "node_modules"), "dir");
} catch (error) {
  await cleanup();
  throw error;
}

const childEnvironment = { ...process.env };
for (const name of [
  "E2E_GAS_WEB_APP_URL",
  "GOOGLE_PRIVATE_KEY",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SHEET_ID",
  "LEAD_SINK_MODE",
  "NEXT_DIST_DIR",
  "NEXT_PUBLIC_GAS_FAKE_MODE",
  "NEXT_PUBLIC_GAS_WEB_APP_URL",
  "SLACK_NOTIFICATIONS_ENABLED",
  "SLACK_WEBHOOK_URL",
]) {
  delete childEnvironment[name];
}
childEnvironment.NEXT_PUBLIC_GAS_WEB_APP_URL = fakeGasEndpoint;
childEnvironment.NEXT_PUBLIC_PRIVACY_POLICY_URL = "https://privacy.example/policy";

let activeChild;
let stopping = false;
let cleaned = false;

async function cleanupOnce() {
  if (cleaned) return;
  cleaned = true;
  await cleanup();
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workspace,
      env: childEnvironment,
      stdio: "inherit",
    });
    activeChild = child;
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      activeChild = undefined;
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code ?? signal ?? "unknown status"}.`));
    });
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    activeChild?.kill(signal);
  });
}

try {
  await run("npm", ["run", "build"]);
  await verifyStaticExport(path.join(workspace, "out"));

  if (stopping) {
    await cleanupOnce();
    process.exitCode = 0;
  } else {
    const server = spawn(process.execPath, [
      path.join(workspace, "scripts", "serve-static-export.mjs"),
      "--directory",
      path.join(workspace, "out"),
      "--hostname",
      hostname,
      "--port",
      port,
    ], {
      cwd: workspace,
      env: childEnvironment,
      stdio: "inherit",
    });
    activeChild = server;
    server.once("error", async (error) => {
      await cleanupOnce();
      process.stderr.write(`${error instanceof Error ? error.message : "Static server failed."}\n`);
      process.exitCode = 1;
    });
    server.once("exit", async (code, signal) => {
      activeChild = undefined;
      await cleanupOnce();
      process.exitCode = code ?? (signal ? 0 : 1);
    });
  }
} catch (error) {
  await cleanupOnce();
  throw error;
}
