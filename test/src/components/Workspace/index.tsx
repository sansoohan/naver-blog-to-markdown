import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppSettings } from "../../contexts/AppSettingsContext";
import type { PostInfo } from "../../types/post";
import { getPostRoute } from "../../utils/route";
import SettingsPanel from "./components/SettingsPanel";
import Toolbar from "./components/Toolbar";
import Viewer from "./components/Viewer";
import { useShortcuts } from "./hooks/useShortcuts";

const LAST_VIEWED_POST_KEY = "lastViewedPostId";

type WorkspaceProps = {
  posts: PostInfo[];
  postId?: string;
};

function Workspace({posts, postId}: WorkspaceProps) {
  const navigate = useNavigate();
  const {syncScroll, setSyncScroll} = useAppSettings();

  const [refreshKey, setRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const categorySelectRef = useRef<HTMLSelectElement>(null);
  const saveScrollPositionsRef = useRef<() => void>(() => {});

  const currentIndex = useMemo(() => {
    if (!postId) return -1;
    return posts.findIndex(post => post.id === postId);
  }, [posts, postId]);

  const currentPost = currentIndex >= 0 ? posts[currentIndex] : undefined;

  const categories = useMemo(() => {
    return [...new Set(posts.map(post => post.category))];
  }, [posts]);

  const categoryPosts = useMemo(() => {
    if (!currentPost) return [];
    return posts.filter(post => post.category === currentPost.category);
  }, [posts, currentPost]);

  const goToPost = (post: PostInfo) => {
    saveScrollPositionsRef.current();
    navigate(getPostRoute(post.id));
  };

  const goPrevious = () => {
    if (currentIndex <= 0) return;
    goToPost(posts[currentIndex - 1]);
  };

  const goNext = () => {
    if (currentIndex < 0 || currentIndex >= posts.length - 1) return;
    goToPost(posts[currentIndex + 1]);
  };

  const selectPost = (id: string) => {
    const post = posts.find(post => post.id === id);

    if (post) {
      goToPost(post);
    }
  };

  const selectCategory = (category: string) => {
    const post = posts.find(post => post.category === category);

    if (post) {
      goToPost(post);
    }
  };

  const refresh = () => {
    saveScrollPositionsRef.current();
    setRefreshKey(key => key + 1);
  };

  const openPostFolder = async () => {
    if (!currentPost) return;

    try {
      const response = await fetch("/api/post/open-folder", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          path: currentPost.relativePath,
        }),
      });

      if (!response.ok) {
        throw new Error(`글 폴더 열기 실패: ${response.status}`);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const handleShortcut = useShortcuts({
    posts,
    currentIndex,
    settingsOpen,
    syncScroll,
    searchInputRef,
    categorySelectRef,
    onGoToPost: goToPost,
    onOpenSettings: () => setSettingsOpen(true),
    onCloseSettings: () => setSettingsOpen(false),
    onSetSyncScroll: setSyncScroll,
  });

  useEffect(() => {
    if (!currentPost) return;
    localStorage.setItem(LAST_VIEWED_POST_KEY, currentPost.id);
  }, [currentPost]);

  return (
    <div className="app d-flex flex-column w-100 vh-100 bg-body text-body">
      <Toolbar
        posts={posts}
        currentPost={currentPost}
        currentIndex={currentIndex}
        categories={categories}
        categoryPosts={categoryPosts}
        searchInputRef={searchInputRef}
        categorySelectRef={categorySelectRef}
        onPrevious={goPrevious}
        onNext={goNext}
        onSelectCategory={selectCategory}
        onSelectPost={selectPost}
        onRefresh={refresh}
        onSettings={() => setSettingsOpen(true)}
      />

      <div className="post-title-bar d-flex align-items-center flex-shrink-0 gap-2 px-3 border-bottom bg-body">
        {currentPost ? (
          <>
            {currentPost.category && (
              <span className="badge text-bg-secondary flex-shrink-0">
                {currentPost.category}
              </span>
            )}

            <span className="fw-semibold text-truncate">
              {currentPost.title || currentPost.folderName}
            </span>

            {currentPost.sourceUrl && (
              <a
                href={currentPost.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="btn btn-link btn-sm p-0 text-secondary flex-shrink-0"
                title="원본 글 열기"
                aria-label="원본 글 열기"
              >
                <i className="bi bi-box-arrow-up-right"></i>
              </a>
            )}

            <button
              type="button"
              className="btn btn-link btn-sm p-0 text-secondary flex-shrink-0"
              onClick={openPostFolder}
              title="글 폴더 열기"
              aria-label="글 폴더 열기"
            >
              <i className="bi bi-folder2-open"></i>
            </button>

            {syncScroll && (
              <span className="badge text-bg-primary ms-auto flex-shrink-0">
                <i className="bi bi-link-45deg me-1"></i>
                스크롤 동기화
              </span>
            )}
          </>
        ) : (
          <span className="text-secondary small">선택된 게시글이 없습니다.</span>
        )}
      </div>

      <Viewer
        post={currentPost}
        refreshKey={refreshKey}
        onShortcut={handleShortcut}
        onRegisterSaveScrollPositions={save => {
          saveScrollPositionsRef.current = save;
        }}
      />

      <SettingsPanel show={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default Workspace;