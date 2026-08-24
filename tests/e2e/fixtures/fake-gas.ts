import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { APIRequestContext } from "@playwright/test";

export const defaultFakeGasEndpoint = "http://127.0.0.1:3201/exec";
export const fakeGasControlPath = "/_fake-gas-control/v1";
export const fakeGasControlToken = "tha-task-3-loopback-control";

export type FakeGasMode = "saved" | "pending_saved" | "not_found" | "timeout";

export type FakeGasPost = {
  contentType: string;
  fields: string[];
  payload: unknown;
  submissionId: string;
};

export type FakeGasStatusRequest = {
  callback: string;
  fields: string[];
  pathname: string;
  submissionId: string;
};

export type FakeGasSnapshot = {
  mode: FakeGasMode;
  posts: FakeGasPost[];
  statusRequests: FakeGasStatusRequest[];
};

const allowedHostnames = new Map([
  ["127.0.0.1", "127.0.0.1"],
  ["localhost", "localhost"],
  ["::1", "::1"],
  ["[::1]", "::1"],
]);
const allowedModes = new Set<FakeGasMode>(["saved", "pending_saved", "not_found", "timeout"]);
const safeCallback = /^[A-Za-z_$][0-9A-Za-z_$]*(?:\.[A-Za-z_$][0-9A-Za-z_$]*)*$/;
const maximumBodyBytes = 128 * 1024;

function configuredEndpoint() {
  return process.env.PLAYWRIGHT_FAKE_GAS_URL ?? defaultFakeGasEndpoint;
}

function controlOrigin() {
  return new URL(configuredEndpoint()).origin;
}

function controlHeaders() {
  return { "x-tha-fake-gas-token": fakeGasControlToken };
}

async function requireSuccessful(response: Awaited<ReturnType<APIRequestContext["get"]>>) {
  if (!response.ok()) {
    throw new Error(`Fake GAS control request failed with ${response.status()}.`);
  }
  return response;
}

export async function resetFakeGas(request: APIRequestContext, mode: FakeGasMode = "saved") {
  const response = await request.post(`${controlOrigin()}${fakeGasControlPath}/reset`, {
    data: { mode },
    headers: controlHeaders(),
  });
  await requireSuccessful(response);
}

export async function setFakeGasMode(request: APIRequestContext, mode: FakeGasMode) {
  const response = await request.post(`${controlOrigin()}${fakeGasControlPath}/mode`, {
    data: { mode },
    headers: controlHeaders(),
  });
  await requireSuccessful(response);
}

export async function readFakeGas(request: APIRequestContext): Promise<FakeGasSnapshot> {
  const response = await request.get(`${controlOrigin()}${fakeGasControlPath}/requests`, {
    headers: controlHeaders(),
  });
  await requireSuccessful(response);
  return response.json() as Promise<FakeGasSnapshot>;
}

