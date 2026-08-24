export type HostedPrivacyStatus = "verified" | "skipped";

export interface HostedVerificationResult {
  canonicalRoutes: number;
  forbiddenRoutes: number;
  pdfs: number;
  privacy: HostedPrivacyStatus;
  requests: number;
}

export interface HostedVerificationOptions {
  allowLoopbackHttp?: boolean;
  attempts?: number;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  gasWebAppUrl?: string;
  logger?: (message: string) => void;
  privacyPolicyUrl?: string;
  retryDelayMs?: number;
  timeoutMs?: number;
}

export class HostedVerificationError extends Error {
  readonly code: string;
  constructor(code: string);
}

export function verifyHostedDeployment(
  options: HostedVerificationOptions,
): Promise<HostedVerificationResult>;
