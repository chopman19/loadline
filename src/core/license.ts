// Unlimited-mode licences. Once Stripe confirms a payment, the server signs a small
// payload with a private ECDSA P-256 key. The game checks the signature with the matching
// public key, so editing localStorage can't forge an unlock. The same code runs in the
// browser and in the Netlify functions; both use WebCrypto.

export interface LicensePayload {
  v: 1;
  feature: 'unlimited';
  /** The Stripe Checkout Session that paid for it. */
  ref: string;
  /** Issued at, in ms since the epoch. */
  iat: number;
}

const KEY_ALG = { name: 'ECDSA', namedCurve: 'P-256' } as const;
const SIGN_ALG = { name: 'ECDSA', hash: 'SHA-256' } as const;

function toB64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const utf8 = (s: string) => new TextEncoder().encode(s);

/** Signs a licence. Server only: needs the private key. */
export async function signLicense(privateJwk: JsonWebKey, payload: LicensePayload): Promise<string> {
  const key = await crypto.subtle.importKey('jwk', privateJwk, KEY_ALG, false, ['sign']);
  const body = toB64url(utf8(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign(SIGN_ALG, key, utf8(body)));
  return `${body}.${toB64url(sig)}`;
}

/** Returns the payload if the token is a genuine licence, otherwise null. */
export async function verifyLicense(publicJwk: JsonWebKey, token: string | null | undefined): Promise<LicensePayload | null> {
  if (!token) return null;
  try {
    const [body, sig, extra] = token.split('.');
    if (!body || !sig || extra !== undefined) return null;
    const key = await crypto.subtle.importKey('jwk', publicJwk, KEY_ALG, false, ['verify']);
    if (!(await crypto.subtle.verify(SIGN_ALG, key, fromB64url(sig), utf8(body)))) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body))) as LicensePayload;
    return payload.v === 1 && payload.feature === 'unlimited' ? payload : null;
  } catch {
    return null;
  }
}

/** Makes a new key pair (scripts/make-license-keys.ts). */
export async function generateLicenseKeys(): Promise<{ publicJwk: JsonWebKey; privateJwk: JsonWebKey }> {
  const pair = await crypto.subtle.generateKey(KEY_ALG, true, ['sign', 'verify']);
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicJwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y }, privateJwk };
}
