export type PreparePublicAssetsTestHooks = {
  /** @internal Runs after lstat/realpath and immediately before verified open. */
  afterFileValidation?: (event: {
    kind: "asset" | "document";
    filePath: string;
  }) => Promise<void>;
  /** @internal Runs immediately before output identity is revalidated for publication. */
  beforePublish?: (event: {
    name: "downloads" | "media";
    publicDirectory: string;
  }) => Promise<void>;
  /** @internal Runs immediately before private-workspace cleanup identity validation. */
  beforeCleanup?: (event: {
    workspaceDirectory: string;
  }) => Promise<void>;
  /** @internal Deterministic seams around each publication rename. */
  publishBoundary?: (event: {
    name: "downloads" | "media";
    boundary: "before-quarantine" | "after-quarantine" | "before-stage" | "after-stage";
  }) => Promise<void>;
  /** @internal Deterministic seams around each rollback rename. */
  rollbackBoundary?: (event: {
    name: "downloads" | "media";
    boundary: "before-remove-published" | "before-restore-original";
  }) => Promise<void>;
};

export type PreparePublicAssetsOptions = {
  talksDirectory?: string;
  /**
   * Must be a POSIX directory owned by the current uid and deny group/other
   * writes. Every ancestor is identity-checked; writable ancestors require
   * sticky-bit protection and trusted ownership of the child entry.
   */
  publicDirectory?: string;
  /**
   * The caller guarantees no hostile process running under the build uid
   * mutates these paths during preparation. Other values are rejected.
   */
  threatModel?: "trusted-same-uid-build";
  /** @internal Deterministic filesystem-race seams used by regression tests. */
  testHooks?: PreparePublicAssetsTestHooks;
};

export type PreparedPublicAssets = {
  copied: string[];
};

/**
 * Securely stages and publishes generated assets on POSIX filesystems that
 * provide O_NOFOLLOW and O_DIRECTORY. The protected ancestor-chain
 * preconditions in PreparePublicAssetsOptions are revalidated at mutation
 * boundaries. Hostile same-uid processes are explicitly out of scope.
 */
export function preparePublicAssets(
  options?: PreparePublicAssetsOptions,
): Promise<PreparedPublicAssets>;

export class AssetRecoveryError extends Error {
  recoveryPath: string;
  recoveryErrors: unknown[];
}
