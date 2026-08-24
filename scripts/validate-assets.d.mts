export type AssetValidationDependencies = {
  /** @internal Deterministic filesystem-race seam used by regression tests. */
  beforeTraversal?: () => Promise<void>;
  readImageMetadata?: (assetPath: string) => Promise<{ width?: number }>;
  probeVideoDuration?: (assetPath: string) => Promise<number>;
  /** Hostile processes running under the validation uid are out of scope. */
  threatModel?: "trusted-same-uid-build";
};

/**
 * Validates generated assets beneath an identity-checked protected ancestor
 * chain. Hostile same-uid filesystem mutation is explicitly out of scope.
 */
export function validateAssets(
  publicDirectory?: string,
  dependencies?: AssetValidationDependencies,
): Promise<string[]>;
