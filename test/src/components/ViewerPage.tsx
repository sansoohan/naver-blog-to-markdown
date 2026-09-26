import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { PostInfo } from "../types/post";
import { getPostRoute } from "../utils/route";
import Toolbar from "./Toolbar";

const DEFAULT_MARKDOWN_ZOOM = 80;
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
  const [refreshKey, setRefreshKey] = useState(0);

  const [markdownZoom, setMarkdownZoom] = useState(() => {
    const saved = Number(localStorage.getItem("markdownZoom"));

    if (Number.isFinite(saved) && saved >= MIN_MARKDOWN_ZOOM && saved <= MAX_MARKDOWN_ZOOM) {
      return saved;
    }

    return DEFAULT_MARKDOWN_ZOOM;
  });

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

  const getOriginalUrl = (post: PostInfo) => {
    return `/api/post/original?path=${encodeURIComponent(post.relativePath)}&refresh=${refreshKey}`;
  };

  const getMarkdownUrl = (post: PostInfo) => {
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
    const document = markdownFrameRef.current?.contentDocument;

    if (!document) return;

    document.documentElement.style.zoom = `${markdownZoom}%`;
  }, [markdownZoom, currentPost?.id, refreshKey]);

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
  }, [posts, currentIndex, navigate]);

  return (
    <div className="app d-flex flex-column w-100 vh-100 bg-white">
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
      />

      <main className="compare-view flex-grow-1">
        <section className="viewer d-flex flex-column">
          <div className="viewer-header d-flex align-items-center justify-content-between flex-shrink-0 px-3 py-2 border-bottom bg-light fw-semibold">
            <span>original.html</span>

            {currentPost && !currentPost.hasHtml && <span className="missing-file text-danger fw-normal">파일 없음</span>}
          </div>

          <div className="viewer-body flex-grow-1 overflow-hidden">
            {!currentPost ? (
              <div className="d-flex align-items-center justify-content-center h-100 text-secondary small">
                선택된 게시글이 없습니다.
              </div>
            ) : currentPost.hasHtml ? (
              <iframe
                key={`${currentPost.id}-html-${refreshKey}`}
                className="viewer-frame bg-white"
                src={getOriginalUrl(currentPost)}
                title="Original HTML"
              />
            ) : (
              <div className="d-flex align-items-center justify-content-center h-100 text-secondary small">
                original.html이 없습니다.
              </div>
            )}
          </div>
        </section>

        <section className="viewer d-flex flex-column border-start">
          <div className="viewer-header d-flex align-items-center justify-content-between flex-shrink-0 px-3 py-2 border-bottom bg-light fw-semibold">
            <span>index.md</span>

            <div className="d-flex align-items-center gap-2 ms-auto">
              <button
                className="btn btn-outline-secondary btn-sm"
                onClick={() => changeMarkdownZoom(-MARKDOWN_ZOOM_STEP)}
                disabled={!currentPost || markdownZoom <= MIN_MARKDOWN_ZOOM}
                title="축소"
              >
                −
              </button>

              <span className="zoom-value text-center">{markdownZoom}%</span>

              <button
                className="btn btn-outline-secondary btn-sm"
                onClick={() => changeMarkdownZoom(MARKDOWN_ZOOM_STEP)}
                disabled={!currentPost || markdownZoom >= MAX_MARKDOWN_ZOOM}
                title="확대"
              >
                +
              </button>

              <button
                className="btn btn-outline-secondary btn-sm"
                onClick={resetMarkdownZoom}
                disabled={!currentPost || markdownZoom === DEFAULT_MARKDOWN_ZOOM}
              >
                초기화
              </button>

              {currentPost && !currentPost.hasMarkdown && (
                <span className="missing-file text-danger fw-normal">파일 없음</span>
              )}
            </div>
          </div>

          <div className="viewer-body flex-grow-1 overflow-hidden">
            {!currentPost ? (
              <div className="d-flex align-items-center justify-content-center h-100 text-secondary small">
                선택된 게시글이 없습니다.
              </div>
            ) : currentPost.hasMarkdown ? (
              <iframe
                ref={markdownFrameRef}
                key={`${currentPost.id}-markdown-${refreshKey}`}
                className="viewer-frame bg-white"
                src={getMarkdownUrl(currentPost)}
                title="Markdown"
                onLoad={event => {
                  const document = event.currentTarget.contentDocument;

                  if (!document) return;

                  document.documentElement.style.zoom = `${markdownZoom}%`;
                }}
              />
            ) : (
              <div className="d-flex align-items-center justify-content-center h-100 text-secondary small">
                index.md가 없습니다.
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default ViewerPage;
