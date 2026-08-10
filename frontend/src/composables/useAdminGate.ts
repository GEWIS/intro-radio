import { ref } from 'vue';
import { useGewisAuth } from '@/composables/useGewisAuth';
import { validateRadioKeyQuick } from '@/composables/useRadioKeyValidation';

export type AdminGateStage = 'auth' | 'need-key' | 'ready';

const STORAGE_KEY = 'RADIO_ADMIN_KEY';

/**
 * The admin-key gate shared by every backoffice page: resolve a GEWIS
 * token, then check for a stored/queried radio key and validate it against
 * the backend. Pulled out of backoffice.vue so the agenda page can reuse
 * the exact same flow instead of duplicating it.
 */
export function useAdminGate() {
  const stage = ref<AdminGateStage>('auth');
  const token = ref<string | null>(null);
  const radioKey = ref<string | null>(null);
  const errorMsg = ref('');

  const { ensureToken } = useGewisAuth();

  async function init() {
    token.value = await ensureToken();

    const fromQuery = new URLSearchParams(window.location.search).get('key');
    const fromStore = localStorage.getItem(STORAGE_KEY);
    radioKey.value = fromQuery || fromStore || null;

    if (!radioKey.value) {
      stage.value = 'need-key';
      return;
    }

    const ok = await validateRadioKeyQuick(token.value, radioKey.value);
    if (ok) {
      localStorage.setItem(STORAGE_KEY, radioKey.value);
      stage.value = 'ready';
    } else {
      stage.value = 'need-key';
      errorMsg.value = 'Something went wrong. Try again.';
    }
  }

  async function submitKey(candidate: string): Promise<boolean> {
    errorMsg.value = '';
    const ok = await validateRadioKeyQuick(token.value!, candidate.trim());

    if (ok) {
      radioKey.value = candidate.trim();
      localStorage.setItem(STORAGE_KEY, radioKey.value);
      stage.value = 'ready';
    } else {
      errorMsg.value = 'Invalid key or connection failed. Try again.';
    }
    return ok;
  }

  function dropToNeedKey(message = 'Your admin key was rejected. Please try again.') {
    stage.value = 'need-key';
    errorMsg.value = message;
  }

  return { stage, token, radioKey, errorMsg, init, submitKey, dropToNeedKey };
}
