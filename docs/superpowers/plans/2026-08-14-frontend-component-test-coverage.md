# Frontend Component/Composable Test Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close out GEWIS/intro-radio#1 by adding Vitest coverage for every currently-untested composable and Vue component in `frontend/src`.

**Architecture:** Vitest already runs composable/store tests with zero special config (default `node` environment; modern Node's built-in `localStorage` happens to cover what's been tested so far). Component tests need real DOM APIs and Vue SFC mounting, neither of which exist yet. Task 1 adds that infrastructure once (jsdom environment + `@vue/test-utils` + a shared Vuetify-aware mount helper); every other task only consumes it. All new tests follow the existing convention seen in `useAdminGate.spec.ts`/`useAgendaEditor.spec.ts`: `vi.mock()` + `vi.hoisted()` for dependencies, direct `.value` assertions, no snapshot testing.

**Tech Stack:** Vitest 4, `@vue/test-utils` (new), Vuetify 3 (`createVuetify`, already a dependency), jsdom (already a devDependency, currently unused).

**Spec:** [GEWIS/intro-radio#1](https://github.com/GEWIS/intro-radio/issues/1) -- "full coverage of components/composables is still open." Scope is deliberately components + composables, matching the issue's own wording; `frontend/src/pages/*.vue` are thin wrappers around already-covered components (`pages/index.vue` is a one-line `<Landing />` wrapper) and are out of scope for this pass.

## Global Constraints

- Match existing test file naming/location: `src/<dir>/__tests__/<Name>.spec.ts`, colocated with the source.
- Match existing mocking convention: `vi.mock()` for module dependencies, `vi.hoisted()` for any mock function referenced inside a factory, never a real network/WebSocket connection or real Vuetify theme persistence side effect.
- No snapshot tests. Every assertion targets a specific, named behavior.
- Run `yarn lint`, `yarn type-check`, and `yarn test` after every task; all three must pass before moving on.
- Do not modify any non-test, non-config source file. This plan adds tests for existing behavior; it does not change application behavior. (Task 1's `vite.config.mts`/`package.json` edits are the one necessary exception -- they add test infra, not app behavior.)

---

## Task 1: Component-testing infrastructure

**Files:**
- Modify: `frontend/vite.config.mts`
- Modify: `frontend/package.json` (add `@vue/test-utils`)
- Create: `frontend/src/test-utils.ts`
- Test: `frontend/src/__tests__/test-utils.spec.ts`

**Interfaces:**
- Produces: `mountWithVuetify(component, options?)` from `@/test-utils`, used by every component test task below. Signature: `mountWithVuetify<T>(component: T, options?: ComponentMountingOptions<T>): VueWrapper` -- same shape as `@vue/test-utils`'s `mount`, with a Vuetify instance already installed as a global plugin.

- [ ] **Step 1: Create the branch**

```bash
git checkout -b test/frontend-component-coverage
```

- [ ] **Step 2: Add `@vue/test-utils`**

```bash
cd frontend && yarn add -D @vue/test-utils
```

- [ ] **Step 3: Point Vitest at a jsdom environment via the existing Vite config**

In `frontend/vite.config.mts`, change the import so the same config object also carries Vitest's `test` field (this is Vitest's own documented way to share one config file with Vite -- `vitest/config`'s `defineConfig` is a superset of Vite's, so nothing about the existing dev-server/build config changes):

```ts
// before
import { defineConfig } from 'vite';

// after
import { defineConfig } from 'vitest/config';
```

Then add a `test` key to the returned config object (alongside the existing `plugins`, `resolve`, etc. keys):

```ts
test: {
  environment: 'jsdom',
},
```

- [ ] **Step 4: Create the shared mount helper**

```ts
// frontend/src/test-utils.ts
import type { ComponentMountingOptions } from '@vue/test-utils';
import { mount } from '@vue/test-utils';
import { createVuetify } from 'vuetify';

// Every *.vue file in this app uses Vuetify components (v-card, v-btn, ...).
// Without a real Vuetify instance installed, v-model and slot-based
// components (v-text-field, v-color-picker, v-dialog) don't behave like
// their real selves under test -- they'd render as inert unknown elements.
// One shared instance, created fresh per call so tests don't leak theme
// state into each other.
export function mountWithVuetify<T>(component: T, options: ComponentMountingOptions<T> = {}) {
  const vuetify = createVuetify();
  return mount(component, {
    ...options,
    global: {
      plugins: [vuetify, ...(options.global?.plugins ?? [])],
      ...options.global,
    },
  });
}
```

- [ ] **Step 5: Write a smoke test proving the infra works end-to-end**

```ts
// frontend/src/__tests__/test-utils.spec.ts
import { describe, expect, it } from 'vitest';
import { defineComponent, h } from 'vue';
import { mountWithVuetify } from '../test-utils';

describe('mountWithVuetify', () => {
  it('mounts a component with Vuetify components resolved (not stubbed as unknown elements)', () => {
    const Probe = defineComponent({
      name: 'Probe',
      render: () => h('v-btn' as unknown as string, { class: 'probe-btn' }, 'click me'),
    });

    const wrapper = mountWithVuetify(Probe);

    // A real Vuetify v-btn renders its own internal <button> and CSS
    // classes (v-btn, v-btn--...) -- an unresolved custom element would
    // just pass the literal tag through with none of that. Asserting on
    // Vuetify's own output class is the check that the plugin is actually
    // installed, not just that the tag didn't crash.
    expect(wrapper.find('button.v-btn').exists()).toBe(true);
  });
});
```

- [ ] **Step 6: Run the full check and verify it passes, and that existing tests are unaffected**

Run: `cd frontend && yarn lint && yarn type-check && yarn test`
Expected: all existing spec files still pass (6 files, 35 tests, per current baseline) plus the new `test-utils.spec.ts` (1 test), all green. `yarn build` should also still succeed (config change must not break the production build).

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/yarn.lock frontend/vite.config.mts frontend/src/test-utils.ts frontend/src/__tests__/test-utils.spec.ts
git commit -m "test: add component-testing infrastructure (jsdom + @vue/test-utils)"
```

---

## Task 2: `useChatSocket` composable tests

**Files:**
- Create: `frontend/src/composables/__tests__/useChatSocket.spec.ts`

**Interfaces:**
- Consumes: `useChatSocket<TMessage>(options: ChatSocketOptions<TMessage>)` from `@/composables/useChatSocket`, returning `{ isClosed, connecting, connect, disconnect, send }`.

No component mounting needed here -- `useChatSocket` has no lifecycle hooks, so it's callable directly like the existing composable tests. The only new piece is a hand-rolled `WebSocket` stub (jsdom's `WebSocket` global is a real implementation that will actually try to open a network connection, which must not happen in a test).

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/composables/__tests__/useChatSocket.spec.ts
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
  return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd frontend && yarn test useChatSocket`
Expected: FAIL -- `useChatSocket` module doesn't exist under test yet is fine (it does exist as source), but the fake global `WebSocket` and fake-timer plumbing needs to actually be exercised first; run once to confirm the file is picked up and see real failures, if any, before moving on. (This composable already exists and is correct -- this task is pure characterization, not TDD-driving new behavior, so "fails first" isn't the point; the point is confirming the mocks correctly drive the real implementation.)

