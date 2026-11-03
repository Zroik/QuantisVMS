/**
 * Fail-closed configuration checks. The repository previously shipped public
 * default secrets; this refuses to start with any of them.
 */

const KNOWN_DEFAULTS: Record<string, string[]> = {
  JWT_SECRET: [
    "super_secret_jwt_key_quantis_1234567890",
    "super-secret-jwt-key-replace-in-production-min-32-chars",
  ],
  MEDIAMTX_AUTH_SECRET: ["mediamtx_internal_token_secret"],
  MYSQL_PASSWORD: ["vms_password_secret"],
  MYSQL_ROOT_PASSWORD: ["vms_root_secret"],
  REDIS_PASSWORD: ["redis_password_secret"],
};

export interface SecretRequirements {
  jwt?: boolean;
  credential?: boolean;
  mediaMtx?: boolean;
  mysql?: boolean;
  redis?: boolean;
}

function isAllZeroBase64(value: string): boolean {
  try {
    const buf = Buffer.from(value, "base64");
    return buf.length > 0 && buf.every((b) => b === 0);
  } catch {
    return false;
  }
}

export function assertSecureConfig(
  env: NodeJS.ProcessEnv = process.env,
  requirements: SecretRequirements = {}
): void {
  if (env.NODE_ENV !== "production") return;

  const missing: string[] = [];
  const weak: string[] = [];

  if (requirements.jwt) {
    if (!env.JWT_SECRET) missing.push("JWT_SECRET");
    else if ((KNOWN_DEFAULTS.JWT_SECRET || []).includes(env.JWT_SECRET)) weak.push("JWT_SECRET");
  }

  if (requirements.credential) {
    if (!env.CREDENTIAL_KEY) missing.push("CREDENTIAL_KEY");
    else if (isAllZeroBase64(env.CREDENTIAL_KEY)) weak.push("CREDENTIAL_KEY");
  }

  if (requirements.mediaMtx) {
    if (!env.MEDIAMTX_AUTH_SECRET) missing.push("MEDIAMTX_AUTH_SECRET");
    else if ((KNOWN_DEFAULTS.MEDIAMTX_AUTH_SECRET || []).includes(env.MEDIAMTX_AUTH_SECRET)) {
      weak.push("MEDIAMTX_AUTH_SECRET");
    }
  }

  if (requirements.mysql) {
    if (!env.MYSQL_PASSWORD) missing.push("MYSQL_PASSWORD");
    else if ((KNOWN_DEFAULTS.MYSQL_PASSWORD || []).includes(env.MYSQL_PASSWORD)) weak.push("MYSQL_PASSWORD");
  }

  if (requirements.redis) {
    if (!env.REDIS_PASSWORD) missing.push("REDIS_PASSWORD");
    else if ((KNOWN_DEFAULTS.REDIS_PASSWORD || []).includes(env.REDIS_PASSWORD)) weak.push("REDIS_PASSWORD");
  }

  if (missing.length > 0 || weak.length > 0) {
    const parts: string[] = [];
    if (missing.length > 0) parts.push(`missing: ${missing.join(", ")}`);
    if (weak.length > 0) parts.push(`known-public defaults: ${weak.join(", ")}`);
    throw new Error(`Refusing to start with insecure configuration (${parts.join("; ")}).`);
  }
}
