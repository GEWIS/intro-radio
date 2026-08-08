#!/usr/bin/env node
// Generates a valid HS512-signed JWT for local Intro Radio development, and
// prints ready-to-use chat URLs for both the listener and admin/backoffice
// views.
//
// The backend (backend/chat.go) accepts any HS512 JWT signed with
// GEWIS_SECRET and containing `lidnr` / `given_name` / `family_name` claims
// -- it does not check expiry (jwt.WithoutClaimsValidation()). There is no
// login flow to drive locally, so this script hand-signs that token instead.
//
// Usage:
//   node scripts/dev-token.mjs
//   node scripts/dev-token.mjs --lidnr 1337 --given-name Ada --family-name Lovelace
//
// Env var overrides (checked before falling back to backend/chat.go's
// defaults, so this matches a backend you've started with custom secrets):
//   GEWIS_SECRET, RADIO_CHAT_KEY, LIDNR, GIVEN_NAME, FAMILY_NAME, FRONTEND_ORIGIN

import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CHAT_GO = path.join(REPO_ROOT, 'backend', 'chat.go');

// Reads the default for `envName` out of backend/chat.go's
// `String("ENV_NAME", "default")` calls, rather than guessing what the
// backend's fallback currently is. Only falls back to `fallback` if the
// source can't be read or the pattern isn't found there anymore.
function readDefaultFromSource(envName, fallback) {
  try {
    const src = readFileSync(CHAT_GO, 'utf8');
    const re = new RegExp(`String\\(\\s*"${envName}"\\s*,\\s*"([^"]*)"\\s*\\)`);
    const match = src.match(re);
    if (match) return match[1];
    console.error(
      `[dev-token] warning: could not find ${envName} default in backend/chat.go, falling back to "${fallback}"`,
    );
  } catch (err) {
    console.error(
      `[dev-token] warning: could not read backend/chat.go (${err.message}), falling back to "${fallback}" for ${envName}`,
    );
  }
  return fallback;
}

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function signHS512(secret, header, payload) {
  const headerPart = base64url(JSON.stringify(header));
  const payloadPart = base64url(JSON.stringify(payload));
  const signingInput = `${headerPart}.${payloadPart}`;
  const signature = createHmac('sha512', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      out[arg.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

const GEWIS_SECRET = process.env.GEWIS_SECRET || readDefaultFromSource('GEWIS_SECRET', 'ChangeMe');
const RADIO_CHAT_KEY = process.env.RADIO_CHAT_KEY || readDefaultFromSource('RADIO_CHAT_KEY', 'ChangeMe');

const lidnr = parseInt(args.lidnr || process.env.LIDNR || '1234', 10);
const givenName = args['given-name'] || process.env.GIVEN_NAME || 'Test';
const familyName = args['family-name'] || process.env.FAMILY_NAME || 'User';
const frontendOrigin = process.env.FRONTEND_ORIGIN || 'http://localhost:3000';

const nowSeconds = Math.floor(Date.now() / 1000);
const header = { alg: 'HS512', typ: 'JWT' };
const payload = {
  lidnr,
  given_name: givenName,
  family_name: familyName,
  iat: nowSeconds,
  exp: nowSeconds + 24 * 60 * 60,
};

const token = signHS512(GEWIS_SECRET, header, payload);

console.log('Generated Intro Radio dev JWT:');
console.log(`  lidnr:       ${lidnr}`);
console.log(`  given_name:  ${givenName}`);
console.log(`  family_name: ${familyName}`);
console.log('');
console.log('Token:');
console.log(token);
console.log('');
console.log('Listener chat:');
console.log(`  ${frontendOrigin}/?token=${token}`);
console.log('');
console.log('Admin / backoffice chat:');
console.log(`  ${frontendOrigin}/backoffice?token=${token}&key=${encodeURIComponent(RADIO_CHAT_KEY)}`);