- [ ] **Step 3: Run tests and confirm all pass**

Run: `cd frontend && yarn test useChatSocket`
Expected: PASS, 9 tests.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/composables/__tests__/useChatSocket.spec.ts
git commit -m "test: add useChatSocket coverage"
```

---

## Task 3: `useCountdown` composable tests

**Files:**
- Create: `frontend/src/composables/__tests__/useCountdown.spec.ts`

**Interfaces:**
- Consumes: `useCountdown(startTime: Date, intervalMs?: number)` from `@/composables/useCountdown`, returning `{ now, countdown, isStarted, formattedCountdown }`.

`useCountdown` calls `onMounted`/`onUnmounted`, so it must be invoked from inside a component's `setup()` -- use `mountWithVuetify` (Task 1) with a tiny host component that calls the composable and exposes its return value.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/composables/__tests__/useCountdown.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { mountWithVuetify } from '@/test-utils';
import { useCountdown } from '../useCountdown';

function mountCountdown(startTime: Date, intervalMs?: number) {
  let result!: ReturnType<typeof useCountdown>;
  const Host = defineComponent({
    setup() {
      result = useCountdown(startTime, intervalMs);
      return () => null;
    },
  });
  mountWithVuetify(Host);
  return result;
}

describe('useCountdown', () => {
  it('reports not started with a positive formatted countdown before start time', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { isStarted, countdown, formattedCountdown } = mountCountdown(new Date('2026-01-01T01:01:05Z'));

    expect(isStarted.value).toBe(false);
    expect(countdown.value).toBe(61 * 60 * 1000 + 5000);
    expect(formattedCountdown.value).toBe('1 Hour, 1 minute and 5 seconds');
  });

  it('reports started once start time has passed', () => {
    vi.setSystemTime(new Date('2026-01-01T02:00:00Z'));
    const { isStarted, countdown } = mountCountdown(new Date('2026-01-01T01:00:00Z'));

    expect(isStarted.value).toBe(true);
    expect(countdown.value).toBeLessThanOrEqual(0);
  });

  it('pluralizes hours/minutes/seconds correctly at exactly 1 of each', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { formattedCountdown } = mountCountdown(new Date('2026-01-01T01:01:01Z'));

    expect(formattedCountdown.value).toBe('1 Hour, 1 minute and 1 second');
  });

  it('omits the hours segment entirely under an hour', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { formattedCountdown } = mountCountdown(new Date('2026-01-01T00:05:09Z'));

    expect(formattedCountdown.value).toBe('5 minutes and 9 seconds');
  });

  it('shows just seconds under a minute', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { formattedCountdown } = mountCountdown(new Date('2026-01-01T00:00:09Z'));

    expect(formattedCountdown.value).toBe('9 seconds');
  });

  it('re-derives countdown as `now` advances on the interval', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { countdown } = mountCountdown(new Date('2026-01-01T00:00:10Z'), 1000);

    expect(countdown.value).toBe(10_000);
    await vi.advanceTimersByTimeAsync(4000);
    expect(countdown.value).toBe(6000);
    vi.useRealTimers();
  });

  it('forces isStarted via ?debug=countdown regardless of start time', () => {
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, search: '?debug=countdown' },
      writable: true,
    });

    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    const { isStarted, countdown } = mountCountdown(new Date('2200-01-01T00:00:00Z'));

    expect(isStarted.value).toBe(true);
    expect(countdown.value).toBe(-1);

    Object.defineProperty(window, 'location', { value: originalLocation, writable: true });
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `cd frontend && yarn test useCountdown`
Expected: PASS, 7 tests.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/composables/__tests__/useCountdown.spec.ts
git commit -m "test: add useCountdown coverage"
```

---

## Task 4: `useDarkMode` composable tests

**Files:**
- Create: `frontend/src/composables/__tests__/useDarkMode.spec.ts`

**Interfaces:**
- Consumes: `useDarkMode()` from `@/composables/useDarkMode`, returning `{ isDark, toggle, enable, disable }`.

Same lifecycle-hook constraint as Task 3 -- mount via a host component. `useTheme()` needs a real Vuetify instance (`mountWithVuetify` provides one), so this does NOT mock Vuetify; it exercises the real `theme.global.name` ref, which is what actually proves the composable flips Vuetify's own theme, not just a local flag.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/composables/__tests__/useDarkMode.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { mountWithVuetify } from '@/test-utils';
import { useDarkMode } from '../useDarkMode';

function mountDarkMode() {
  let result!: ReturnType<typeof useDarkMode>;
  const Host = defineComponent({
    setup() {
      result = useDarkMode();
      return () => null;
    },
  });
  mountWithVuetify(Host);
  return result;
}

function mockMatchMedia(prefersDark: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: prefersDark,
      addEventListener: vi.fn(),
    }),
  );
}

