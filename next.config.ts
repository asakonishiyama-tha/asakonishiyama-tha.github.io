import type { NextConfig } from "next";

import {
  isLiteralLoopbackSiteOrigin,
  resolvePublicFormConfiguration,
} from "./lib/forms/public-form-config.js";

function assertConfiguredSiteOrigin(value: string | undefined): void {
  if (!value) return;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an HTTP(S) origin without a path, query, or fragment.");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
    || parsed.username
    || parsed.password
  ) {
    throw new Error("NEXT_PUBLIC_SITE_URL must be an HTTP(S) origin without a path, query, or fragment.");
  }
}

assertConfiguredSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL);
resolvePublicFormConfiguration({
  gasWebAppUrl: process.env.NEXT_PUBLIC_GAS_WEB_APP_URL,
  privacyPolicyUrl: process.env.NEXT_PUBLIC_PRIVACY_POLICY_URL,
}, {
  allowLoopback: isLiteralLoopbackSiteOrigin(process.env.NEXT_PUBLIC_SITE_URL),
});

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
