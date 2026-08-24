import { createServer } from "node:http";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

const loopbackHostnames = new Map([
  ["127.0.0.1", "127.0.0.1"],
  ["localhost", "localhost"],
  ["::1", "::1"],
  ["[::1]", "::1"],
]);

const frameworkNotFoundPaths = new Set(["/404", "/404/", "/404.html", "/404/index.html"]);
const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

function parseArguments(argv) {
  const argumentsByName = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    argumentsByName.set(argv[index], argv[index + 1]);
  }

  const directory = argumentsByName.get("--directory");
  const requestedHostname = argumentsByName.get("--hostname");
  const portText = argumentsByName.get("--port");
  const hostname = loopbackHostnames.get(requestedHostname);
  const port = /^\d{1,5}$/.test(portText ?? "") ? Number(portText) : Number.NaN;

  if (!directory) throw new Error("Static server requires an export directory.");
  if (!hostname) throw new Error("Static server requires an explicitly allowed loopback hostname.");
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("Static server requires a numeric port from 0 through 65535.");
  }
  return { directory: path.resolve(directory), hostname, port };
}

function decodeRequestPath(requestUrl) {
  if (!requestUrl?.startsWith("/")) return null;
  const rawPathname = requestUrl.split(/[?#]/, 1)[0];
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPathname);
  } catch {
    return null;
  }
  if (decodedPath.includes("\0") || decodedPath.includes("\\")) return null;
  const segments = decodedPath.split("/");
  if (segments.includes(".") || segments.includes("..")) return null;
  return decodedPath;
}

function isContained(rootDirectory, candidate) {
  return candidate === rootDirectory || candidate.startsWith(`${rootDirectory}${path.sep}`);
}

async function findStaticFile(rootDirectory, decodedPath) {
  const relativeSegments = decodedPath.split("/").filter(Boolean);
  let candidate = rootDirectory;
  for (const segment of relativeSegments) {
    candidate = path.join(candidate, segment);
    if (!isContained(rootDirectory, candidate)) return null;
    let status;
    try {
      status = await lstat(candidate);
    } catch {
      return null;
    }
    if (status.isSymbolicLink()) return null;
  }

  let status;
  try {
    status = await lstat(candidate);
  } catch {
    return null;
  }
  if (status.isSymbolicLink()) return null;
  if (status.isDirectory()) {
    candidate = path.join(candidate, "index.html");
    try {
      status = await lstat(candidate);
    } catch {
      return null;
    }
    if (status.isSymbolicLink()) return null;
  }
  if (!status.isFile()) return null;

  const resolvedFile = await realpath(candidate);
  if (!isContained(rootDirectory, resolvedFile)) return null;
  return candidate;
}

function sendText(response, status, message) {
  response.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(message),
    "x-content-type-options": "nosniff",
  });
  response.end(message);
}

async function main() {
  const { directory, hostname, port } = parseArguments(process.argv.slice(2));
  const rootStatus = await lstat(directory);
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    throw new Error("Static server export directory must be a real directory.");
  }
  const rootDirectory = await realpath(directory);

  const server = createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("allow", "GET, HEAD");
        sendText(response, 405, "Method Not Allowed\n");
        return;
      }
      const decodedPath = decodeRequestPath(request.url);
      if (decodedPath === null) {
        sendText(response, 400, "Bad Request\n");
        return;
      }
      const file = await findStaticFile(rootDirectory, decodedPath);
      if (!file) {
        sendText(response, 404, "Not Found\n");
        return;
      }

      const contents = await readFile(file);
      const contentType = contentTypes.get(path.extname(file).toLowerCase()) ?? "application/octet-stream";
      response.writeHead(frameworkNotFoundPaths.has(decodedPath) ? 404 : 200, {
        "content-type": contentType,
        "content-length": contents.byteLength,
        "x-content-type-options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : contents);
    } catch {
      sendText(response, 500, "Internal Server Error\n");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, hostname, resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Static server did not expose a TCP address.");
  const displayHostname = address.family === "IPv6" ? `[${address.address}]` : address.address;
  process.stdout.write(`Static export server listening at http://${displayHostname}:${address.port}\n`);

  let stopping = false;
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      server.close(() => { process.exitCode = 0; });
    });
  }
}

await main();
