const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".tif",
  ".tiff",
  ".webp",
]);
const VIDEO_EXTENSIONS = new Set([".m4v", ".mov", ".mp4", ".ogv", ".webm"]);

function extensionOf(relativePath) {
  const basename = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  const extensionIndex = basename.lastIndexOf(".");
  return extensionIndex > 0 ? basename.slice(extensionIndex).toLowerCase() : "";
}

export function classifyPublicAsset(relativePath) {
  const extension = extensionOf(relativePath);
  if (relativePath.startsWith("downloads/") && extension === ".pdf") return "pdf";
  if (!relativePath.startsWith("media/")) return null;
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return null;
}
