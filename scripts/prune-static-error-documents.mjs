import { lstat, realpath, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const errorDocuments = ["404.html", "404/index.html"];

async function requireRegularFile(absolutePath, relativePath) {
  let status;
  try {
    status = await lstat(absolutePath);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (status.isSymbolicLink() || !status.isFile()) {
    throw new Error(`Static error document must be a regular file: ${relativePath}`);
  }
  return true;
}

export async function pruneStaticErrorDocuments(outDirectory) {
  const rootDirectory = path.resolve(outDirectory);
  const rootStatus = await lstat(rootDirectory);
  if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory()) {
    throw new Error("Static export root must be a real directory.");
  }
  const canonicalRoot = await realpath(rootDirectory);

  const removed = [];
  for (const relativePath of errorDocuments) {
    const absolutePath = path.join(canonicalRoot, relativePath);
    if (!await requireRegularFile(absolutePath, relativePath)) continue;
    await unlink(absolutePath);
    removed.push(relativePath);
  }

  try {
    await rmdir(path.join(canonicalRoot, "404"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  return { removed };
}

async function runCli() {
  const outDirectory = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve("out");
  try {
    const report = await pruneStaticErrorDocuments(outDirectory);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "Static error document pruning failed."}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await runCli();
}
