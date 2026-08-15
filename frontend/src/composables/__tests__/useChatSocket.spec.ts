import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatSocket } from '../useChatSocket';

// Real WebSocket would try an actual network connection. This fake
// implements just enough of the interface (readyState, addEventListener,
// send, close) for useChatSocket's own logic to drive, and exposes
// `emit(type, event)` plus `instances` so a test can reach into whichever
// socket useChatSocket most recently constructed and drive its lifecycle
// by hand.
class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  closed = false;
  private listeners: Record<string, ((event: unknown) => void)[]> = {};

  constructor(public url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    (this.listeners[type] ??= []).push(listener);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = FakeWebSocket.CLOSED;
  }

  emit(type: string, event: unknown = {}) {
    if (type === 'open') this.readyState = FakeWebSocket.OPEN;
    for (const l of this.listeners[type] ?? []) l(event);
  }
}

function latestSocket() {
  return FakeWebSocket.instances.at(-1);
}

describe('useChatSocket', () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('does not open a socket when getToken resolves falsy', async () => {
    const onMessage = vi.fn();
    const chat = useChatSocket({
      path: '/ws?role=user',
      getToken: async () => null,
      buildHandshake: (token) => ({ token }),
      onMessage,
    });

    await chat.connect();

    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(chat.isClosed.value).toBe(true);
    expect(chat.connecting.value).toBe(false);
  });

  it('sends the handshake built from the fetched token as soon as the socket opens', async () => {
    const chat = useChatSocket({
      path: '/ws?role=user',
      getToken: async () => 'tok-123',
      buildHandshake: (token) => ({ token, hello: true }),
      onMessage: vi.fn(),
    });

    await chat.connect();
    latestSocket().emit('open');

    expect(latestSocket().sent).toEqual([JSON.stringify({ token: 'tok-123', hello: true })]);
    expect(chat.isClosed.value).toBe(false);
  });

  it('parses incoming messages and forwards them to onMessage', async () => {
    const onMessage = vi.fn();
    const chat = useChatSocket<{ content: string }>({
      path: '/ws?role=user',
      getToken: async () => 'tok',
      buildHandshake: (token) => ({ token }),
      onMessage,
    });

    await chat.connect();
    latestSocket().emit('open');
    latestSocket().emit('message', { data: JSON.stringify({ content: 'hi' }) });

    expect(onMessage).toHaveBeenCalledWith({ content: 'hi' });
  });

  it('does not crash and does not forward on an unparseable message', async () => {
    const onMessage = vi.fn();
    const chat = useChatSocket({
      path: '/ws?role=user',
      getToken: async () => 'tok',
      buildHandshake: (token) => ({ token }),
      onMessage,
    });

    await chat.connect();
    latestSocket().emit('open');
    latestSocket().emit('message', { data: 'not json' });

    expect(onMessage).not.toHaveBeenCalled();
  });

  it('reconnects with exponential backoff after an unexpected close', async () => {
    const chat = useChatSocket({
      path: '/ws?role=user',
      getToken: async () => 'tok',
      buildHandshake: (token) => ({ token }),
      onMessage: vi.fn(),
    });

    await chat.connect();
    latestSocket().emit('open');
    latestSocket().emit('close', { code: 1006 });

    expect(chat.isClosed.value).toBe(true);
    expect(FakeWebSocket.instances).toHaveLength(1); // not yet -- still waiting out the backoff

    await vi.advanceTimersByTimeAsync(1000); // base delay for the first retry
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('does not reconnect after a non-retryable close code', async () => {
    const onClose = vi.fn();
    const chat = useChatSocket({
      path: '/ws?role=user',
      getToken: async () => 'tok',
      buildHandshake: (token) => ({ token }),
      onMessage: vi.fn(),
      onClose,
    });

    await chat.connect();
    latestSocket().emit('open');
    latestSocket().emit('close', { code: 4103 }); // invalid radio key

    expect(onClose).toHaveBeenCalledWith({ code: 4103 }, false);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it('does not reconnect after an intentional disconnect', async () => {
    const chat = useChatSocket({
      path: '/ws?role=user',
      getToken: async () => 'tok',
      buildHandshake: (token) => ({ token }),
      onMessage: vi.fn(),
    });

    await chat.connect();
    latestSocket().emit('open');
    chat.disconnect();
    latestSocket().emit('close', { code: 1000 });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(chat.isClosed.value).toBe(true);
  });

  it('send() returns false and does not throw when the socket is not open', () => {
    const chat = useChatSocket({
      path: '/ws?role=user',
      getToken: async () => 'tok',
      buildHandshake: (token) => ({ token }),
      onMessage: vi.fn(),
    });

    expect(chat.send({ content: 'hi' })).toBe(false);
  });

  it('send() writes JSON to the socket and returns true when open', async () => {
    const chat = useChatSocket({
      path: '/ws?role=user',
      getToken: async () => 'tok',
      buildHandshake: (token) => ({ token }),
      onMessage: vi.fn(),
    });

    await chat.connect();
    latestSocket().emit('open');
    const ok = chat.send({ content: 'hello' });

    expect(ok).toBe(true);
    expect(latestSocket().sent.at(-1)).toBe(JSON.stringify({ content: 'hello' }));
  });
});
