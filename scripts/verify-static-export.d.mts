export interface StaticExportReport {
  routes: string[];
  forbiddenArtifacts: string[];
  pdfs: string[];
  frameworkErrorDocuments: string[];
  frameworkRouteArtifacts: string[];
}

export function verifyStaticExport(outDirectory: string): Promise<StaticExportReport>;
