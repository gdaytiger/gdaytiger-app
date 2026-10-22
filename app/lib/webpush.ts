import crypto from 'node:crypto';

// Minimal Web Push sender (RFC 8291 aes128gcm + RFC 8292 VAPID) using only
// node:crypto — no npm dependency. Works for iOS home-screen web apps (16.4+),
// Chrome, Firefox.
//
// Env (Vercel): VAPID_PUBLIC_KEY  — base64url, 65-byte uncompressed P-256 point
//               VAPID_PRIVATE_KEY — base64url, 32-byte private scalar

export type PushSubscriptionJSON = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
};

const b64u = (b: Buffer) => b.toString('base64url');
const unb64u = (s: string) => Buffer.from(s, 'base64url');

function vapidHeader(endpoint: string): string {
  const pub = unb64u(process.env.VAPID_PUBLIC_KEY || '');
  const d = process.env.VAPID_PRIVATE_KEY || '';
  const key = crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: 'jwk',
  });
  const header = b64u(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(Buffer.from(JSON.stringify({
    aud: new URL(endpoint).origin,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: 'mailto:gday@gdaytiger.com.au',
  })));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${b64u(pub)}`;
}

export function encryptPayload(sub: PushSubscriptionJSON, payload: string): Buffer {
  const uaPublic = unb64u(sub.keys.p256dh);
  const authSecret = unb64u(sub.keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  const asPublic = ecdh.generateKeys();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, keyInfo, 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

// Returns the push service HTTP status. 404/410 = subscription expired → drop it.
export async function sendPush(sub: PushSubscriptionJSON, data: object): Promise<number> {
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidHeader(sub.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '7200',
      Urgency: 'high',
    },
    body: new Uint8Array(encryptPayload(sub, JSON.stringify(data))),
  });
  return res.status;
}
