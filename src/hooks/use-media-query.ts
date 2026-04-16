import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  window.addEventListener("resize", callback);
  return () => window.removeEventListener("resize", callback);
}

function createMediaQueryHook(query: string) {
  return function useMediaQueryHook() {
    return useSyncExternalStore(
      subscribe,
      () => window.matchMedia(query).matches,
      () => false, // SSR fallback
    );
  };
}

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useIsMobile = createMediaQueryHook("(max-width: 767px)");
export const useIsTablet = createMediaQueryHook(
  "(min-width: 768px) and (max-width: 1023px)",
);
export const useIsDesktop = createMediaQueryHook("(min-width: 1024px)");
