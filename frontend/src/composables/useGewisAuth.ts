import { storeToRefs } from 'pinia';
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '@/stores/app';

const STORAGE_KEY = 'token';
const RETURN_PATH_KEY = 'gewis-auth-return-path';

function decodeJwtPayload(token: string): any | null {
  try {
    const [, payload] = token.split('.');
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

function isValid(token: string): boolean {
  const p = decodeJwtPayload(token);
  if (!p || typeof p.exp !== 'number') return false;
  const now = Math.floor(Date.now() / 1000);
  return p.exp > now + 5;
}

export function stripTokenParamFromUrl() {
  const params = new URLSearchParams(window.location.search);
  params.delete('token');
  const query = params.toString();
  const newUrl = window.location.origin + window.location.pathname + (query ? `?${query}` : '') + window.location.hash;
  window.history.replaceState({}, document.title, newUrl);
}

function buildRedirectUrl(appSlug: string): string {
  return `https://gewis.nl/token/${encodeURIComponent(appSlug || 'gewis-radio')}`;
}

function currentPath(): string {
  return window.location.pathname + window.location.search + window.location.hash;
}

// Exported for direct unit testing -- everything else in this file needs a
// live component/router context (onMounted, useRouter), which this repo's
// tests don't spin up (see stripTokenParamFromUrl's own tests for why).
// Returns the path to navigate back to, or null if there's nothing saved or
// it's already where we are (comparison happens against the *current*
// location, so callers don't need to pass it in).
export function resolveReturnPath(savedPath: string | null): string | null {
  if (!savedPath || savedPath === currentPath()) return null;
  return savedPath;
}

export function useGewisAuth() {
  const appStore = useAppStore();
  const { token: appSlug } = storeToRefs(appStore);
  const router = useRouter();

  // gewis.nl/token/<slug> always returns to this app's one fixed registered
  // URL, not wherever the user actually was -- so if a ?token= just arrived
  // (the return trip from that redirect), store it, strip it from the URL,
  // and route back to whatever path ensureToken() saved before sending the
  // user off to log in.
  function consumeTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get('token');
    if (!tokenFromUrl) return;

    localStorage.setItem(STORAGE_KEY, tokenFromUrl);
    stripTokenParamFromUrl();

    const savedPath = sessionStorage.getItem(RETURN_PATH_KEY);
    sessionStorage.removeItem(RETURN_PATH_KEY);
    const returnPath = resolveReturnPath(savedPath);
    if (returnPath) router.replace(returnPath);
  }

  async function ensureToken(): Promise<string> {
    consumeTokenFromUrl();

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isValid(stored)) return stored;

    if (stored) localStorage.removeItem(STORAGE_KEY);

    // Remember where the user was headed before being sent to gewis.nl, so
    // consumeTokenFromUrl() can send them back here on the way in.
    sessionStorage.setItem(RETURN_PATH_KEY, currentPath());

    const redirectUrl = buildRedirectUrl(appSlug.value);
    window.location.replace(redirectUrl);
    return new Promise<string>(() => {});
  }

  function getToken(): string | null {
    const t = localStorage.getItem(STORAGE_KEY);
    if (!t) return null;
    if (!isValid(t)) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return t;
  }

  function logout() {
    localStorage.removeItem(STORAGE_KEY);
  }

  onMounted(consumeTokenFromUrl);

  return { ensureToken, getToken, logout };
}
