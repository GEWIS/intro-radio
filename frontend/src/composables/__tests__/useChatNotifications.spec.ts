import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatNotifications } from '../useChatNotifications';

class MockNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn<() => Promise<NotificationPermission>>();
  static instances: MockNotification[] = [];

  close = vi.fn();
  title: string;
  options?: NotificationOptions;
  private clickHandlers: Array<() => void> = [];

  constructor(title: string, options?: NotificationOptions) {
    this.title = title;
    this.options = options;
    MockNotification.instances.push(this);
  }

  addEventListener(type: 'click', handler: () => void) {
    this.clickHandlers.push(handler);
  }

  fireClick() {
    for (const handler of this.clickHandlers) handler();
  }
}

describe('useChatNotifications', () => {
  beforeEach(() => {
    MockNotification.permission = 'default';
    MockNotification.requestPermission = vi.fn().mockResolvedValue('granted');
    MockNotification.instances = [];
    vi.stubGlobal('Notification', MockNotification);
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    vi.spyOn(window, 'focus').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requests permission on init when permission has not been decided yet', () => {
    useChatNotifications();

    expect(MockNotification.requestPermission).toHaveBeenCalledOnce();
  });

  it('does not request permission again once granted', () => {
    MockNotification.permission = 'granted';

    useChatNotifications();

    expect(MockNotification.requestPermission).not.toHaveBeenCalled();
  });

  it('does not request permission again once denied', () => {
    MockNotification.permission = 'denied';

    useChatNotifications();

    expect(MockNotification.requestPermission).not.toHaveBeenCalled();
  });

  it('fires a notification when permission is granted and the tab is unfocused', () => {
    MockNotification.permission = 'granted';
    const { notify } = useChatNotifications();

    notify('Radio', 'Hello there');

    expect(MockNotification.instances).toHaveLength(1);
    expect(MockNotification.instances[0].title).toBe('Radio');
    expect(MockNotification.instances[0].options).toEqual({ body: 'Hello there' });
  });

  it('does not fire a notification when the tab is focused', () => {
    MockNotification.permission = 'granted';
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    const { notify } = useChatNotifications();

    notify('Radio', 'Hello there');

    expect(MockNotification.instances).toHaveLength(0);
  });

  it('does not fire a notification when permission was denied', () => {
    MockNotification.permission = 'denied';
    const { notify } = useChatNotifications();

    notify('Radio', 'Hello there');

    expect(MockNotification.instances).toHaveLength(0);
  });

  it('does not throw when the Notification API is unsupported', () => {
    vi.unstubAllGlobals();

    const { notify } = useChatNotifications();

    expect(() => notify('Radio', 'Hello there')).not.toThrow();
  });

  it('focuses the window and closes itself when clicked', () => {
    MockNotification.permission = 'granted';
    const { notify } = useChatNotifications();

    notify('Radio', 'Hello there');
    const [notification] = MockNotification.instances;
    notification.fireClick();

    expect(window.focus).toHaveBeenCalledOnce();
    expect(notification.close).toHaveBeenCalledOnce();
  });
});
