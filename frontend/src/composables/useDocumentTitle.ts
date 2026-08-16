import { onUnmounted, type Ref, watch } from 'vue';

const DEFAULT_TITLE = 'Intro Radio';
const LIVE_TITLE = '🔴 Live · Intro Radio';

// A tab sitting in the background gives no hint the radio just went live --
// this is a free signal for that, reusing the isLive state Landing already
// tracks rather than a separate poll. nowPlaying is optional and only ever
// narrows the live title further (to the actual track), never overrides the
// not-live case -- a track name arriving/changing while offline (a stale
// value from just before the source dropped) must not resurrect a "live"
// looking title.
export function useDocumentTitle(isLive: Ref<boolean>, nowPlaying?: Ref<string | null>) {
  watch(
    nowPlaying ? [isLive, nowPlaying] : [isLive],
    ([live, track]) => {
      if (!live) {
        document.title = DEFAULT_TITLE;
      } else if (track) {
        document.title = `🔴 ${track} · Intro Radio`;
      } else {
        document.title = LIVE_TITLE;
      }
    },
    { immediate: true },
  );

  onUnmounted(() => {
    document.title = DEFAULT_TITLE;
  });
}
