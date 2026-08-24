const EXACT_PRODUCTION_GAS_URL = /^https:\/\/script\.google\.com\/macros\/s\/([A-Za-z0-9_-]{1,256})\/exec$/;
const EXPLICIT_LOOPBACK_HTTP = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?(?:\/[^\s?#]*)?$/;
const EXPLICIT_LOOPBACK_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/;
const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);
const MAX_PUBLIC_URL_LENGTH = 2_048;

export class PublicFormConfigurationError extends Error {
  constructor() {
    super("Public form configuration is invalid.");
    this.name = "PublicFormConfigurationError";
  }
}

function invalidConfiguration() {
  throw new PublicFormConfigurationError();
}

function isBlank(value) {
  return value === undefined || value === "";
}

function parseUrl(value) {
  if (typeof value !== "string"
      || value.length === 0
      || value.length > MAX_PUBLIC_URL_LENGTH
      || /[\u0000-\u0020\u007f]/.test(value)) {
    return invalidConfiguration();
  }
  try {
    return new URL(value);
  } catch {
    return invalidConfiguration();
  }
}

export function isLiteralLoopbackSiteOrigin(value) {
  if (typeof value !== "string" || !EXPLICIT_LOOPBACK_ORIGIN.test(value)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:"
      && LOOPBACK_HOSTNAMES.has(parsed.hostname)
      && parsed.pathname === "/"
      && parsed.search === ""
      && parsed.hash === ""
      && parsed.username === ""
      && parsed.password === "";
  } catch {
    return false;
  }
}

export function parseGasWebAppUrl(value, { allowLoopback = false } = {}) {
  if (typeof value !== "string") return invalidConfiguration();
  const productionMatch = EXACT_PRODUCTION_GAS_URL.exec(value);
  if (productionMatch !== null) {
    const parsed = parseUrl(value);
    if (parsed.origin !== "https://script.google.com"
        || parsed.pathname !== `/macros/s/${productionMatch[1]}/exec`
        || parsed.port !== ""
        || parsed.search !== ""
        || parsed.hash !== ""
        || parsed.username !== ""
        || parsed.password !== "") {
      return invalidConfiguration();
    }
    return parsed.toString();
  }

  if (!allowLoopback || !EXPLICIT_LOOPBACK_HTTP.test(value)) return invalidConfiguration();
  const parsed = parseUrl(value);
  if (parsed.protocol !== "http:"
      || !LOOPBACK_HOSTNAMES.has(parsed.hostname)
      || parsed.search !== ""
      || parsed.hash !== ""
      || parsed.username !== ""
      || parsed.password !== "") {
    return invalidConfiguration();
  }
  return parsed.toString();
}

export function parsePrivacyPolicyUrl(value) {
  const parsed = parseUrl(value);
  if (parsed.protocol !== "https:"
      || parsed.username !== ""
      || parsed.password !== "") {
    return invalidConfiguration();
  }
  return parsed.toString();
}

export function resolvePublicFormConfiguration(
  { gasWebAppUrl, privacyPolicyUrl },
  { allowLoopback = false } = {},
) {
  const gasBlank = isBlank(gasWebAppUrl);
  const privacyBlank = isBlank(privacyPolicyUrl);
  if (gasBlank && privacyBlank) {
    return Object.freeze({ enabled: false });
  }
  if (gasBlank || privacyBlank) return invalidConfiguration();

  return Object.freeze({
    enabled: true,
    gasWebAppUrl: parseGasWebAppUrl(gasWebAppUrl, { allowLoopback }),
    privacyPolicyUrl: parsePrivacyPolicyUrl(privacyPolicyUrl),
  });
}

export function resolvePublicFormConfigurationFailClosed(values, options) {
  try {
    return resolvePublicFormConfiguration(values, options);
  } catch (error) {
    if (error instanceof PublicFormConfigurationError) {
      return Object.freeze({ enabled: false });
    }
    throw error;
  }
}
