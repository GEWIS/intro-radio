import { storeToRefs } from 'pinia';
import { onMounted } from 'vue';
import { useAppStore } from '@/stores/app';

const STORAGE_KEY = 'token';

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

function stripTokenParamFromUrl() {
  const newUrl = window.location.origin + window.location.pathname + window.location.hash;
  window.history.replaceState({}, document.title, newUrl);
}

function buildRedirectUrl(appSlug: string): string {
  return `https://gewis.nl/token/${encodeURIComponent(appSlug || 'gewis-radio')}`;
}

export function useGewisAuth() {
  const appStore = useAppStore();
  const { token: appSlug } = storeToRefs(appStore);

  async function ensureToken(): Promise<string> {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get('token');
    if (tokenFromUrl) {
      localStorage.setItem(STORAGE_KEY, tokenFromUrl);
      stripTokenParamFromUrl();
    }

    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && isValid(stored)) return stored;

    if (stored) localStorage.removeItem(STORAGE_KEY);
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

  onMounted(() => {
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get('token');
    if (tokenFromUrl) {
      localStorage.setItem(STORAGE_KEY, tokenFromUrl);
      stripTokenParamFromUrl();
    }
  });

  return { ensureToken, getToken, logout };
}
