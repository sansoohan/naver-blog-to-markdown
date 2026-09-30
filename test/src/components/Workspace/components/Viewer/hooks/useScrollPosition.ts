import { useEffect, type RefObject } from "react";

type ViewerType = "original" | "markdown";

type ScrollPosition = {
  x: number;
  y: number;
};

type UseScrollPositionProps = {
  postId?: string;
  originalFrameRef: RefObject<HTMLIFrameElement | null>;
  markdownFrameRef: RefObject<HTMLIFrameElement | null>;
};

const getScrollStorageKey = (postId: string, viewer: ViewerType) => {
  return `viewerScroll:${postId}:${viewer}`;
};

const saveScrollPosition = (postId: string, viewer: ViewerType, frame: HTMLIFrameElement | null) => {
  const frameWindow = frame?.contentWindow;

  if (!frameWindow) return;

  const position: ScrollPosition = {
    x: frameWindow.scrollX,
    y: frameWindow.scrollY,
  };

  sessionStorage.setItem(getScrollStorageKey(postId, viewer), JSON.stringify(position));
};

const restoreScrollPosition = (postId: string, viewer: ViewerType, frame: HTMLIFrameElement) => {
  const saved = sessionStorage.getItem(getScrollStorageKey(postId, viewer));

  if (!saved) return;

  try {
    const position = JSON.parse(saved) as ScrollPosition;

    if (typeof position.x !== "number" || typeof position.y !== "number") return;

    frame.contentWindow?.scrollTo(position.x, position.y);
  } catch {
    sessionStorage.removeItem(getScrollStorageKey(postId, viewer));
  }
};

export function useScrollPosition({
  postId,
  originalFrameRef,
  markdownFrameRef,
}: UseScrollPositionProps) {
  const saveCurrentScrollPositions = () => {
    if (!postId) return;

    saveScrollPosition(postId, "original", originalFrameRef.current);
    saveScrollPosition(postId, "markdown", markdownFrameRef.current);
  };

  const restoreOriginalScrollPosition = (frame: HTMLIFrameElement) => {
    if (!postId) return;

    restoreScrollPosition(postId, "original", frame);
  };

  const restoreMarkdownScrollPosition = (frame: HTMLIFrameElement) => {
    if (!postId) return;

    restoreScrollPosition(postId, "markdown", frame);
  };

  useEffect(() => {
    const handlePageHide = () => {
      saveCurrentScrollPositions();
    };

    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [postId]);

  return {
    saveCurrentScrollPositions,
    restoreOriginalScrollPosition,
    restoreMarkdownScrollPosition,
  };
}