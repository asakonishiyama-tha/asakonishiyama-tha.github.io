export interface PruneStaticErrorDocumentsReport {
  removed: string[];
}

export function pruneStaticErrorDocuments(
  outDirectory: string,
): Promise<PruneStaticErrorDocumentsReport>;
