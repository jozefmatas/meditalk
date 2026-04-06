import { useState, useRef, useEffect } from "react";

/**
 * Manages mobile header collapse on scroll — hides title/template/buttons
 * when scrolling down to maximize reading space, reveals on scroll up.
 *
 * Uses a scroll-lock mechanism: after toggling, scroll events are ignored
 * for 300ms to prevent feedback loops caused by the height change shifting
 * scroll position. This makes CSS transitions safe on all platforms.
 *
 * Handles edge cases: iOS rubber-band bounce at bottom of content,
 * content too short to scroll, and auto-expand on tab change.
 */
export function useMobileHeaderCollapse(activeTab: string) {
  const [mobileHeaderHidden, setMobileHeaderHidden] = useState(false);
  const mobileCollapsibleRef = useRef<HTMLDivElement>(null);
  const anchorY = useRef(0);
  const isHidden = useRef(false);
  const scrollLocked = useRef(false);
  const [prevActiveTab, setPrevActiveTab] = useState(activeTab);

  // Auto-expand header when switching tabs — the new tab's content may be too
  // short to scroll, so the scroll-based reveal would never fire.
  if (prevActiveTab !== activeTab) {
    setPrevActiveTab(activeTab);
    if (mobileHeaderHidden) {
      setMobileHeaderHidden(false);
    }
  }

  // Keep scroll-handler ref in sync with state changes
  useEffect(() => {
    isHidden.current = mobileHeaderHidden;
  }, [mobileHeaderHidden]);

  useEffect(() => {
    const scrollParent = mobileCollapsibleRef.current?.closest(
      "[style*='overflow'], .overflow-y-auto, .overflow-auto",
    ) as HTMLElement | null;
    const target = scrollParent || window;

    const getScrollY = () =>
      scrollParent ? scrollParent.scrollTop : window.scrollY;

    anchorY.current = getScrollY();

    /**
     * Lock scroll handling for a duration after toggling collapse state.
     * The height change shifts scrollTop, which the handler would
     * misinterpret as user scroll — causing an infinite toggle loop.
     */
    const lockScroll = () => {
      scrollLocked.current = true;
      setTimeout(() => {
        scrollLocked.current = false;
        anchorY.current = getScrollY();
      }, 300);
    };

    const handleScroll = () => {
      if (scrollLocked.current) return;

      const currentY = getScrollY();
      const delta = currentY - anchorY.current;

      if (!isHidden.current && delta > 40 && currentY > 80) {
        // Don't collapse if the content barely overflows — collapsing the header
        // would remove the overflow entirely, leaving no way to scroll back up.
        const el = scrollParent || document.documentElement;
        const collapsibleH = mobileCollapsibleRef.current?.scrollHeight ?? 0;
        const scrollableOverflow = el.scrollHeight - el.clientHeight;
        if (scrollableOverflow < collapsibleH * 2) {
          anchorY.current = currentY;
          return;
        }

        isHidden.current = true;
        setMobileHeaderHidden(true);
        lockScroll();
      } else if (isHidden.current && (delta < -30 || currentY < 40)) {
        // Ignore overscroll bounce at the bottom — on iOS the scroll position
        // briefly decreases when content rubber-bands.
        if (delta < -30 && currentY > 40) {
          const el = scrollParent || document.documentElement;
          const atBottom = el.scrollHeight - el.clientHeight - currentY < 30;
          if (atBottom) {
            anchorY.current = currentY;
            return;
          }
        }

        isHidden.current = false;
        setMobileHeaderHidden(false);
        lockScroll();
      }

      // Move anchor when continuing same direction
      if (isHidden.current && delta > 0) anchorY.current = currentY;
      if (!isHidden.current && delta < 0) anchorY.current = currentY;
    };

    target.addEventListener("scroll", handleScroll, { passive: true });
    return () => target.removeEventListener("scroll", handleScroll);
  }, []);

  return {
    mobileHeaderHidden,
    setMobileHeaderHidden,
    mobileCollapsibleRef,
  };
}
