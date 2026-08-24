export type DisabledPublicFormConfiguration = Readonly<{ enabled: false }>;

export type EnabledPublicFormConfiguration = Readonly<{
  enabled: true;
  gasWebAppUrl: string;
  privacyPolicyUrl: string;
}>;

export type PublicFormConfiguration =
  | DisabledPublicFormConfiguration
  | EnabledPublicFormConfiguration;

export type PublicFormConfigurationValues = Readonly<{
  gasWebAppUrl?: string;
  privacyPolicyUrl?: string;
}>;

export type PublicFormConfigurationOptions = Readonly<{
  allowLoopback?: boolean;
}>;

export class PublicFormConfigurationError extends Error {}

export function isLiteralLoopbackSiteOrigin(value: string | undefined): boolean;

export function parseGasWebAppUrl(
  value: string,
  options?: PublicFormConfigurationOptions,
): string;

export function parsePrivacyPolicyUrl(value: string): string;

export function resolvePublicFormConfiguration(
  values: PublicFormConfigurationValues,
  options?: PublicFormConfigurationOptions,
): PublicFormConfiguration;

export function resolvePublicFormConfigurationFailClosed(
  values: PublicFormConfigurationValues,
  options?: PublicFormConfigurationOptions,
): PublicFormConfiguration;
