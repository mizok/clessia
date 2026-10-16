import { describe, expect, it } from 'vitest';

import {
  MAX_PAYLOAD_BYTES,
  buildPushRequest,
  encryptPayload,
  fromB64u,
  toB64u,
  vapidAuthorization,
} from './web-push';

/**
 * #1657：RFC 8291 第 5 節的範例（附錄 A 有中間值）—— 固定的發送端金鑰與 salt，輸出必須逐 byte 相同。
 * 向量逐字抄自 https://www.rfc-editor.org/rfc/rfc8291.txt（去掉換行與空白）。
 */
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  authSecret: 'BTBZMqHH6r4Tts7J_aSIgg',
  uaPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  asPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml' +
    'mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT' +
    'pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};
const keys = { p256dh: RFC.uaPublic, auth: RFC.authSecret };

/** 收件端解密（RFC 8291 反向），只在測試裡用來驗「隨機金鑰」那條路 */
async function decrypt(body: Uint8Array, uaPrivate: string, uaPublic: string, auth: string) {
  const enc = new TextEncoder();
  const salt = body.subarray(0, 16);
  const idlen = body[20]!;
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const jwk = (pub: Uint8Array, d?: string): JsonWebKey => ({
    kty: 'EC',
    crv: 'P-256',
    x: toB64u(pub.subarray(1, 33)),
    y: toB64u(pub.subarray(33)),
    ...(d ? { d } : {}),
  });
  const ec = { name: 'ECDH', namedCurve: 'P-256' } as const;
  const priv = await crypto.subtle.importKey('jwk', jwk(fromB64u(uaPublic), uaPrivate), ec, false, [
    'deriveBits',
  ]);
  const pub = await crypto.subtle.importKey('jwk', jwk(asPublic), ec, false, []);
  const secret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: pub } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      priv,
      256,
    ),
  );
  const hkdf = async (s: Uint8Array, ikm: Uint8Array, info: Uint8Array, n: number) =>
    new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: s as BufferSource, info: info as BufferSource },
        await crypto.subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']),
        n * 8,
      ),
    );
  const ua = fromB64u(uaPublic);
  const info = new Uint8Array([...enc.encode('WebPush: info\0'), ...ua, ...asPublic]);
  const ikm = await hkdf(fromB64u(auth), secret, info, 32);
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek as BufferSource, 'AES-GCM', false, [
    'decrypt',
  ]);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource },
      key,
      ciphertext as BufferSource,
    ),
  );
  expect(plain.at(-1)).toBe(2); // 最後一個 record 的分隔
  return new TextDecoder().decode(plain.subarray(0, -1));
}

describe('encryptPayload（RFC 8291）', () => {
  it('RFC 8291 §5 的範例：逐 byte 相同', async () => {
    const body = await encryptPayload(RFC.plaintext, keys, {
      salt: fromB64u(RFC.salt),
      publicKey: fromB64u(RFC.asPublic),
      privateKey: fromB64u(RFC.asPrivate),
    });
    expect(toB64u(body)).toBe(RFC.body);
  });

  it('正式路徑（每則新的發送端金鑰與 salt）：收件端解得回來，兩次輸出不同', async () => {
    const a = await encryptPayload('王小明 10 月學費 10/20 到期', keys);
    const b = await encryptPayload('王小明 10 月學費 10/20 到期', keys);
    expect(toB64u(a)).not.toBe(toB64u(b));
    expect(await decrypt(a, RFC.uaPrivate, RFC.uaPublic, RFC.authSecret)).toBe(
      '王小明 10 月學費 10/20 到期',
    );
  });

  it('超過上限就丟，不送出會被 413 的東西', async () => {
    await expect(encryptPayload('x'.repeat(MAX_PAYLOAD_BYTES + 1), keys)).rejects.toThrow(
      RangeError,
    );
    await expect(encryptPayload('x'.repeat(MAX_PAYLOAD_BYTES), keys)).resolves.toHaveLength(4096);
  });
});

describe('vapidAuthorization（RFC 8292）', () => {
  it('簽出的 JWT 用公鑰驗得過；aud 是推播服務的 origin、exp 不超過 24 小時', async () => {
    const pair = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])) as CryptoKeyPair;
    const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
    const publicKey = toB64u(
      new Uint8Array((await crypto.subtle.exportKey('raw', pair.publicKey)) as ArrayBuffer),
    );
    const now = 1_700_000_000;

    const header = await vapidAuthorization(
      'https://fcm.googleapis.com/fcm/send/abc',
      { publicKey, privateKey: jwk.d! },
      'mailto:ops@example.com',
      now,
    );
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(m).not.toBeNull();
    const [, h, c, sig, k] = m!;
    expect(k).toBe(publicKey);
    const claims = JSON.parse(new TextDecoder().decode(fromB64u(c!)));
    expect(claims).toEqual({
      aud: 'https://fcm.googleapis.com',
      exp: now + 12 * 3600,
      sub: 'mailto:ops@example.com',
    });
    expect(claims.exp - now).toBeLessThanOrEqual(24 * 3600);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pair.publicKey,
      fromB64u(sig!) as BufferSource,
      new TextEncoder().encode(`${h}.${c}`) as BufferSource,
    );
    expect(ok).toBe(true);
  });
});

describe('buildPushRequest（RFC 8030 標頭）', () => {
  it('帶 TTL、Content-Encoding、Topic；body 是加密後的', async () => {
    const { url, init } = await buildPushRequest(
      { endpoint: 'https://push.example.net/push/x', keys },
      'hi',
      { authorization: 'vapid t=a.b.c, k=d', ttl: 86400, topic: 'inv123' },
    );
    expect(url).toBe('https://push.example.net/push/x');
    expect(init.headers).toMatchObject({
      Authorization: 'vapid t=a.b.c, k=d',
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
      Urgency: 'normal',
      Topic: 'inv123',
    });
    expect(
      await decrypt(init.body as Uint8Array, RFC.uaPrivate, RFC.uaPublic, RFC.authSecret),
    ).toBe('hi');
  });
});
