import { ref } from 'vue';

export interface ChatSocketOptions<TMessage = unknown> {
  /** Path passed to the WebSocket, e.g. '/ws?role=user'. */
  path: string;
  /**
   * Returns the current auth token. Invoked fresh on every (re)connect
   * attempt -- including automatic reconnects -- so a stale token is never
   * reused. Returning a falsy value aborts the connection attempt.
   */
  getToken: () => string | null | undefined | Promise<string | null | undefined>;
  /** Builds the handshake payload sent immediately once the socket opens. */
  buildHandshake: (token: string) => unknown;
  /** Called for every message received after the handshake has been sent. */
  onMessage: (data: TMessage) => void;
  /** Called right after the handshake is sent for a newly opened connection. */
  onOpen?: () => void;
  /** Called on every close. `willReconnect` reflects whether auto-reconnect was scheduled. */
  onClose?: (event: CloseEvent, willReconnect: boolean) => void;
  /** Close codes that should never trigger auto-reconnect (e.g. auth failures). */
  nonRetryableCloseCodes?: number[];
  /** Base delay for exponential backoff, in ms. Defaults to 1000. */
  baseDelayMs?: number;
  /** Max delay for exponential backoff, in ms. Defaults to 30000. */
  maxDelayMs?: number;
}

// 4100 = "replaced by new connection" (another tab took over this user's session)
// 4103 = "invalid radio key" -- both are permanent for this connection, retrying won't help.
const DEFAULT_NON_RETRYABLE_CLOSE_CODES = [4100, 4103];
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;
const MAX_RECONNECT_ATTEMPT_EXPONENT = 10; // delay is already capped by maxDelayMs well before this

// The server completes the WebSocket upgrade (firing the browser's `open` event)
// before it has verified the handshake token, then closes immediately if the
// token is invalid. That means `open` alone is not proof of a working
// connection -- resetting the backoff counter there would make an invalid
// token retry every ~1s forever instead of backing off. Only reset once the
// connection has stayed open long enough to be considered stable.
const STABLE_CONNECTION_MS = 3000;

/**
 * Shared WebSocket connect/reconnect/handshake logic for the radio chat.
 *
 * Handles building the ws:/wss: URL from the current page's protocol,
 * sending a handshake once open, auto-reconnecting with exponential backoff
 * on an unexpected close (but not on an intentional disconnect/unmount), and
 * re-fetching a fresh token on every connect attempt.
 */
export function useChatSocket<TMessage = unknown>(options: ChatSocketOptions<TMessage>) {
  const isClosed = ref(true);
  const connecting = ref(false);

  let socket: WebSocket | null = null;
  let intentionalClose = false;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let stableConnectionTimer: ReturnType<typeof setTimeout> | null = null;

  function buildUrl(): string {
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${window.location.host}${options.path}`;
  }

  function clearReconnectTimer() {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function clearStableConnectionTimer() {
    if (stableConnectionTimer !== null) {
      clearTimeout(stableConnectionTimer);
      stableConnectionTimer = null;
    }
  }

  function scheduleReconnect() {
    clearReconnectTimer();
    const base = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    const max = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
    const delay = Math.min(max, base * 2 ** reconnectAttempt);
    reconnectAttempt = Math.min(reconnectAttempt + 1, MAX_RECONNECT_ATTEMPT_EXPONENT);
    reconnectTimer = setTimeout(() => {
      connect();
    }, delay);
  }

  async function connect() {
    if (connecting.value) return;

    clearReconnectTimer();
    clearStableConnectionTimer();

    if (socket) {
      intentionalClose = true;
      try {
        socket.close();
      } catch {
        // ignore
      }
      socket = null;
    }

    intentionalClose = false;
    connecting.value = true;

    let token: string | null | undefined;
    try {
      token = await options.getToken();
    } catch (error) {
      console.error('useChatSocket: failed to fetch token', error);
      token = null;
    }

    if (!token) {
      connecting.value = false;
      isClosed.value = true;
      return;
    }

    const ws = new WebSocket(buildUrl());
    socket = ws;

    ws.addEventListener('open', () => {
      if (socket !== ws) return; // superseded by a newer connection attempt
      isClosed.value = false;
      connecting.value = false;
      ws.send(JSON.stringify(options.buildHandshake(token as string)));
      options.onOpen?.();

      // The TCP-level upgrade succeeding doesn't mean the handshake token was
      // accepted -- the server closes right after if it wasn't. Only treat
      // the backoff as resolved once the connection has proven stable.
      clearStableConnectionTimer();
      stableConnectionTimer = setTimeout(() => {
        reconnectAttempt = 0;
      }, STABLE_CONNECTION_MS);
    });

    ws.addEventListener('message', (event: MessageEvent) => {
      if (socket !== ws) return;
      try {
        options.onMessage(JSON.parse(event.data) as TMessage);
      } catch (error) {
        console.error('useChatSocket: failed to parse message', error);
      }
    });

    ws.addEventListener('close', (event: CloseEvent) => {
      if (socket !== ws) return; // stale socket, already superseded
      socket = null;
      connecting.value = false;
      isClosed.value = true;
      clearStableConnectionTimer();

      const nonRetryable = options.nonRetryableCloseCodes ?? DEFAULT_NON_RETRYABLE_CLOSE_CODES;
      const willReconnect = !intentionalClose && !nonRetryable.includes(event.code);
      options.onClose?.(event, willReconnect);

      if (willReconnect) scheduleReconnect();
    });
  }

  function disconnect() {
    intentionalClose = true;
    clearReconnectTimer();
    clearStableConnectionTimer();
    reconnectAttempt = 0;
    connecting.value = false;
    if (socket) {
      try {
        socket.close();
      } catch {
        // ignore
      }
      socket = null;
    }
    isClosed.value = true;
  }

  function send(payload: unknown): boolean {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(payload));
    return true;
  }

  return { isClosed, connecting, connect, disconnect, send };
}
