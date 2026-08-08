/**
 * Validates a candidate radio admin key against the backend.
 *
 * Resolves `true` only on a 200 OK (`{ valid: true }`); a 401 (bad token,
 * bad key, or invalid claims -- the response doesn't distinguish which) or
 * a network failure both resolve `false`.
 */
export async function validateRadioKeyQuick(token: string, radioKey: string): Promise<boolean> {
  try {
    const res = await fetch('/api/v1/radio-key/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, radioKey }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