function parseArguments(argv: string[]) {
  const argumentsByName = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    const value = argv[index + 1];
    if (name && value) argumentsByName.set(name, value);
  }
  const requestedHostname = argumentsByName.get("--hostname");
  const hostname = requestedHostname ? allowedHostnames.get(requestedHostname) : undefined;
  const portText = argumentsByName.get("--port");
  const port = /^\d{1,5}$/.test(portText ?? "") ? Number(portText) : Number.NaN;
  if (!hostname) throw new Error("Fake GAS requires an explicitly allowed loopback hostname.");
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Fake GAS requires a numeric port from 1 through 65535.");
  }
  return { hostname, port };
}

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > maximumBodyBytes) throw new Error("Request body is too large.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sendJson(response: ServerResponse, status: number, value: unknown) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function sendText(response: ServerResponse, status: number, body: string) {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

function isAuthorizedControl(request: IncomingMessage) {
  return request.headers["x-tha-fake-gas-token"] === fakeGasControlToken;
}

async function readControlMode(request: IncomingMessage): Promise<FakeGasMode> {
  const value = JSON.parse(await readBody(request)) as { mode?: unknown };
  if (typeof value.mode !== "string" || !allowedModes.has(value.mode as FakeGasMode)) {
    throw new Error("Invalid fake GAS mode.");
  }
  return value.mode as FakeGasMode;
}

async function startFakeGas(argv: string[]) {
  const { hostname, port } = parseArguments(argv);
  let mode: FakeGasMode = "saved";
  const posts: FakeGasPost[] = [];
  const statusRequests: FakeGasStatusRequest[] = [];
  const statusCounts = new Map<string, number>();
  const hangingResponses = new Set<ServerResponse>();

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://loopback.invalid");

      if (requestUrl.pathname === `${fakeGasControlPath}/health` && request.method === "GET") {
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      }

      if (requestUrl.pathname.startsWith(fakeGasControlPath)) {
        if (!isAuthorizedControl(request)) {
          sendText(response, 404, "Not Found\n");
          return;
        }
        if (requestUrl.pathname === `${fakeGasControlPath}/requests` && request.method === "GET") {
          sendJson(response, 200, { mode, posts, statusRequests } satisfies FakeGasSnapshot);
          return;
        }
        if (requestUrl.pathname === `${fakeGasControlPath}/reset` && request.method === "POST") {
          mode = await readControlMode(request);
          posts.length = 0;
          statusRequests.length = 0;
          statusCounts.clear();
          for (const hanging of hangingResponses) hanging.destroy();
          hangingResponses.clear();
          sendJson(response, 200, { ok: true });
          return;
        }
        if (requestUrl.pathname === `${fakeGasControlPath}/mode` && request.method === "POST") {
          mode = await readControlMode(request);
          sendJson(response, 200, { ok: true });
          return;
        }
        sendText(response, 404, "Not Found\n");
        return;
      }

      if (requestUrl.pathname !== "/exec") {
        sendText(response, 404, "Not Found\n");
        return;
      }

      if (request.method === "POST") {
        const body = new URLSearchParams(await readBody(request));
        const submissionId = body.get("submissionId") ?? "";
        let payload: unknown = null;
        try {
          payload = JSON.parse(body.get("payload") ?? "null");
        } catch {
          payload = null;
        }
        posts.push({
          contentType: request.headers["content-type"] ?? "",
          fields: [...body.keys()],
          payload,
          submissionId,
        });
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      }

      if (request.method === "GET") {
        const submissionId = requestUrl.searchParams.get("submissionId") ?? "";
        const callback = requestUrl.searchParams.get("callback") ?? "";
        statusRequests.push({
          callback,
          fields: [...requestUrl.searchParams.keys()],
          pathname: requestUrl.pathname,
          submissionId,
        });
        if (!safeCallback.test(callback)) {
          sendText(response, 400, "Bad Request\n");
          return;
        }
        if (mode === "timeout") {
          hangingResponses.add(response);
          response.once("close", () => hangingResponses.delete(response));
          return;
        }

        const matchingPost = posts.some((post) => post.submissionId === submissionId);
        const count = (statusCounts.get(submissionId) ?? 0) + 1;
        statusCounts.set(submissionId, count);
        const status = !matchingPost || mode === "not_found"
          ? "not_found"
          : mode === "pending_saved" && count === 1
            ? "pending"
            : "saved";
        const body = `${callback}(${JSON.stringify({ submissionId, status })});`;
        response.writeHead(200, {
          "content-type": "text/javascript; charset=utf-8",
          "content-length": Buffer.byteLength(body),
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        });
        response.end(body);
        return;
      }

      response.setHeader("allow", "GET, POST");
      sendText(response, 405, "Method Not Allowed\n");
    } catch {
      sendText(response, 400, "Bad Request\n");
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, resolve);
  });
  process.stdout.write(`Fake GAS listening at ${new URL(configuredEndpoint()).origin}\n`);

  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      for (const hanging of hangingResponses) hanging.destroy();
      hangingResponses.clear();
      server.close(() => { process.exitCode = 0; });
    });
  }
}

const entrypoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : undefined;
if (entrypoint === import.meta.url) {
  await startFakeGas(process.argv.slice(2));
}
