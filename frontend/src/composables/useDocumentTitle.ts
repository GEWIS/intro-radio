import { onUnmounted, type Ref, watch } from 'vue';

const DEFAULT_TITLE = 'Intro Radio';
const LIVE_TITLE = '🔴 Live · Intro Radio';

// A tab sitting in the background gives no hint the radio just went live --
// this is a free signal for that, reusing the isLive state Landing already
// tracks rather than a separate poll.
export function useDocumentTitle(isLive: Ref<boolean>) {
  watch(
    isLive,
    (live) => {
      document.title = live ? LIVE_TITLE : DEFAULT_TITLE;
    },
    { immediate: true },
  );

  onUnmounted(() => {
    document.title = DEFAULT_TITLE;
  });
}
