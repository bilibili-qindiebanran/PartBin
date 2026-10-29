import { onBeforeUnmount, onMounted, ref } from 'vue';

/**
 * 断点检测：默认对齐设计稿的移动端断点 767px。
 * @param {string} [query]
 */
export function useBreakpoint(query = '(max-width: 767px)') {
  const matches = ref(false);
  let mediaQuery = null;

  const update = (event) => {
    matches.value = event.matches;
  };

  onMounted(() => {
    mediaQuery = window.matchMedia(query);
    matches.value = mediaQuery.matches;
    mediaQuery.addEventListener('change', update);
  });

  onBeforeUnmount(() => {
    mediaQuery?.removeEventListener('change', update);
  });

  return { isMobile: matches };
}
