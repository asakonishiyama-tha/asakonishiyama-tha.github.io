export type ReleaseSafetyFinding = {
  /**
   * Unique, printable POSIX-relative reporting path. Unsafe raw paths are
   * represented as @unsafe-path-sha256/<digest>; matched values are never returned.
   */
  file: string;
  /** Stable release-safety rule identifier; never the matched value. */
  rule: string;
};

/**
 * Scans a canonical absolute directory without following symlinks.
 *
 * Text reads are capped at 5 MiB. The only skipped binary bodies are the two
 * approved PDFs at their exact source/output paths, and their complete bytes
 * must match the committed SHA-256 policy. Findings are unique and sorted and
 * never include matched values.
 */
export function scanReleaseSafety(root: string): Promise<ReleaseSafetyFinding[]>;
