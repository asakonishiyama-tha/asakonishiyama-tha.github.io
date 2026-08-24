export type BuildPublicSourceTestHooks = {
  /** @internal Runs after mkdtemp and before staging initialization. */
  afterStagingCreated?: (event: { stagingRoot: string }) => Promise<void>;
  /** @internal Runs immediately before the atomic publication primitive. */
  beforePublish?: (event: { outputRoot: string; stagingRoot: string }) => Promise<void>;
};

export type BuildPublicSourceOptions = {
  /** Absolute canonical realpath to the private launch source tree. */
  sourceRoot: string;
  /** Absolute canonical realpath to an existing protected empty directory outside sourceRoot. */
  outputRoot: string;
  /** @internal Deterministic filesystem-boundary seams used by regression tests. */
  testHooks?: BuildPublicSourceTestHooks;
};

export type BuiltPublicSource = {
  /** Unique, sorted, POSIX-relative paths whose bytes were copied. */
  files: string[];
};

/**
 * Builds a deny-by-default public source candidate.
 *
 * The implementation rejects symlinks, hardlinks, special files, ambiguous
 * paths, containment violations, and destination collisions. It validates and
 * reads the complete candidate before staging, then replaces the verified
 * empty output directory with one same-parent rename primitive. A validation,
 * staging, or pre-publication failure leaves the original output directory
 * present and empty. Processes running under the same uid are trusted not to
 * mutate the verified trees concurrently.
 */
export function buildPublicSource(
  options: BuildPublicSourceOptions,
): Promise<BuiltPublicSource>;
