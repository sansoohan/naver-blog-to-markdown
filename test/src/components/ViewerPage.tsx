import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppSettings } from "../contexts/AppSettingsContext";
import type { PostInfo } from "../types/post";
import { getPostRoute } from "../utils/route";
import { applyMarkdownSettings, applyOriginalSettings } from "../utils/settings";
import SettingsPanel from "./SettingsPanel";
import Toolbar from "./Toolbar";

const DEFAULT_MARKDOWN_ZOOM = 80;
const MIN_MARKDOWN_ZOOM = 50;
const MAX_MARKDOWN_ZOOM = 150;
const MARKDOWN_ZOOM_STEP = 5;

const DEFAULT_SPLIT_RATIO = 50;
const MIN_SPLIT_RATIO = 20;
const MAX_SPLIT_RATIO = 80;

const LAST_VIEWED_POST_KEY = "lastViewedPostId";
const MARKDOWN_ZOOM_KEY = "markdownZoom";
const SPLIT_RATIO_KEY = "viewerSplitRatio";

type ViewerPageProps = {
  posts: PostInfo[];
  postId?: string;
};

type ScrollPosition = {
  x: number;
  y: number;
};

function ViewerPage({posts, postId}: ViewerPageProps) {
  const navigate = useNavigate();
  const {removeParagraphMargins, darkMode, fancyCheckboxes, syncScroll} = useAppSettings();

  const [refreshKey, setRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [originalLoaded, setOriginalLoaded] = useState(false);
  const [markdownLoaded, setMarkdownLoaded] = useState(false);
  const [draggingSplitter, setDraggingSplitter] = useState(false);

  const [markdownZoom, setMarkdownZoom] = useState(() => {
    const saved = Number(localStorage.getItem(MARKDOWN_ZOOM_KEY));

    if (Number.isFinite(saved) && saved >= MIN_MARKDOWN_ZOOM && saved <= MAX_MARKDOWN_ZOOM) {
      return saved;
    }

    return DEFAULT_MARKDOWN_ZOOM;
  });

  const [splitRatio, setSplitRatio] = useState(() => {
    const saved = Number(localStorage.getItem(SPLIT_RATIO_KEY));

    if (Number.isFinite(saved) && saved >= MIN_SPLIT_RATIO && saved <= MAX_SPLIT_RATIO) {
      return saved;
    }

    return DEFAULT_SPLIT_RATIO;
  });

  const searchInputRef = useRef<HTMLInputElement>(null);
  const categorySelectRef = useRef<HTMLSelectElement>(null);
  const originalFrameRef = useRef<HTMLIFrameElement>(null);
  const markdownFrameRef = useRef<HTMLIFrameElement>(null);
  const compareViewRef = useRef<HTMLElement>(null);
  const splitterRef = useRef<HTMLDivElement>(null);
  const syncingScrollRef = useRef(false);
  const splitRatioRef = useRef(splitRatio);
  const splitterPointerIdRef = useRef<number | null>(null);

  const currentIndex = useMemo(() => {
    if (!postId) return -1;
    return posts.findIndex(post => post.id === postId);
  }, [posts, postId]);

  const currentPost = currentIndex >= 0 ? posts[currentIndex] : undefined;

  const categories = useMemo(() => {
    return [...new Set(posts.map(post => post.category))];
  }, [posts]);

  const categoryPosts = useMemo(() => {
    if (!currentPost) return posts;
    return posts.filter(post => post.category === currentPost.category);
  }, [posts, currentPost]);

  const getScrollStorageKey = (postId: string, viewer: "original" | "markdown") => {
    return `viewerScroll:${postId}:${viewer}`;
  };

  const saveScrollPosition = (
    postId: string,
    viewer: "original" | "markdown",
    frame: HTMLIFrameElement | null
  ) => {
    const frameWindow = frame?.contentWindow;

    if (!frameWindow) return;

    const position: ScrollPosition = {
      x: frameWindow.scrollX,
      y: frameWindow.scrollY,
    };

    sessionStorage.setItem(getScrollStorageKey(postId, viewer), JSON.stringify(position));
  };

  const restoreScrollPosition = (
    postId: string,
    viewer: "original" | "markdown",
    frame: HTMLIFrameElement
  ) => {
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

  const saveCurrentScrollPositions = () => {
    if (!currentPost) return;

    saveScrollPosition(currentPost.id, "original", originalFrameRef.current);
    saveScrollPosition(currentPost.id, "markdown", markdownFrameRef.current);
  };

  const updateSplitRatio = (clientX: number) => {
    const container = compareViewRef.current;

    if (!container) return;

    const bounds = container.getBoundingClientRect();
    const ratio = ((clientX - bounds.left) / bounds.width) * 100;
    const next = Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));

    splitRatioRef.current = next;
    setSplitRatio(next);
  };

  const startSplitterDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    event.preventDefault();

    splitterPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);

    setDraggingSplitter(true);
    updateSplitRatio(event.clientX);
  };

  const moveSplitter = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingSplitter) return;
    if (splitterPointerIdRef.current !== event.pointerId) return;

    event.preventDefault();
    updateSplitRatio(event.clientX);
  };

  const stopSplitterDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (splitterPointerIdRef.current !== event.pointerId) return;

    splitterPointerIdRef.current = null;
    setDraggingSplitter(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    localStorage.setItem(SPLIT_RATIO_KEY, String(splitRatioRef.current));
  };

  const handleLostPointerCapture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (splitterPointerIdRef.current !== event.pointerId) return;

    splitterPointerIdRef.current = null;
    setDraggingSplitter(false);
    localStorage.setItem(SPLIT_RATIO_KEY, String(splitRatioRef.current));
  };

  const goToPost = (post: PostInfo) => {
    saveCurrentScrollPositions();
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
    saveCurrentScrollPositions();
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

  const getOriginalUrl = (post: PostInfo) => {
    return `/api/post/original?path=${encodeURIComponent(post.relativePath)}&refresh=${refreshKey}`;
  };

  const getMarkdownUrl = (post: PostInfo) => {
    return `/api/post/markdown?path=${encodeURIComponent(post.relativePath)}&refresh=${refreshKey}`;
  };

  const changeMarkdownZoom = (amount: number) => {
    setMarkdownZoom(current => {
      const next = Math.min(MAX_MARKDOWN_ZOOM, Math.max(MIN_MARKDOWN_ZOOM, current + amount));

      localStorage.setItem(MARKDOWN_ZOOM_KEY, String(next));
      return next;
    });
  };

  const resetMarkdownZoom = () => {
    setMarkdownZoom(DEFAULT_MARKDOWN_ZOOM);
    localStorage.setItem(MARKDOWN_ZOOM_KEY, String(DEFAULT_MARKDOWN_ZOOM));
  };

  useEffect(() => {
    if (!currentPost) return;
    localStorage.setItem(LAST_VIEWED_POST_KEY, currentPost.id);
  }, [currentPost]);

  useEffect(() => {
    setOriginalLoaded(false);
    setMarkdownLoaded(false);
  }, [currentPost?.id, refreshKey]);

  useEffect(() => {
    const handlePageHide = () => {
      saveCurrentScrollPositions();
    };

    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
    };
  }, [currentPost]);

  useEffect(() => {
    if (!syncScroll || !originalLoaded || !markdownLoaded) return;

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
  }, [syncScroll, originalLoaded, markdownLoaded, currentPost?.id, refreshKey]);

  useEffect(() => {
    const originalDocument = originalFrameRef.current?.contentDocument;
    const markdownDocument = markdownFrameRef.current?.contentDocument;

    if (originalDocument) {
      applyOriginalSettings(originalDocument, darkMode);
    }

    if (markdownDocument) {
      applyMarkdownSettings(markdownDocument, markdownZoom, removeParagraphMargins, darkMode, fancyCheckboxes);
    }
  }, [markdownZoom, removeParagraphMargins, darkMode, fancyCheckboxes, currentPost?.id, refreshKey]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
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
        setSettingsOpen(true);
        return;
      }

      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "ArrowLeft") {
        event.preventDefault();

        if (currentIndex > 0) {
          goToPost(posts[currentIndex - 1]);
        }

        return;
      }

      if (event.ctrlKey && !event.altKey && !event.shiftKey && event.key === "ArrowRight") {
        event.preventDefault();

        if (currentIndex >= 0 && currentIndex < posts.length - 1) {
          goToPost(posts[currentIndex + 1]);
        }

        return;
      }

      if (event.key === "Escape" && settingsOpen) {
        event.preventDefault();
        setSettingsOpen(false);
      }
    };

    const windows: Window[] = [window];
    const originalWindow = originalFrameRef.current?.contentWindow;
    const markdownWindow = markdownFrameRef.current?.contentWindow;

    if (originalWindow) {
      windows.push(originalWindow);
    }

    if (markdownWindow) {
      windows.push(markdownWindow);
    }

    windows.forEach(targetWindow => {
      targetWindow.addEventListener("keydown", handleShortcut);
    });

    return () => {
      windows.forEach(targetWindow => {
        targetWindow.removeEventListener("keydown", handleShortcut);
      });
    };
  }, [originalLoaded, markdownLoaded, posts, currentIndex, currentPost, settingsOpen, refreshKey]);

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

      <main ref={compareViewRef} className="compare-view d-flex flex-grow-1 bg-body text-body position-relative">
        <section
          className="viewer d-flex flex-column bg-body"
          style={{width: `calc(${splitRatio}% - 4px)`}}
        >
          <div
            className={
              "viewer-header d-flex align-items-center justify-content-between flex-shrink-0 " +
              "px-3 border-bottom bg-body-tertiary fw-semibold"
            }
          >
            <span>original.html</span>

            {currentPost && !currentPost.hasHtml && (
              <span className="small text-danger fw-normal">파일 없음</span>
            )}
          </div>

          <div className="viewer-body flex-grow-1 overflow-hidden bg-body position-relative">
            {!currentPost ? (
              <div className="d-flex align-items-center justify-content-center h-100 text-secondary small">
                선택된 게시글이 없습니다.
              </div>
            ) : currentPost.hasHtml ? (
              <>
                {!originalLoaded && (
                  <div
                    className={
                      "position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center " +
                      "justify-content-center text-secondary small"
                    }
                  >
                    페이지 준비 중...
                  </div>
                )}

                <iframe
                  ref={originalFrameRef}
                  key={`${currentPost.id}-html-${refreshKey}`}
                  className={`viewer-frame w-100 h-100 border-0 ${originalLoaded ? "visible" : "invisible"}`}
                  src={getOriginalUrl(currentPost)}
                  title="Original HTML"
                  onLoad={event => {
                    const document = event.currentTarget.contentDocument;

                    if (!document) return;

                    applyOriginalSettings(document, darkMode);
                    restoreScrollPosition(currentPost.id, "original", event.currentTarget);
                    setOriginalLoaded(true);
                  }}
                />
              </>
            ) : (
              <div className="d-flex align-items-center justify-content-center h-100 text-secondary small">
                original.html이 없습니다.
              </div>
            )}
          </div>
        </section>

        <div
          ref={splitterRef}
          className={`viewer-splitter flex-shrink-0 border-start border-end ${draggingSplitter ? "active" : ""}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="뷰어 크기 조절"
          title="드래그하여 뷰어 크기 조절"
          onPointerDown={startSplitterDrag}
          onPointerMove={moveSplitter}
          onPointerUp={stopSplitterDrag}
          onPointerCancel={stopSplitterDrag}
          onLostPointerCapture={handleLostPointerCapture}
          onDoubleClick={() => {
            splitRatioRef.current = DEFAULT_SPLIT_RATIO;
            setSplitRatio(DEFAULT_SPLIT_RATIO);
            localStorage.setItem(SPLIT_RATIO_KEY, String(DEFAULT_SPLIT_RATIO));
          }}
        >
          <div className="viewer-splitter-handle position-absolute top-50 start-50 translate-middle rounded-pill bg-secondary" />
        </div>

        <section
          className="viewer d-flex flex-column bg-body"
          style={{width: `calc(${100 - splitRatio}% - 4px)`}}
        >
          <div
            className={
              "viewer-header d-flex align-items-center justify-content-between flex-shrink-0 " +
              "px-3 border-bottom bg-body-tertiary fw-semibold"
            }
          >
            <span>index.md</span>

            <div className="d-flex align-items-center gap-2 ms-auto">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm icon-button d-inline-flex align-items-center justify-content-center"
                onClick={() => changeMarkdownZoom(-MARKDOWN_ZOOM_STEP)}
                disabled={!currentPost || markdownZoom <= MIN_MARKDOWN_ZOOM}
                title="축소"
                aria-label="축소"
              >
                <i className="bi bi-dash-lg"></i>
              </button>

              <span className="zoom-value text-center small">{markdownZoom}%</span>

              <button
                type="button"
                className="btn btn-outline-secondary btn-sm icon-button d-inline-flex align-items-center justify-content-center"
                onClick={() => changeMarkdownZoom(MARKDOWN_ZOOM_STEP)}
                disabled={!currentPost || markdownZoom >= MAX_MARKDOWN_ZOOM}
                title="확대"
                aria-label="확대"
              >
                <i className="bi bi-plus-lg"></i>
              </button>

              <button
                type="button"
                className="btn btn-outline-secondary btn-sm icon-button d-inline-flex align-items-center justify-content-center"
                onClick={resetMarkdownZoom}
                disabled={!currentPost || markdownZoom === DEFAULT_MARKDOWN_ZOOM}
                title="배율 초기화"
                aria-label="배율 초기화"
              >
                <i className="bi bi-arrow-counterclockwise"></i>
              </button>

              {currentPost && !currentPost.hasMarkdown && (
                <span className="small text-danger fw-normal">파일 없음</span>
              )}
            </div>
          </div>

          <div className="viewer-body flex-grow-1 overflow-hidden bg-body position-relative">
            {!currentPost ? (
              <div className="d-flex align-items-center justify-content-center h-100 text-secondary small">
                선택된 게시글이 없습니다.
              </div>
            ) : currentPost.hasMarkdown ? (
              <>
                {!markdownLoaded && (
                  <div
                    className={
                      "position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center " +
                      "justify-content-center text-secondary small"
                    }
                  >
                    페이지 준비 중...
                  </div>
                )}

                <iframe
                  ref={markdownFrameRef}
                  key={`${currentPost.id}-markdown-${refreshKey}`}
                  className={`viewer-frame w-100 h-100 border-0 ${markdownLoaded ? "visible" : "invisible"}`}
                  src={getMarkdownUrl(currentPost)}
                  title="Markdown"
                  onLoad={event => {
                    const document = event.currentTarget.contentDocument;

                    if (!document) return;

                    applyMarkdownSettings(
                      document,
                      markdownZoom,
                      removeParagraphMargins,
                      darkMode,
                      fancyCheckboxes
                    );

                    restoreScrollPosition(currentPost.id, "markdown", event.currentTarget);
                    setMarkdownLoaded(true);
                  }}
                />
              </>
            ) : (
              <div className="d-flex align-items-center justify-content-center h-100 text-secondary small">
                index.md가 없습니다.
              </div>
            )}
          </div>
        </section>

        {draggingSplitter && (
          <div className="splitter-drag-overlay position-absolute top-0 start-0 w-100 h-100" />
        )}
      </main>

      <SettingsPanel show={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default ViewerPage;