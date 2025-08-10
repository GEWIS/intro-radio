// Mock: ensure a JWT is available for backoffice. In prod you would redirect to GEWIS auth.
export function useGewisAuth() {
  async function ensureToken(): Promise<string> {
    let token = localStorage.getItem('token');
    if (token) return token;

    // Dev mock: generate a HS512 JWT with GEWIS_SECRET=ChangeMe
    token = await makeMockToken({
      lidnr: 4141,
      given_name: 'testy',
      family_name: 'mctest',
      // 1 hour
      expSec: 60 * 60,
      secret: 'ChangeMe',
    });
    localStorage.setItem('token', token);
    return token;
  }

  return { ensureToken };
}

async function makeMockToken(opts: {
  lidnr: number;
  given_name: string;
  family_name: string;
  expSec: number;
  secret: string;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS512', typ: 'JWT' };
  const claims = {
    lidnr: opts.lidnr,
    given_name: opts.given_name,
    family_name: opts.family_name,
    iat: now,
    exp: now + opts.expSec,
  };
  const enc = new TextEncoder();
  const b64u = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

  const headerPart = b64u(JSON.stringify(header));
  const payloadPart = b64u(JSON.stringify(claims));
  const data = `${headerPart}.${payloadPart}`;

  const key = await crypto.subtle.importKey('raw', enc.encode(opts.secret), { name: 'HMAC', hash: 'SHA-512' }, false, [
    'sign',
  ]);
  const sigBuf = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  const sigB64 = b64u(String.fromCharCode(...new Uint8Array(sigBuf)));
  return `${data}.${sigB64}`;
}
