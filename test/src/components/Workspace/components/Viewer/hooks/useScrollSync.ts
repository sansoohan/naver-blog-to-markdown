import { useEffect, useRef, type RefObject } from "react";

type UseScrollSyncOptions = {
  enabled: boolean;
  originalFrameRef: RefObject<HTMLIFrameElement | null>;
  markdownFrameRef: RefObject<HTMLIFrameElement | null>;
  originalLoaded: boolean;
  markdownLoaded: boolean;
  postId?: string;
  refreshKey: number;
};

export function useScrollSync({
  enabled,
  originalFrameRef,
  markdownFrameRef,
  originalLoaded,
  markdownLoaded,
  postId,
  refreshKey,
}: UseScrollSyncOptions) {
  const syncingScrollRef = useRef(false);

  useEffect(() => {
    if (!enabled || !originalLoaded || !markdownLoaded) return;

    const originalWindow = originalFrameRef.current?.contentWindow;
    const markdownWindow = markdownFrameRef.current?.contentWindow;

    if (!originalWindow || !markdownWindow) return;

    const sync = (source: Window, target: Window) => {
      if (syncingScrollRef.current) return;

      const sourceDocument = source.document.scrollingElement;
      const targetDocument = target.document.scrollingElement;

      if (!sourceDocument || !targetDocument) return;

      const sourceMax = sourceDocument.scrollHeight - source.innerHeight;
      const targetMax = targetDocument.scrollHeight - target.innerHeight;

      if (sourceMax <= 0 || targetMax <= 0) return;

      const ratio = source.scrollY / sourceMax;

      syncingScrollRef.current = true;
      target.scrollTo(target.scrollX, targetMax * ratio);

      requestAnimationFrame(() => {
        syncingScrollRef.current = false;
      });
    };

    const handleOriginalScroll = () => {
      sync(originalWindow, markdownWindow);
    };

    const handleMarkdownScroll = () => {
      sync(markdownWindow, originalWindow);
    };

    originalWindow.addEventListener("scroll", handleOriginalScroll, {passive: true});
    markdownWindow.addEventListener("scroll", handleMarkdownScroll, {passive: true});

    return () => {
      originalWindow.removeEventListener("scroll", handleOriginalScroll);
      markdownWindow.removeEventListener("scroll", handleMarkdownScroll);
    };
  }, [
    enabled,
    originalLoaded,
    markdownLoaded,
    postId,
    refreshKey,
    originalFrameRef,
    markdownFrameRef,
  ]);
}