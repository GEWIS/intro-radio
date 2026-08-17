import { computed } from 'vue';

// Single source of truth for "is this a phone/tablet?". Coarse UA sniffing,
// but it matches the capability split the callers already depend on (native
// HLS on iOS vs. hls.js elsewhere, hardware-only volume on mobile); a window
// width check would instead flip on rotation and resize.
const MOBILE_UA_PATTERN = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

export function useIsMobile() {
  const isMobile = computed(() => MOBILE_UA_PATTERN.test(navigator.userAgent));

  return { isMobile };
}
