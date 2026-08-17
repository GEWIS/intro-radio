import { afterEach, describe, expect, it } from 'vitest';
import { useIsMobile } from '../useIsMobile';

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';
const MOBILE_UAS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.6533.120 Mobile Safari/537.36',
];

const originalUserAgent = navigator.userAgent;

afterEach(() => {
  setUserAgent(originalUserAgent);
});

describe('useIsMobile', () => {
  it('reports a desktop UA as not mobile', () => {
    setUserAgent(DESKTOP_UA);

    expect(useIsMobile().isMobile.value).toBe(false);
  });

  it('reports phone and tablet UAs as mobile', () => {
    for (const ua of MOBILE_UAS) {
      setUserAgent(ua);
      // Fresh useIsMobile() per UA: its computed has no reactive deps, so a
      // reused instance would serve the first (cached) answer forever.
      expect(useIsMobile().isMobile.value, ua).toBe(true);
    }
  });
});
