/**
 * 允許的來源。**全部從環境變數讀，不寫死** —— 每個客戶是自己的部署、自己的網域
 * （憲法 c12），寫死等於只有一個客戶能用。
 *
 * 三個來源合併：
 * 1. `WEB_URL` —— 這個部署的前端，由部署者設定，**依定義就是可信的**
 * 2. `ALLOWED_ORIGINS` —— 逗號分隔的額外來源（自訂網域、第二個前端）
 * 3. localhost / 127.0.0.1 —— 本機開發，任意 port
 *
 * ⚠️ **一律把 env 傳進來。** Cloudflare Workers 的環境變數在 request-scoped 的 `c.env`
 * 上，不在 `process.env`（我們的 compatibility_date 早於 Cloudflare 開始填 process.env
 * 的版本）。曾經有一個模組層級的 `staticAllowedOrigins()` 常數在載入時就算好、
 * 沒帶 env，結果正式站的允許清單永遠是空的，只有 localhost 過得了 —— 本機測全綠、
 * 一上線就整個前端被 CORS 擋。`process.env` 的退路只服務 Node 自架（`server.ts`）。
 */
export function allowedOrigins(env?: {
  WEB_URL?: string;
  ALLOWED_ORIGINS?: string;
}): readonly string[] {
  const webUrl = env?.WEB_URL ?? globalThis.process?.env?.['WEB_URL'] ?? '';
  const extra = env?.ALLOWED_ORIGINS ?? globalThis.process?.env?.['ALLOWED_ORIGINS'] ?? '';

  return [webUrl, ...extra.split(',')]
    .map((s) => normalizeOrigin(s.trim()))
    .filter((s): s is string => Boolean(s));
}

const LOCAL_DEV_HOSTS = new Set(['localhost', '127.0.0.1']);
const LOCAL_DEV_PROTOCOLS = new Set(['http:', 'https:']);

function normalizeOrigin(origin: string): string | null {
  try {
    return new URL(origin).origin;
  } catch {
    return null;
  }
}

export function isAllowedOrigin(
  origin: string | null | undefined,
  allowed: readonly string[] = [],
): boolean {
  if (!origin) {
    return false;
  }

  const normalizedOrigin = normalizeOrigin(origin);
  if (!normalizedOrigin) {
    return false;
  }

  if (allowed.includes(normalizedOrigin)) {
    return true;
  }

  const parsedOrigin = new URL(normalizedOrigin);
  return (
    LOCAL_DEV_PROTOCOLS.has(parsedOrigin.protocol) && LOCAL_DEV_HOSTS.has(parsedOrigin.hostname)
  );
}

export function resolveCorsOrigin(
  origin: string | undefined,
  allowed: readonly string[] = [],
): string | undefined {
  if (!isAllowedOrigin(origin, allowed)) {
    return undefined;
  }

  return normalizeOrigin(origin ?? '') ?? undefined;
}

interface ResolveTrustedOriginsOptions {
  readonly requestOrigin?: string | null;
  readonly allowed?: readonly string[];
}

export function resolveTrustedOrigins(options: ResolveTrustedOriginsOptions = {}): string[] {
  const allowed = options.allowed ?? [];
  const origins = new Set<string>(allowed);

  const normalizedRequestOrigin = options.requestOrigin
    ? normalizeOrigin(options.requestOrigin)
    : null;

  if (normalizedRequestOrigin && isAllowedOrigin(normalizedRequestOrigin, allowed)) {
    origins.add(normalizedRequestOrigin);
  }

  return [...origins];
}
