import { useCallback, useEffect, type RefObject } from "react";
import type { PostInfo } from "../../../types/post";

type UseShortcutsOptions = {
  posts: PostInfo[];
  currentIndex: number;
  settingsOpen: boolean;
  syncScroll: boolean;
  searchInputRef: RefObject<HTMLInputElement | null>;
  categorySelectRef: RefObject<HTMLSelectElement | null>;
  onGoToPost: (post: PostInfo) => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  onSetSyncScroll: (value: boolean) => void;
};

export function useShortcuts({
  posts,
  currentIndex,
  settingsOpen,
  syncScroll,
  searchInputRef,
  categorySelectRef,
  onGoToPost,
  onOpenSettings,
  onCloseSettings,
  onSetSyncScroll,
}: UseShortcutsOptions) {
  const handleShortcut = useCallback(
    (event: KeyboardEvent) => {
      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "j") {
        event.preventDefault();
        categorySelectRef.current?.focus();
        return;
      }

      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key === ",") {
        event.preventDefault();
        onOpenSettings();
        return;
      }

      if (!event.ctrlKey && event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
        event.preventDefault();
        onSetSyncScroll(!syncScroll);
        return;
      }

      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "ArrowLeft") {
        event.preventDefault();

        if (currentIndex > 0) {
          onGoToPost(posts[currentIndex - 1]);
        }

        return;
      }

      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "ArrowRight") {
        event.preventDefault();

        if (currentIndex >= 0 && currentIndex < posts.length - 1) {
          onGoToPost(posts[currentIndex + 1]);
        }

        return;
      }

      if (event.key === "Escape" && settingsOpen) {
        event.preventDefault();
        onCloseSettings();
      }
    },
    [
      posts,
      currentIndex,
      settingsOpen,
      syncScroll,
      searchInputRef,
      categorySelectRef,
      onGoToPost,
      onOpenSettings,
      onCloseSettings,
      onSetSyncScroll,
    ]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleShortcut);

    return () => {
      window.removeEventListener("keydown", handleShortcut);
    };
  }, [handleShortcut]);

  return handleShortcut;
}