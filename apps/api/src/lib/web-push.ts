/**
 * Web Push 的加密（RFC 8291 aes128gcm）與 VAPID 簽章（RFC 8292），只用 WebCrypto（#1657）。
 *
 * 零依賴、Workers 與 Node ≥ 20 跑同一份（c12）。設計見 `kb/wiki/architecture/web-push.md` §2。
 * 正確性由 `web-push.spec.ts` 對 RFC 8291 第 5 節／附錄 A 的固定向量釘住 —— 錯一個 byte 就紅。
 *
 * 金鑰格式（`generate-vapid-keys.ts` 產生）：公鑰是未壓縮 P-256 點（65 bytes），私鑰是純量 d（32 bytes），
 * 都用 base64url。這是瀏覽器 `applicationServerKey` 與其他 Web Push 實作通用的格式。
 */

const enc = new TextEncoder();

export function toB64u(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64u(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

/** 未壓縮公鑰（65 bytes）＋可選的 d → JWK；WebCrypto 匯入私鑰只吃 JWK／PKCS8 */
function p256Jwk(publicKey: Uint8Array, d?: Uint8Array): JsonWebKey {
  if (publicKey.length !== 65 || publicKey[0] !== 4)
    throw new Error('P-256 公鑰要是 65 bytes 未壓縮格式');
  return {
    kty: 'EC',
    crv: 'P-256',
    x: toB64u(publicKey.subarray(1, 33)),
    y: toB64u(publicKey.subarray(33, 65)),
    ...(d ? { d: toB64u(d) } : {}),
  };
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number) {
  const key = await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: salt as BufferSource, info: info as BufferSource },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

/**
 * ECDH 的對方公鑰參數。標準（Node、瀏覽器、workerd 的執行期）都叫 `public`；
 * workers-types 因為保留字把型別寫成 `$public`，所以只在這裡斷言一次。
 */
function ecdhParams(publicKey: CryptoKey): SubtleCryptoDeriveKeyAlgorithm {
  return { name: 'ECDH', public: publicKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
}

const RECORD_SIZE = 4096;
/** 推播服務對 4096 bytes 以內不得回 413（RFC 8030 §7.2）：扣掉 86 bytes 標頭、16 bytes tag、1 byte 分隔 */
export const MAX_PAYLOAD_BYTES = 4096 - 86 - 16 - 1;

export interface PushKeys {
  /** 瀏覽器 `subscription.getKey('p256dh')`，base64url */
  readonly p256dh: string;
  /** 瀏覽器 `subscription.getKey('auth')`，base64url */
  readonly auth: string;
}

/**
 * RFC 8291：用訂閱的公鑰加密一則訊息，回傳整個 request body（標頭＋密文）。
 * `fixed` 只給測試用（RFC 向量要固定的發送端金鑰與 salt）；正式呼叫每則都用新的。
 */
export async function encryptPayload(
  payload: string | Uint8Array,
  keys: PushKeys,
  fixed?: {
    readonly salt: Uint8Array;
    readonly publicKey: Uint8Array;
    readonly privateKey: Uint8Array;
  },
): Promise<Uint8Array> {
  const plaintext = typeof payload === 'string' ? enc.encode(payload) : payload;
  if (plaintext.length > MAX_PAYLOAD_BYTES) {
    throw new RangeError(`推播內容 ${plaintext.length} bytes，超過 ${MAX_PAYLOAD_BYTES}`);
  }
  const uaPublic = fromB64u(keys.p256dh);
  const authSecret = fromB64u(keys.auth);

  let asPrivate: CryptoKey;
  let asPublic: Uint8Array;
  if (fixed) {
    asPublic = fixed.publicKey;
    asPrivate = await crypto.subtle.importKey(
      'jwk',
      p256Jwk(fixed.publicKey, fixed.privateKey),
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
  } else {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as CryptoKeyPair;
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array(
      (await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer,
    );
  }
  const salt = fixed?.salt ?? crypto.getRandomValues(new Uint8Array(16));

  const uaKey = await crypto.subtle.importKey(
    'jwk',
    p256Jwk(uaPublic),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(ecdhParams(uaKey), asPrivate, 256),
  );

  // §3.3：IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" 0x00 ua_public as_public)
  const keyInfo = concat(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  // RFC 8188 §2.2：CEK 與 NONCE
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  const aesKey = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, [
    'encrypt',
  ]);
  // 單一 record：內容後面接 0x02（最後一個 record 的分隔，RFC 8188 §2）
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      aesKey,
      concat(plaintext, Uint8Array.of(2)) as BufferSource,
    ),
  );

  // 標頭：salt(16) ‖ rs(uint32) ‖ idlen(1) ‖ keyid(as_public 65)
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, ciphertext);
}

export interface VapidKeys {
  /** 65 bytes 未壓縮公鑰，base64url —— 也是前端的 `applicationServerKey` */
  readonly publicKey: string;
  /** 32 bytes d，base64url（機密，`wrangler secret`） */
  readonly privateKey: string;
}

/**
 * RFC 8292：`Authorization: vapid t=<JWT>, k=<公鑰>`。同一個推播服務（origin）一次 run 簽一次就好。
 * 有效期預設 12 小時（RFC 8292 §2：不得超過 24 小時）。
 */
export async function vapidAuthorization(
  endpoint: string,
  vapid: VapidKeys,
  subject: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const header = toB64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = toB64u(
    enc.encode(
      JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSeconds + 12 * 3600, sub: subject }),
    ),
  );
  const key = await crypto.subtle.importKey(
    'jwk',
    p256Jwk(fromB64u(vapid.publicKey), fromB64u(vapid.privateKey)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  // WebCrypto 的 ECDSA 輸出就是 JWS 要的 r‖s（64 bytes），不用轉 DER
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    enc.encode(`${header}.${claims}`) as BufferSource,
  );
  return `vapid t=${header}.${claims}.${toB64u(new Uint8Array(signature))}, k=${vapid.publicKey}`;
}

/** 組一則推播的 request（RFC 8030）。送出（fetch）與回應處理留給呼叫端 */
export async function buildPushRequest(
  subscription: { readonly endpoint: string; readonly keys: PushKeys },
  payload: string,
  options: {
    /** `vapidAuthorization()` 的結果 */
    readonly authorization: string;
    /** 秒；必填，少了推播服務回 400（§5.2） */
    readonly ttl: number;
    /** 同 topic 的舊訊息會被新的蓋掉（§5.4，最多 32 個 base64url 字元） */
    readonly topic?: string;
    readonly urgency?: 'very-low' | 'low' | 'normal' | 'high';
  },
): Promise<{ url: string; init: RequestInit }> {
  const body = await encryptPayload(payload, subscription.keys);
  return {
    url: subscription.endpoint,
    init: {
      method: 'POST',
      headers: {
        Authorization: options.authorization,
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(options.ttl),
        Urgency: options.urgency ?? 'normal',
        ...(options.topic ? { Topic: options.topic } : {}),
      },
      body: body as BodyInit,
    },
  };
}
