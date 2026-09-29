import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppSettings } from "../contexts/AppSettingsContext";
import type { PostInfo } from "../types/post";
import { getPostRoute } from "../utils/route";
import { applyMarkdownSettings, applyOriginalSettings } from "../utils/settings";
import SettingsPanel from "./SettingsPanel";
import Toolbar from "./Toolbar";

const DEFAULT_MARKDOWN_ZOOM = 90;
const MIN_MARKDOWN_ZOOM = 50;
const MAX_MARKDOWN_ZOOM = 150;
const MARKDOWN_ZOOM_STEP = 5;

const LAST_VIEWED_POST_KEY = "lastViewedPostId";

type ViewerPageProps = {
  posts: PostInfo[];
  postId?: string;
};

function ViewerPage({ posts, postId }: ViewerPageProps) {
  const navigate = useNavigate();
  const { removeParagraphMargins, darkMode, fancyCheckboxes } = useAppSettings();
  const [refreshKey, setRefreshKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [originalLoaded, setOriginalLoaded] = useState(false);
  const [markdownLoaded, setMarkdownLoaded] = useState(false);

  const [markdownZoom, setMarkdownZoom] = useState(() => {
    const saved = Number(localStorage.getItem("markdownZoom"));

    if (Number.isFinite(saved) && saved >= MIN_MARKDOWN_ZOOM && saved <= MAX_MARKDOWN_ZOOM) {
      return saved;
    }

    return DEFAULT_MARKDOWN_ZOOM;
  });

  const originalFrameRef = useRef<HTMLIFrameElement>(null);
  const markdownFrameRef = useRef<HTMLIFrameElement>(null);

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

  useEffect(() => {
    if (!currentPost) return;
    localStorage.setItem(LAST_VIEWED_POST_KEY, currentPost.id);
  }, [currentPost]);

  useEffect(() => {
    setOriginalLoaded(false);
    setMarkdownLoaded(false);
  }, [currentPost?.id, refreshKey]);

  const goToPost = (post: PostInfo) => {
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
    console.log("relativePath:", post.relativePath);
    console.log("encoded:", encodeURIComponent(post.relativePath));

    return `/api/post/markdown?path=${encodeURIComponent(post.relativePath)}&refresh=${refreshKey}`;
  };

  const changeMarkdownZoom = (amount: number) => {
    setMarkdownZoom(current => {
      const next = Math.min(MAX_MARKDOWN_ZOOM, Math.max(MIN_MARKDOWN_ZOOM, current + amount));

      localStorage.setItem("markdownZoom", String(next));
      return next;
    });
  };

  const resetMarkdownZoom = () => {
    setMarkdownZoom(DEFAULT_MARKDOWN_ZOOM);
    localStorage.setItem("markdownZoom", String(DEFAULT_MARKDOWN_ZOOM));
  };

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
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }

      if (event.key === "Escape" && settingsOpen) {
        setSettingsOpen(false);
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();

        if (currentIndex > 0) {
          navigate(getPostRoute(posts[currentIndex - 1].id));
        }
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();

        if (currentIndex >= 0 && currentIndex < posts.length - 1) {
          navigate(getPostRoute(posts[currentIndex + 1].id));
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [posts, currentIndex, navigate, settingsOpen]);

  return (
    <div className="app d-flex flex-column w-100 vh-100 bg-body text-body">
      <Toolbar
        posts={posts}
        currentPost={currentPost}
        currentIndex={currentIndex}
        categories={categories}
        categoryPosts={categoryPosts}
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
          </>
        ) : (
          <span className="text-secondary small">선택된 게시글이 없습니다.</span>
        )}
      </div>

      <main className="compare-view d-flex flex-grow-1 bg-body text-body">
        <section className="viewer d-flex flex-column flex-fill bg-body">
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

        <section className="viewer d-flex flex-column flex-fill border-start bg-body">
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
                className="btn btn-outline-secondary btn-sm icon-button"
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
                className="btn btn-outline-secondary btn-sm icon-button"
                onClick={() => changeMarkdownZoom(MARKDOWN_ZOOM_STEP)}
                disabled={!currentPost || markdownZoom >= MAX_MARKDOWN_ZOOM}
                title="확대"
                aria-label="확대"
              >
                <i className="bi bi-plus-lg"></i>
              </button>

              <button
                type="button"
                className="btn btn-outline-secondary btn-sm icon-button"
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
      </main>

      <SettingsPanel show={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default ViewerPage;