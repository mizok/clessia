const STATIC_ALLOWED_ORIGINS = ['https://clessia.pages.dev'] as const;
const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1']);
const LOCAL_DEV_PROTOCOLS = new Set(['http:', 'https:']);

function normalizeOrigin(origin: string): string | null {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

export function isAllowedOrigin(origin: string | null | undefined): boolean {
  if (!origin) {
    return false;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return false;
  }

  if (STATIC_ALLOWED_ORIGINS.includes(normalizedOrigin)) {
    return true;
  }

  const parsedOrigin = new URL(normalizedOrigin);
  return LOCAL_DEV_PROTOCOLS.has(parsedOrigin.protocol) && LOCAL_DEV_HOSTS.has(parsedOrigin.hostname);
}

export function resolveCorsOrigin(origin: string | undefined): string | undefined {
  if (!isAllowedOrigin(origin)) {
    return undefined;
  }

  return normalizeOrigin(origin ?? '') ?? undefined;
}

interface ResolveTrustedOriginsOptions {
  readonly requestOrigin?: string | null;
  readonly webUrl?: string | null;
}

export function resolveTrustedOrigins(options: ResolveTrustedOriginsOptions = {}): string[] {
  const origins = new Set<string>(STATIC_ALLOWED_ORIGINS);
  const normalizedWebUrl = options.webUrl ? normalizeOrigin(options.webUrl) : null;
  const normalizedRequestOrigin = options.requestOrigin ? normalizeOrigin(options.requestOrigin) : null;

  if (normalizedWebUrl && isAllowedOrigin(normalizedWebUrl)) {
    origins.add(normalizedWebUrl);
  }

  if (normalizedRequestOrigin && isAllowedOrigin(normalizedRequestOrigin)) {
    origins.add(normalizedRequestOrigin);
  }

  return [...origins];
}