describe('useDarkMode', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('applies the system preference when nothing is stored yet', () => {
    mockMatchMedia(true);
    const { isDark } = mountDarkMode();

    expect(isDark.value).toBe(true);
    expect(localStorage.getItem('dark-mode')).toBe('true');
  });

  it('applies a stored preference over the system preference', () => {
    localStorage.setItem('dark-mode', 'false');
    mockMatchMedia(true); // system says dark, stored says light -- stored wins

    const { isDark } = mountDarkMode();

    expect(isDark.value).toBe(false);
  });

  it('toggle() flips isDark and persists the new value', () => {
    localStorage.setItem('dark-mode', 'false');
    mockMatchMedia(false);
    const { isDark, toggle } = mountDarkMode();

    toggle();

    expect(isDark.value).toBe(true);
    expect(localStorage.getItem('dark-mode')).toBe('true');
  });

  it('enable()/disable() set an explicit value regardless of current state', () => {
    localStorage.setItem('dark-mode', 'false');
    mockMatchMedia(false);
    const { isDark, enable, disable } = mountDarkMode();

    enable();
    expect(isDark.value).toBe(true);

    disable();
    expect(isDark.value).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `cd frontend && yarn test useDarkMode`
Expected: PASS, 4 tests.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/composables/__tests__/useDarkMode.spec.ts
git commit -m "test: add useDarkMode coverage"
```

---

## Task 5: `IconColorPicker.vue` tests

**Files:**
- Create: `frontend/src/components/__tests__/IconColorPicker.vue.spec.ts`

**Interfaces:**
- Consumes: `IconColorPicker` component, props `{ modelValue: AgendaEvent }`, emits `update:model-value`.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/components/__tests__/IconColorPicker.vue.spec.ts
import type { AgendaEvent } from '@/stores/app';
import { describe, expect, it } from 'vitest';
import IconColorPicker from '@/components/IconColorPicker.vue';
import { mountWithVuetify } from '@/test-utils';

function makeEvent(overrides: Partial<AgendaEvent> = {}): AgendaEvent {
  return {
    title: '',
    subtitle: '',
    icon: 'mdi-star',
    iconColor: 'blue',
    color: '#ffffff',
    colorDark: '#000000',
    date: '2026-01-01',
    time: '9:00 - 10:00',
    ...overrides,
  };
}

describe('IconColorPicker', () => {
  it('emits the picked icon merged onto the existing model value', async () => {
    const wrapper = mountWithVuetify(IconColorPicker, { props: { modelValue: makeEvent() } });

    const starBtn = wrapper.findAll('button').find((b) => b.text() === '' && b.html().includes('mdi-star'));
    // Icons render inside v-icon with no text -- select by the search input
    // instead, which is a more stable target than icon button order.
    await wrapper.get('input[type="text"]').setValue('calendar');
    const calendarBtn = wrapper.findAll('button').find((b) => b.html().includes('mdi-calendar') && !b.html().includes('mdi-calendar-'));
    await calendarBtn?.trigger('click');

    const emitted = wrapper.emitted('update:model-value');
    expect(emitted).toBeTruthy();
    const [payload] = emitted![emitted!.length - 1] as [AgendaEvent];
    expect(payload.icon).toBe('mdi-calendar');
    expect(payload.title).toBe(''); // rest of the model passed through unchanged
  });

  it('offers a custom mdi-name candidate for an exact, unmatched query', async () => {
    const wrapper = mountWithVuetify(IconColorPicker, { props: { modelValue: makeEvent() } });

    await wrapper.get('input[type="text"]').setValue('mdi-something-totally-custom');

    expect(wrapper.text()).toContain('Use "mdi-something-totally-custom"');
  });

  it('does not offer a custom-icon candidate for a query that is not a valid mdi-name', async () => {
    const wrapper = mountWithVuetify(IconColorPicker, { props: { modelValue: makeEvent() } });

    await wrapper.get('input[type="text"]').setValue('not valid!!');

    expect(wrapper.text()).not.toContain('Use "');
  });

  it('renders the three color fields with their current values', () => {
    const wrapper = mountWithVuetify(IconColorPicker, {
      props: { modelValue: makeEvent({ iconColor: 'red', color: '#abcdef', colorDark: '#123456' }) },
    });

    expect(wrapper.text()).toContain('red');
    expect(wrapper.text()).toContain('#abcdef');
    expect(wrapper.text()).toContain('#123456');
  });
});
```

- [ ] **Step 2: Run and verify; adjust selectors if Vuetify's rendered DOM doesn't match the guesses above**

Run: `cd frontend && yarn test IconColorPicker`
Expected: PASS, 4 tests. The icon-grid button selectors are the most likely to need adjustment once run against real output -- inspect `wrapper.html()` if a selector doesn't match and adjust to the actual rendered structure; keep the assertions (what's being verified) unchanged, only fix how the element is located.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/__tests__/IconColorPicker.vue.spec.ts
git commit -m "test: add IconColorPicker coverage"
```

---

## Task 6: `RequestSong.vue` tests

**Files:**
- Create: `frontend/src/components/__tests__/RequestSong.vue.spec.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/components/__tests__/RequestSong.vue.spec.ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import RequestSong from '@/components/RequestSong.vue';
import { mountWithVuetify } from '@/test-utils';

describe('RequestSong', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('starts collapsed and expands the song field on header click', async () => {
    const wrapper = mountWithVuetify(RequestSong);

    expect(wrapper.get('[role="button"]').attributes('aria-expanded')).toBe('false');
    await wrapper.get('[role="button"]').trigger('click');

    expect(wrapper.get('[role="button"]').attributes('aria-expanded')).toBe('true');
  });

  it('does not open Spotify when the song field is empty', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const wrapper = mountWithVuetify(RequestSong);
    await wrapper.get('[role="button"]').trigger('click');

    await wrapper.get('button').trigger('click'); // Search button, disabled while empty -- see next test for the real path
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('opens a URL-encoded Spotify search for the entered song', async () => {
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    const wrapper = mountWithVuetify(RequestSong);
    await wrapper.get('[role="button"]').trigger('click');

    await wrapper.get('input').setValue('Bohemian Rhapsody & Friends');
    await wrapper.get('input').trigger('keyup.enter');

    expect(openSpy).toHaveBeenCalledWith(
      'https://open.spotify.com/search/Bohemian%20Rhapsody%20%26%20Friends',
      '_blank',
    );
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `cd frontend && yarn test RequestSong`
Expected: PASS, 3 tests.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/__tests__/RequestSong.vue.spec.ts
git commit -m "test: add RequestSong coverage"
```

---

## Task 7: `AdminKeyGate.vue` tests

**Files:**
- Create: `frontend/src/components/__tests__/AdminKeyGate.vue.spec.ts`

**Interfaces:**
- Consumes: `AdminKeyGate` component, prop `gate: ReturnType<typeof useAdminGate>`. Rather than importing the real `useAdminGate`, build a minimal fake shaped like its return value -- this component only reads `gate.stage.value`/`gate.errorMsg.value` and calls `gate.submitKey()`, so the fake only needs those.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/components/__tests__/AdminKeyGate.vue.spec.ts
import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import AdminKeyGate from '@/components/AdminKeyGate.vue';
import { mountWithVuetify } from '@/test-utils';

function makeGate(overrides: { submitKey?: ReturnType<typeof vi.fn> } = {}) {
  return {
    stage: ref<'auth' | 'need-key' | 'ready'>('auth'),
    errorMsg: ref(''),
    submitKey: overrides.submitKey ?? vi.fn().mockResolvedValue(true),
  } as never;
}

describe('AdminKeyGate', () => {
  it('shows a loading skeleton in the auth stage', () => {
    const wrapper = mountWithVuetify(AdminKeyGate, { props: { gate: makeGate() } });

    expect(wrapper.find('.v-skeleton-loader').exists()).toBe(true);
    expect(wrapper.find('form').exists()).toBe(false);
  });

  it('shows the key-entry form in the need-key stage', () => {
    const gate = makeGate();
    gate.stage.value = 'need-key';
    const wrapper = mountWithVuetify(AdminKeyGate, { props: { gate } });

    expect(wrapper.find('form').exists()).toBe(true);
  });

  it('renders nothing once the gate is ready', () => {
    const gate = makeGate();
    gate.stage.value = 'ready';
    const wrapper = mountWithVuetify(AdminKeyGate, { props: { gate } });

    expect(wrapper.find('.v-skeleton-loader').exists()).toBe(false);
    expect(wrapper.find('form').exists()).toBe(false);
  });

  it('submits the typed key and disables the field while validating', async () => {
    let resolveSubmit!: (value: boolean) => void;
    const submitKey = vi.fn().mockReturnValue(
      new Promise<boolean>((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    const gate = makeGate({ submitKey });
    gate.stage.value = 'need-key';
    const wrapper = mountWithVuetify(AdminKeyGate, { props: { gate } });

    await wrapper.get('input').setValue('my-key');
    await wrapper.get('form').trigger('submit');

    expect(submitKey).toHaveBeenCalledWith('my-key');
    expect(wrapper.get('input').attributes('disabled')).toBeDefined();

    resolveSubmit(true);
    await wrapper.vm.$nextTick();
    await Promise.resolve();
    expect(wrapper.get('input').attributes('disabled')).toBeUndefined();
  });

  it('shows the gate error message in the field', () => {
    const gate = makeGate();
    gate.stage.value = 'need-key';
    gate.errorMsg.value = 'that key is no good';
    const wrapper = mountWithVuetify(AdminKeyGate, { props: { gate } });

    expect(wrapper.text()).toContain('that key is no good');
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `cd frontend && yarn test AdminKeyGate`
Expected: PASS, 5 tests.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/__tests__/AdminKeyGate.vue.spec.ts
git commit -m "test: add AdminKeyGate coverage"
```

---

## Task 8: `AudioStream.vue` tests

**Files:**
- Create: `frontend/src/components/__tests__/AudioStream.vue.spec.ts`

**Interfaces:**
- Consumes: `AudioStream` component, props `{ baseUrl: string; mountPoint: string }`.
- jsdom's `HTMLMediaElement.play()` throws "not implemented" by default -- stub it on the prototype before mounting.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/components/__tests__/AudioStream.vue.spec.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AudioStream from '@/components/AudioStream.vue';
import { mountWithVuetify } from '@/test-utils';

beforeEach(() => {
  // jsdom's HTMLMediaElement has no real media pipeline; play()/pause()
  // throw "not implemented" unless stubbed.
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  HTMLMediaElement.prototype.pause = vi.fn();

  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      json: async () => ({ icestats: { source: { listenurl: 'https://x/stream', listeners: 3, title: 'A Song' } } }),
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('AudioStream', () => {
  it('defaults to https:// when baseUrl has no scheme', async () => {
    const wrapper = mountWithVuetify(AudioStream, { props: { baseUrl: 'radio.example.com', mountPoint: '/stream' } });

    await wrapper.get('[role="button"]').trigger('click'); // play
    const audio = wrapper.get('audio').element as HTMLAudioElement;

    expect(audio.src).toBe('https://radio.example.com/stream');
  });

  it('keeps an existing scheme in baseUrl unchanged', async () => {
    const wrapper = mountWithVuetify(AudioStream, {
      props: { baseUrl: 'http://radio.example.com/', mountPoint: '/stream' },
    });

    await wrapper.get('[role="button"]').trigger('click');
    const audio = wrapper.get('audio').element as HTMLAudioElement;

    expect(audio.src).toBe('http://radio.example.com/stream');
  });

  it('toggles between "Click to start listening!" and "Stop listening" on click', async () => {
    const wrapper = mountWithVuetify(AudioStream, { props: { baseUrl: 'radio.example.com', mountPoint: '/stream' } });

    expect(wrapper.text()).toContain('Click to start listening!');
    await wrapper.get('[role="button"]').trigger('click');
    expect(wrapper.text()).toContain('Stop listening');
    await wrapper.get('[role="button"]').trigger('click');
    expect(wrapper.text()).toContain('Click to start listening!');
  });

  it('shows a friendly error message and stops when the stream errors', async () => {
    const wrapper = mountWithVuetify(AudioStream, { props: { baseUrl: 'radio.example.com', mountPoint: '/stream' } });

    await wrapper.get('[role="button"]').trigger('click');
    await wrapper.get('audio').trigger('error');

    expect(wrapper.text()).toContain('Something went wrong playing the stream');
    expect(wrapper.text()).toContain('Click to start listening!');
  });

  it('fetches and displays currently-playing info while playing', async () => {
    const wrapper = mountWithVuetify(AudioStream, { props: { baseUrl: 'radio.example.com', mountPoint: '/stream' } });

    await wrapper.get('[role="button"]').trigger('click');
    await Promise.resolve();
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('A Song');
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `cd frontend && yarn test AudioStream`
Expected: PASS, 5 tests.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/__tests__/AudioStream.vue.spec.ts
git commit -m "test: add AudioStream coverage"
```

---

## Task 9: `VideoStream.vue` tests

**Files:**
- Create: `frontend/src/components/__tests__/VideoStream.vue.spec.ts`

**Interfaces:**
- Consumes: `VideoStream` component, props `{ src: string; poster?: string }`.
- Mocks the `hls.js` module entirely (no real HLS parsing in a test).

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/components/__tests__/VideoStream.vue.spec.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VideoStream from '@/components/VideoStream.vue';
import { mountWithVuetify } from '@/test-utils';

const { hlsInstances, isSupportedMock } = vi.hoisted(() => ({
  hlsInstances: [] as { on: ReturnType<typeof vi.fn>; loadSource: ReturnType<typeof vi.fn>; attachMedia: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[],
  isSupportedMock: vi.fn().mockReturnValue(true),
}));

vi.mock('hls.js', () => {
  class FakeHls {
    static isSupported = isSupportedMock;
    static Events = { ERROR: 'hlsError' };
    on = vi.fn();
    loadSource = vi.fn();
    attachMedia = vi.fn();
    destroy = vi.fn();
    constructor() {
      hlsInstances.push(this);
    }
  }
  return { default: FakeHls };
});

beforeEach(() => {
  hlsInstances.length = 0;
  isSupportedMock.mockReturnValue(true);
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

describe('VideoStream', () => {
  it('auto-starts and attaches Hls.js on desktop', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    mountWithVuetify(VideoStream, { props: { src: 'https://x/stream.m3u8' } });
    await Promise.resolve();

    expect(hlsInstances).toHaveLength(1);
    expect(hlsInstances[0].loadSource).toHaveBeenCalledWith('https://x/stream.m3u8');
    expect(hlsInstances[0].attachMedia).toHaveBeenCalled();
  });

  it('shows a start button on mobile instead of auto-starting', async () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    const wrapper = mountWithVuetify(VideoStream, { props: { src: 'https://x/stream.m3u8' } });
    await Promise.resolve();

    expect(hlsInstances).toHaveLength(0);
    expect(wrapper.text()).toContain('Start Video Stream');
  });

  it('starts the stream on mobile after clicking the start button', async () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)');
    vi.useFakeTimers();
    const wrapper = mountWithVuetify(VideoStream, { props: { src: 'https://x/stream.m3u8' } });

    await wrapper.get('button').trigger('click');
    await vi.runAllTimersAsync();

    expect(hlsInstances).toHaveLength(1);
    vi.useRealTimers();
  });

  it('shows an error state and a retry button on a fatal Hls.js error', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    const wrapper = mountWithVuetify(VideoStream, { props: { src: 'https://x/stream.m3u8' } });
    await Promise.resolve();

    const [, errorHandler] = hlsInstances[0].on.mock.calls.find(([event]) => event === 'hlsError')!;
    errorHandler(null, { fatal: true });
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Unable to load the video stream');
    expect(hlsInstances[0].destroy).toHaveBeenCalled();
  });

  it('retries by tearing down and re-attaching Hls.js', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    const wrapper = mountWithVuetify(VideoStream, { props: { src: 'https://x/stream.m3u8' } });
    await Promise.resolve();

    const [, errorHandler] = hlsInstances[0].on.mock.calls.find(([event]) => event === 'hlsError')!;
    errorHandler(null, { fatal: true });
    await wrapper.vm.$nextTick();

    await wrapper.get('button').trigger('click'); // "Try again"
    await wrapper.vm.$nextTick();

    expect(hlsInstances).toHaveLength(2);
    expect(wrapper.text()).not.toContain('Unable to load the video stream');
  });

  it('falls back to native src when Hls.js is not supported', async () => {
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
    isSupportedMock.mockReturnValue(true); // not-supported path also needs canPlayType; see note below
    HTMLVideoElement.prototype.canPlayType = vi.fn().mockReturnValue('maybe');
    isSupportedMock.mockReturnValue(false);

    const wrapper = mountWithVuetify(VideoStream, { props: { src: 'https://x/stream.m3u8' } });
    await Promise.resolve();

    expect(hlsInstances).toHaveLength(0);
    expect((wrapper.get('video').element as HTMLVideoElement).src).toBe('https://x/stream.m3u8');
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `cd frontend && yarn test VideoStream`
Expected: PASS, 6 tests.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/__tests__/VideoStream.vue.spec.ts
git commit -m "test: add VideoStream coverage"
```

---

## Task 10: `RadioChat.vue` tests

**Files:**
- Create: `frontend/src/components/__tests__/RadioChat.vue.spec.ts`

**Interfaces:**
- Mocks `@/composables/useChatSocket` and `@/composables/useGewisAuth` entirely (both already have their own dedicated coverage -- Tasks 2 and the existing `useGewisAuth.spec.ts`). This test is only about `RadioChat.vue`'s own wiring: does it call `connect`/`disconnect` at the right times, render incoming messages, and guard `sendMessage` correctly.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/components/__tests__/RadioChat.vue.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import RadioChat from '@/components/RadioChat.vue';
import { mountWithVuetify } from '@/test-utils';

const { connectMock, disconnectMock, sendMock, isClosedRef, onMessageHolder } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  disconnectMock: vi.fn(),
  sendMock: vi.fn().mockReturnValue(true),
  isClosedRef: { value: false },
  onMessageHolder: { current: null as ((msg: unknown) => void) | null },
}));

vi.mock('@/composables/useChatSocket', () => ({
  useChatSocket: (options: { onMessage: (msg: unknown) => void }) => {
    onMessageHolder.current = options.onMessage;
    return { isClosed: isClosedRef, connecting: ref(false), connect: connectMock, disconnect: disconnectMock, send: sendMock };
  },
}));
vi.mock('@/composables/useGewisAuth', () => ({
  useGewisAuth: () => ({ getToken: () => 'tok' }),
}));

describe('RadioChat', () => {
  beforeEach(() => {
    connectMock.mockClear();
    disconnectMock.mockClear();
    sendMock.mockClear().mockReturnValue(true);
    isClosedRef.value = false;
  });

  it('connects on mount', () => {
    mountWithVuetify(RadioChat);
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('disconnects on unmount', () => {
    const wrapper = mountWithVuetify(RadioChat);
    wrapper.unmount();
    expect(disconnectMock).toHaveBeenCalledTimes(1);
  });

  it('renders an incoming message from the radio', async () => {
    mountWithVuetify(RadioChat);
    onMessageHolder.current!({ content: 'welcome!' });
    await Promise.resolve();

    expect(document.body.textContent).toContain('welcome!');
  });

  it('sends a typed message, echoes it locally, and clears the input', async () => {
    const wrapper = mountWithVuetify(RadioChat);

    await wrapper.get('input').setValue('hello there');
    await wrapper.get('input').trigger('keydown.enter');

    expect(sendMock).toHaveBeenCalledWith({ content: 'hello there' });
    expect(wrapper.text()).toContain('hello there');
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('');
  });

  it('does not send an empty or whitespace-only message', async () => {
    const wrapper = mountWithVuetify(RadioChat);

    await wrapper.get('input').setValue('   ');
    await wrapper.get('input').trigger('keydown.enter');

    expect(sendMock).not.toHaveBeenCalled();
  });

  it('shows the reconnect prompt when the socket is closed', () => {
    isClosedRef.value = true;
    const wrapper = mountWithVuetify(RadioChat);

    expect(wrapper.text()).toContain('did you log in in another tab?');
    expect(wrapper.get('input').attributes('disabled')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `cd frontend && yarn test RadioChat`
Expected: PASS, 6 tests.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/__tests__/RadioChat.vue.spec.ts
git commit -m "test: add RadioChat coverage"
```

---

## Task 11: `AdminChat.vue` tests

**Files:**
- Create: `frontend/src/components/__tests__/AdminChat.vue.spec.ts`

**Interfaces:**
- Same mocking approach as Task 10, but exercises the richer per-user logic: `touchUser`, unread counting, `selectUser`, sorting by `lastActivity`.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/components/__tests__/AdminChat.vue.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';
import AdminChat from '@/components/AdminChat.vue';
import { mountWithVuetify } from '@/test-utils';

const { connectMock, disconnectMock, sendMock, isClosedRef, onMessageHolder } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  disconnectMock: vi.fn(),
  sendMock: vi.fn().mockReturnValue(true),
  isClosedRef: { value: false },
  onMessageHolder: { current: null as ((msg: unknown) => void) | null },
}));

vi.mock('@/composables/useChatSocket', () => ({
  useChatSocket: (options: { onMessage: (msg: unknown) => void }) => {
    onMessageHolder.current = options.onMessage;
    return { isClosed: isClosedRef, connecting: ref(false), connect: connectMock, disconnect: disconnectMock, send: sendMock };
  },
}));
vi.mock('@/composables/useGewisAuth', () => ({
  useGewisAuth: () => ({ getToken: () => 'tok' }),
}));

describe('AdminChat', () => {
  beforeEach(() => {
    connectMock.mockClear();
    disconnectMock.mockClear();
    sendMock.mockClear().mockReturnValue(true);
    isClosedRef.value = false;
  });

  it('adds a new user to the list from an incoming message and shows an unread badge', async () => {
    const wrapper = mountWithVuetify(AdminChat, { props: { radioKey: 'key' } });

    onMessageHolder.current!({ from: 'u1', content: 'hi', given_name: 'Ada', family_name: 'Lovelace' });
    await wrapper.vm.$nextTick();

    expect(wrapper.text()).toContain('Ada Lovelace (mu1)');
    expect(wrapper.find('.v-badge__badge').exists()).toBe(true);
  });

  it('clears the unread badge once that user is selected', async () => {
    const wrapper = mountWithVuetify(AdminChat, { props: { radioKey: 'key' } });
    onMessageHolder.current!({ from: 'u1', content: 'hi', given_name: 'Ada', family_name: 'Lovelace' });
    await wrapper.vm.$nextTick();

    await wrapper.get('.v-list-item').trigger('click');

    expect(wrapper.find('.v-badge__badge').exists()).toBe(false);
    expect(wrapper.text()).toContain('Chat with:');
    expect(wrapper.text()).toContain('Ada Lovelace (u1)');
  });

  it('renders that user\'s message history once selected', async () => {
    const wrapper = mountWithVuetify(AdminChat, { props: { radioKey: 'key' } });
    onMessageHolder.current!({ from: 'u1', content: 'first message', given_name: 'Ada', family_name: 'Lovelace' });
    await wrapper.vm.$nextTick();
    await wrapper.get('.v-list-item').trigger('click');

    expect(wrapper.text()).toContain('first message');
  });

  it('sends a reply addressed to the selected user and echoes it under "Radio"', async () => {
    const wrapper = mountWithVuetify(AdminChat, { props: { radioKey: 'key' } });
    onMessageHolder.current!({ from: 'u1', content: 'hi', given_name: 'Ada', family_name: 'Lovelace' });
    await wrapper.vm.$nextTick();
    await wrapper.get('.v-list-item').trigger('click');

    await wrapper.get('input').setValue('reply text');
    await wrapper.get('input').trigger('keydown.enter');

    expect(sendMock).toHaveBeenCalledWith({ to: 'u1', content: 'reply text' });
    expect(wrapper.text()).toContain('reply text');
  });

  it('does not send when no user is selected', async () => {
    const wrapper = mountWithVuetify(AdminChat, { props: { radioKey: 'key' } });

    await wrapper.get('input').setValue('nobody to send to');
    await wrapper.get('input').trigger('keydown.enter');

    expect(sendMock).not.toHaveBeenCalled();
  });

  it('routes a message with a `to` field (mirrored radio reply) into that thread as "radio", not the sender', async () => {
    const wrapper = mountWithVuetify(AdminChat, { props: { radioKey: 'key' } });
    onMessageHolder.current!({ from: 'u1', content: 'first', given_name: 'Ada', family_name: 'Lovelace' });
    await wrapper.vm.$nextTick();

    onMessageHolder.current!({ from: 'other-admin', to: 'u1', content: 'handled by someone else' });
    await wrapper.vm.$nextTick();
    await wrapper.get('.v-list-item').trigger('click');

    expect(wrapper.text()).toContain('handled by someone else');
  });

  it('sorts users by most recent activity first', async () => {
    const wrapper = mountWithVuetify(AdminChat, { props: { radioKey: 'key' } });
    onMessageHolder.current!({ from: 'u1', content: 'older', given_name: 'Ada', family_name: 'Lovelace' });
    await wrapper.vm.$nextTick();
    onMessageHolder.current!({ from: 'u2', content: 'newer', given_name: 'Bob', family_name: 'Builder' });
    await wrapper.vm.$nextTick();

    const names = wrapper.findAll('.v-list-item-title').map((el) => el.text());
    expect(names[0]).toContain('Bob Builder');
    expect(names[1]).toContain('Ada Lovelace');
  });
});
```

- [ ] **Step 2: Run and verify; the `.v-list-item-title` selector may need adjusting to whatever class Vuetify's `v-list-item` `title` prop actually renders under -- check `wrapper.html()` if it doesn't match**

Run: `cd frontend && yarn test AdminChat`
Expected: PASS, 7 tests.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/__tests__/AdminChat.vue.spec.ts
git commit -m "test: add AdminChat coverage"
```

---

## Task 12: `AgendaEditor.vue` tests

**Files:**
- Create: `frontend/src/components/__tests__/AgendaEditor.vue.spec.ts`

**Interfaces:**
- Consumes: `AgendaEditor` component, prop `{ initial: AgendaEvent[] }`, exposes `{ editor, expandedEvent, setExpandedEvent }`. Does not mock `useAgendaEditor` or `IconColorPicker` -- both already exist and are already tested/covered (Task 5 and the existing composable test); this task is specifically about the card list/expand/collapse/add/delete wiring in `AgendaEditor.vue` itself.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/components/__tests__/AgendaEditor.vue.spec.ts
import type { AgendaEvent } from '@/stores/app';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgendaEditor from '@/components/AgendaEditor.vue';
import { mountWithVuetify } from '@/test-utils';

function makeEvent(title: string, date: string, time = '9:00 - 10:00'): AgendaEvent {
  return { title, subtitle: '', icon: 'mdi-star', iconColor: 'blue', color: '#fff', colorDark: '#000', date, time };
}

describe('AgendaEditor', () => {
  beforeEach(() => {
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders one collapsed card per initial event', () => {
    const wrapper = mountWithVuetify(AgendaEditor, {
      props: { initial: [makeEvent('First', '2026-01-01'), makeEvent('Second', '2026-01-02')] },
    });

    expect(wrapper.text()).toContain('First');
    expect(wrapper.text()).toContain('Second');
    expect(wrapper.findAll('form')).toHaveLength(0); // nothing expanded yet
  });

  it('expands a card to show its edit form on pencil click, and only that one', async () => {
    const wrapper = mountWithVuetify(AgendaEditor, {
      props: { initial: [makeEvent('First', '2026-01-01'), makeEvent('Second', '2026-01-02')] },
    });

    await wrapper.findAll('button[icon="mdi-pencil"], button').find((b) => b.html().includes('mdi-pencil'))?.trigger('click');

    const titleInputs = wrapper.findAll('input').filter((i) => (i.element as HTMLInputElement).value === 'First');
    expect(titleInputs).toHaveLength(1);
  });

  it('adds a new event, expands it immediately, and it validates with just a title', async () => {
    const wrapper = mountWithVuetify(AgendaEditor, { props: { initial: [] } });

    await wrapper.get('button').trigger('click'); // "Add event" is the only button when the list starts empty

    const titleInput = wrapper.get('input');
    expect((titleInput.element as HTMLInputElement).value).toBe('');
    // The new row is expanded (has a Done button) rather than sitting collapsed.
    expect(wrapper.text()).toContain('Done');
  });

  it('sorts and collapses the row on Done', async () => {
    const wrapper = mountWithVuetify(AgendaEditor, {
      props: { initial: [makeEvent('Later', '2026-02-01'), makeEvent('Earlier', '2026-01-01')] },
    });

    const pencilButtons = wrapper.findAll('button').filter((b) => b.html().includes('mdi-pencil'));
    await pencilButtons[0].trigger('click'); // expand "Later"

    await wrapper.findAll('button').find((b) => b.text() === 'Done')?.trigger('click');

    const cardTitles = wrapper.findAll('.v-card-title').map((el) => el.text());
    expect(cardTitles.indexOf('Earlier')).toBeLessThan(cardTitles.indexOf('Later'));
  });

  it('removes an event after confirming, and does nothing if the confirm is declined', async () => {
    const confirmMock = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
    vi.stubGlobal('confirm', confirmMock);
    const wrapper = mountWithVuetify(AgendaEditor, { props: { initial: [makeEvent('Removable', '2026-01-01')] } });

    const deleteBtn = wrapper.findAll('button').find((b) => b.html().includes('mdi-delete'))!;
    await deleteBtn.trigger('click'); // declined
    expect(wrapper.text()).toContain('Removable');

    await deleteBtn.trigger('click'); // confirmed
    expect(wrapper.text()).not.toContain('Removable');
  });
});
```

- [ ] **Step 2: Run and verify; the icon-button selectors (`mdi-pencil`/`mdi-delete`) are the likely adjustment point -- check `wrapper.html()` for the real rendered attribute/class if a `find` comes back empty**

Run: `cd frontend && yarn test AgendaEditor`
Expected: PASS, 5 tests.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/__tests__/AgendaEditor.vue.spec.ts
git commit -m "test: add AgendaEditor coverage"
```

---

## Task 13: `AppFooter.vue`, `Credits.vue`, `PrivacyPolicy.vue` tests

**Files:**
- Create: `frontend/src/components/__tests__/AppFooter.vue.spec.ts`
- Create: `frontend/src/components/__tests__/Credits.vue.spec.ts`
- Create: `frontend/src/components/__tests__/PrivacyPolicy.vue.spec.ts`

**Interfaces:**
- `Credits.vue`/`PrivacyPolicy.vue` have no props/emits -- their one real behavior is markdown-to-sanitized-HTML rendering and dialog open/close. `AppFooter.vue`'s one real behavior is the dark-mode toggle button (already covered at the composable level in Task 4 -- this test only checks the button calls `toggle` and reflects `isDark` in its icon/label, not `useDarkMode`'s internals again).

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/components/__tests__/Credits.vue.spec.ts
import { describe, expect, it } from 'vitest';
import Credits from '@/components/Credits.vue';
import { mountWithVuetify } from '@/test-utils';

describe('Credits', () => {
  it('opens the dialog on button click and closes it on the close button', async () => {
    const wrapper = mountWithVuetify(Credits, { attachTo: document.body });

    await wrapper.get('button').trigger('click');
    expect(document.querySelector('.v-overlay--active')).not.toBeNull();

    await (document.querySelector('button[aria-label="Close"], .v-card-title button') as HTMLElement)?.click();
  });

  it('renders sanitized HTML with no script tags, even though credits.md is trusted content', () => {
    const wrapper = mountWithVuetify(Credits);
    // marked+DOMPurify runs at module-eval time regardless of whether the
    // dialog is open; the sanitizer applying is what this asserts, not
    // that the source markdown happens to contain anything malicious.
    expect(wrapper.html()).not.toContain('<script');
  });
});
```

```ts
// frontend/src/components/__tests__/PrivacyPolicy.vue.spec.ts
import { describe, expect, it } from 'vitest';
import PrivacyPolicy from '@/components/PrivacyPolicy.vue';
import { mountWithVuetify } from '@/test-utils';

describe('PrivacyPolicy', () => {
  it('opens the dialog on button click', async () => {
    const wrapper = mountWithVuetify(PrivacyPolicy, { attachTo: document.body });

    await wrapper.get('button').trigger('click');
    expect(document.querySelector('.v-overlay--active')).not.toBeNull();
  });

  it('renders sanitized HTML with no script tags', () => {
    const wrapper = mountWithVuetify(PrivacyPolicy);
    expect(wrapper.html()).not.toContain('<script');
  });
});
```

```ts
// frontend/src/components/__tests__/AppFooter.vue.spec.ts
import { describe, expect, it, vi } from 'vitest';
import AppFooter from '@/components/AppFooter.vue';
import { mountWithVuetify } from '@/test-utils';

// vi.mock() factories are hoisted above regular top-level statements (see
// useAdminGate.spec.ts for the same pattern) -- toggleMock must be declared
// via vi.hoisted() so it exists by the time the factory below runs.
const { toggleMock } = vi.hoisted(() => ({ toggleMock: vi.fn() }));

vi.mock('@/composables/useDarkMode.ts', () => ({
  useDarkMode: () => ({ isDark: { value: false }, toggle: toggleMock }),
}));

describe('AppFooter', () => {
  it('shows the current year and a link to the repo', () => {
    const wrapper = mountWithVuetify(AppFooter);

    expect(wrapper.text()).toContain(String(new Date().getFullYear()));
    expect(wrapper.get('a[href="https://github.com/GEWIS/intro-radio"]')).toBeTruthy();
  });

  it('calls toggle when the dark-mode button is clicked', async () => {
    const wrapper = mountWithVuetify(AppFooter);

    await wrapper.get('[aria-label="Switch to dark mode"]').trigger('click');

    expect(toggleMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run and verify all three**

Run: `cd frontend && yarn test AppFooter Credits PrivacyPolicy`
Expected: PASS, 6 tests total.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/__tests__/AppFooter.vue.spec.ts frontend/src/components/__tests__/Credits.vue.spec.ts frontend/src/components/__tests__/PrivacyPolicy.vue.spec.ts
git commit -m "test: add AppFooter, Credits, and PrivacyPolicy coverage"
```

---

## Task 14: `UpcomingEvents.vue` tests

**Files:**
- Create: `frontend/src/components/__tests__/UpcomingEvents.vue.spec.ts`

**Interfaces:**
- Reads `agenda` from `@/stores/app` via Pinia -- needs a real (or test) Pinia instance installed, not a mock of the store module, since the component uses `storeToRefs(useAppStore())` directly. Use `createTestingPinia`-free approach: install a real `createPinia()` and call `useAppStore().agenda = [...]` before mounting, matching how `app.spec.ts` already exercises the real store.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/components/__tests__/UpcomingEvents.vue.spec.ts
import type { ComponentMountingOptions } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import UpcomingEvents from '@/components/UpcomingEvents.vue';
import { useAppStore } from '@/stores/app';
import { mountWithVuetify } from '@/test-utils';

function mountWithAgenda(agenda: ReturnType<typeof useAppStore>['agenda'], options: ComponentMountingOptions<typeof UpcomingEvents> = {}) {
  // setActivePinia alone is sufficient: useAppStore() inside the mounted
  // component resolves the active Pinia via getActivePinia(). Installing a
  // *second*, freshly-created Pinia as a global plugin here would make the
  // component pick up an empty store instead of the one just populated
  // above -- do not add `global: { plugins: [createPinia()] }`.
  setActivePinia(createPinia());
  const store = useAppStore();
  store.agenda = agenda;
  return mountWithVuetify(UpcomingEvents, options);
}

describe('UpcomingEvents', () => {
  beforeEach(() => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  it('starts collapsed', () => {
    const wrapper = mountWithAgenda([]);
    expect(wrapper.get('[aria-expanded]').attributes('aria-expanded')).toBe('false');
  });

  it('expands on header click and shows event content', async () => {
    const wrapper = mountWithAgenda([
      { title: 'Opener', subtitle: 'Welcome', icon: 'mdi-star', iconColor: 'blue', color: '#fff', colorDark: '#000', date: '2026-06-01', time: '9:00 - 10:00' },
    ]);

    await wrapper.get('[role="button"]').trigger('click');

    expect(wrapper.get('[aria-expanded]').attributes('aria-expanded')).toBe('true');
    expect(wrapper.text()).toContain('Opener');
    expect(wrapper.text()).toContain('Welcome');
  });

  it('excludes events that have already ended', async () => {
    const wrapper = mountWithAgenda([
      { title: 'Past', subtitle: '', icon: 'mdi-star', iconColor: 'blue', color: '#fff', colorDark: '#000', date: '2025-01-01', time: '9:00 - 10:00' },
      { title: 'Future', subtitle: '', icon: 'mdi-star', iconColor: 'blue', color: '#fff', colorDark: '#000', date: '2027-01-01', time: '9:00 - 10:00' },
    ]);
    await wrapper.get('[role="button"]').trigger('click');

    expect(wrapper.text()).not.toContain('Past');
    expect(wrapper.text()).toContain('Future');
  });

  it('treats an overnight event (end time-of-day before start) as ending the next calendar day', async () => {
    // "Now" is 2026-01-01T00:00:00Z; an event on 2025-12-31 20:00-08:00
    // should still be considered current/upcoming (ends 2026-01-01 08:00),
    // not already-ended.
    const wrapper = mountWithAgenda([
      { title: 'Overnight', subtitle: '', icon: 'mdi-star', iconColor: 'blue', color: '#fff', colorDark: '#000', date: '2025-12-31', time: '20:00 - 08:00' },
    ]);
    await wrapper.get('[role="button"]').trigger('click');

    expect(wrapper.text()).toContain('Overnight');
  });

  it('groups same-day events under one weekday heading', async () => {
    const wrapper = mountWithAgenda([
      { title: 'Morning', subtitle: '', icon: 'mdi-star', iconColor: 'blue', color: '#fff', colorDark: '#000', date: '2026-06-01', time: '9:00 - 10:00' },
      { title: 'Evening', subtitle: '', icon: 'mdi-star', iconColor: 'blue', color: '#fff', colorDark: '#000', date: '2026-06-01', time: '18:00 - 19:00' },
    ]);
    await wrapper.get('[role="button"]').trigger('click');

    expect(wrapper.findAll('.text-caption.font-weight-bold')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `cd frontend && yarn test UpcomingEvents`
Expected: PASS, 5 tests.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/__tests__/UpcomingEvents.vue.spec.ts
git commit -m "test: add UpcomingEvents coverage"
```

---

## Task 15: `Landing.vue` tests

**Files:**
- Create: `frontend/src/components/__tests__/Landing.vue.spec.ts`

**Interfaces:**
- `Landing.vue` composes `AudioStream`, `VideoStream`, `UpcomingEvents`, `RadioChat`, `RequestSong` -- all already covered individually. Every one of those is stubbed by passing the actual imported component object into `global.stubs` (not stubbing by string name -- `<script setup>` components don't reliably expose a `name` for string-based stubbing/lookup, but Vue Test Utils matches an imported component object for both stubbing and `findComponent` regardless of that). This test is purely about `Landing.vue`'s OWN logic: which children render given `isStarted`/`chatActive`, and the `startChatFlow` gate -- none of AudioStream's real `fetch`, VideoStream's real Hls.js, or RadioChat's real WebSocket connect should ever run here.

- [ ] **Step 1: Write the failing tests**

```ts
// frontend/src/components/__tests__/Landing.vue.spec.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import AudioStream from '@/components/AudioStream.vue';
import Landing from '@/components/Landing.vue';
import RadioChat from '@/components/RadioChat.vue';
import RequestSong from '@/components/RequestSong.vue';
import UpcomingEvents from '@/components/UpcomingEvents.vue';
import VideoStream from '@/components/VideoStream.vue';
import { useAppStore } from '@/stores/app';
import { mountWithVuetify } from '@/test-utils';

const { ensureTokenMock, getTokenMock } = vi.hoisted(() => ({
  ensureTokenMock: vi.fn(),
  getTokenMock: vi.fn(),
}));
vi.mock('@/composables/useGewisAuth.ts', () => ({
  useGewisAuth: () => ({ ensureToken: ensureTokenMock, getToken: getTokenMock }),
}));

const CHILD_STUBS = { AudioStream, VideoStream, UpcomingEvents, RadioChat, RequestSong };

function mountLanding(startTime: Date) {
  setActivePinia(createPinia());
  const store = useAppStore();
  store.radio.startTime = startTime;
  return mountWithVuetify(Landing, { global: { stubs: CHILD_STUBS } });
}

describe('Landing', () => {
  beforeEach(() => {
    ensureTokenMock.mockReset();
    getTokenMock.mockReset().mockReturnValue(null);
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });

  it('shows the countdown card, not the audio stream, before start time', () => {
    const wrapper = mountLanding(new Date('2026-06-01T00:00:00Z'));

    expect(wrapper.text()).toContain('Going live in:');
    expect(wrapper.findComponent(AudioStream).exists()).toBe(false);
  });

  it('shows the audio and video streams once started', () => {
    const wrapper = mountLanding(new Date('2025-01-01T00:00:00Z'));

    expect(wrapper.findComponent(AudioStream).exists()).toBe(true);
    expect(wrapper.findComponent(VideoStream).exists()).toBe(true);
  });

  it('shows a chat prompt (not RadioChat) when there is no token yet', () => {
    getTokenMock.mockReturnValue(null);
    const wrapper = mountLanding(new Date('2025-01-01T00:00:00Z'));

    expect(wrapper.findComponent(RadioChat).exists()).toBe(false);
    expect(wrapper.text()).toContain('Start a chat with the radio');
  });

  it('shows RadioChat immediately when a token already exists on mount', () => {
    getTokenMock.mockReturnValue('existing-token');
    const wrapper = mountLanding(new Date('2025-01-01T00:00:00Z'));

    expect(wrapper.findComponent(RadioChat).exists()).toBe(true);
  });

  it('starts the chat flow (and shows RadioChat) once ensureToken resolves a token from the prompt', async () => {
    getTokenMock.mockReturnValue(null);
    ensureTokenMock.mockResolvedValue('fresh-token');
    const wrapper = mountLanding(new Date('2025-01-01T00:00:00Z'));

    await wrapper.get('[role="button"]').trigger('click'); // the "Start a chat" prompt card
    await Promise.resolve();
    await wrapper.vm.$nextTick();

    expect(wrapper.findComponent(RadioChat).exists()).toBe(true);
  });

  it('does not start the chat flow if ensureToken resolves nothing (e.g. auth redirect in progress)', async () => {
    getTokenMock.mockReturnValue(null);
    ensureTokenMock.mockResolvedValue(null);
    const wrapper = mountLanding(new Date('2025-01-01T00:00:00Z'));

    await wrapper.get('[role="button"]').trigger('click');
    await Promise.resolve();

    expect(wrapper.findComponent(RadioChat).exists()).toBe(false);
  });
});
```

- [ ] **Step 2: Run and verify**

Run: `cd frontend && yarn test Landing`
Expected: PASS, 6 tests.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/__tests__/Landing.vue.spec.ts
git commit -m "test: add Landing coverage"
```

---

## Task 16: Final verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite exactly as CI does**

Run: `cd frontend && yarn lint && yarn type-check && yarn build && yarn test`
Expected: all four pass. Note the final test count and file count for the PR description.

- [ ] **Step 2: Confirm no test file is accidentally asserting nothing meaningful**

Read through every new spec file once more and confirm each `it()` block has at least one assertion that would actually fail if the corresponding source behavior were broken (not just "doesn't throw"). This is the self-check called for before opening the PR -- do it now, before Task 17.

- [ ] **Step 3: Commit any fixes from Step 2**

```bash
git add -A
git commit -m "test: tighten assertions found during final review"
```

(Skip this commit if Step 2 found nothing to fix.)

---

## Task 17: Open the PR

**Files:** none

- [ ] **Step 1: Push the branch created in Task 1**

```bash
git push -u origin test/frontend-component-coverage
```

- [ ] **Step 2: Open the PR against `main`**

Title must carry a conventional-commit prefix per this repo's `CLAUDE.md` (semantic-release parses the PR title as the squashed commit header) -- use `test:` since nothing here changes runtime behavior:

```bash
gh pr create --repo GEWIS/intro-radio \
  --title "test: add frontend component and composable coverage" \
  --body "Closes #1. Adds Vitest coverage for every previously-untested composable (useChatSocket, useCountdown, useDarkMode) and Vue component in frontend/src, plus the jsdom + @vue/test-utils infrastructure needed to mount components at all (added in the first commit; nothing else here changes application behavior). Pages are out of scope -- they're thin wrappers around the now-covered components. yarn lint/type-check/build/test all pass locally." \
  --base main
```

- [ ] **Step 3: Enable auto-merge**

```bash
gh pr merge --repo GEWIS/intro-radio --auto --squash
```
