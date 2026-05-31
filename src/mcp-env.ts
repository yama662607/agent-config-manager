export type EnvMap = Record<string, string>;

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function validateEnvMap(env?: EnvMap): void {
  if (!env) return;

  for (const [key, value] of Object.entries(env)) {
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid environment variable name: ${key}`);
    }

    if (value.length > 5000) {
      throw new Error(`Environment variable value too long for: ${key}`);
    }
  }
}

export function normalizeEnvMap(env?: EnvMap): EnvMap | undefined {
  if (!env) return undefined;

  const entries = Object.entries(env)
    .filter(([key]) => key.trim().length > 0)
    .map(([key, value]) => [key, String(value)] as const);

  if (entries.length === 0) {
    return undefined;
  }

  const normalized = Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
  validateEnvMap(normalized);
  return normalized;
}

export function mergeEnvMaps(base: EnvMap | undefined, next: EnvMap): EnvMap {
  return {
    ...(base ?? {}),
    ...next,
  };
}

export function parseEnvOptionValue(value: string): EnvMap {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const normalized: EnvMap = {};
    for (const [key, rawValue] of Object.entries(parsed)) {
      if (typeof rawValue !== 'string') {
        throw new Error(`Environment variable values must be strings: ${key}`);
      }
      normalized[key] = rawValue;
    }
    validateEnvMap(normalized);
    return normalized;
  }

  const separatorIndex = trimmed.indexOf('=');
  if (separatorIndex <= 0) {
    throw new Error(`Invalid environment variable assignment: ${value}`);
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  const envValue = trimmed.slice(separatorIndex + 1);
  const normalized = { [key]: envValue };
  validateEnvMap(normalized);
  return normalized;
}

export function parseEnvEntriesText(value: string): EnvMap {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  if (trimmed.startsWith('{')) {
    return parseEnvOptionValue(trimmed);
  }

  const entries = trimmed
    .split(/\r?\n|,(?=\s*[A-Za-z_][A-Za-z0-9_]*=)/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  let env: EnvMap = {};
  for (const entry of entries) {
    env = mergeEnvMaps(env, parseEnvOptionValue(entry));
  }

  return env;
}

export function formatEnvMap(env?: EnvMap): string {
  if (!env || Object.keys(env).length === 0) {
    return '(none)';
  }

  return Object.entries(env)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join(', ');
}
