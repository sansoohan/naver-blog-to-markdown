import { useEffect, useMemo, useState } from "react";
import "./App.css";

type PostInfo = {
  id: string;
  category: string;
  folderName: string;
  relativePath: string;
  hasHtml: boolean;
  hasMarkdown: boolean;
};

function App() {
  const [posts, setPosts] = useState<PostInfo[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    fetch("/api/posts")
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<PostInfo[]>;
      })
      .then(data => {
        if (cancelled) return;
        setPosts(data);
      })
      .catch(error => {
        if (cancelled) return;
        console.error(error);
        setError("게시글 목록을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const currentPost = posts[currentIndex];

  const categories = useMemo(() => {
    return [...new Set(posts.map(post => post.category))];
  }, [posts]);

  const categoryPosts = useMemo(() => {
    if (!currentPost) return [];
    return posts.filter(post => post.category === currentPost.category);
  }, [posts, currentPost]);

  const goPrevious = () => {
    setCurrentIndex(index => Math.max(0, index - 1));
  };

  const goNext = () => {
    setCurrentIndex(index => Math.min(posts.length - 1, index + 1));
  };

  const selectPost = (id: string) => {
    const index = posts.findIndex(post => post.id === id);
    if (index !== -1) setCurrentIndex(index);
  };

  const selectCategory = (category: string) => {
    const index = posts.findIndex(post => post.category === category);
    if (index !== -1) setCurrentIndex(index);
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
        goPrevious();
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [posts.length]);

  return (
    <div className="app">
      <header className="toolbar">
        <div className="navigation">
          <button
            className="btn btn-outline-secondary btn-sm"
            onClick={goPrevious}
            disabled={!currentPost || currentIndex === 0}
          >
            ← 이전
          </button>

          <span className="counter">
            {posts.length === 0 ? "0 / 0" : `${currentIndex + 1} / ${posts.length}`}
          </span>

          <button
            className="btn btn-outline-secondary btn-sm"
            onClick={goNext}
            disabled={!currentPost || currentIndex === posts.length - 1}
          >
            다음 →
          </button>
        </div>

        <div className="post-selector">
          <select
            className="form-select form-select-sm category-select"
            value={currentPost?.category ?? ""}
            onChange={event => selectCategory(event.target.value)}
            disabled={!currentPost}
            aria-label="카테고리"
          >
            {categories.map(category => (
              <option key={category} value={category}>
                {category || "(카테고리 없음)"}
              </option>
            ))}
          </select>

          <select
            className="form-select form-select-sm post-select"
            value={currentPost?.id ?? ""}
            onChange={event => selectPost(event.target.value)}
            disabled={!currentPost}
            aria-label="게시글"
          >
            {categoryPosts.map(post => (
              <option key={post.id} value={post.id}>
                {post.folderName}
              </option>
            ))}
          </select>
        </div>

        <button
          className="btn btn-outline-secondary btn-sm"
          onClick={refresh}
          disabled={!currentPost}
        >
          새로고침
        </button>
      </header>

      {loading && <div className="status-message">게시글 목록을 불러오는 중...</div>}
      {!loading && error && <div className="status-message error-message">{error}</div>}
      {!loading && !error && posts.length === 0 && (
        <div className="status-message">게시글이 없습니다.</div>
      )}

      {!loading && !error && currentPost && (
        <main className="compare-view">
          <section className="viewer">
            <div className="viewer-header">
              <span>original.html</span>

              {!currentPost.hasHtml && (
                <span className="missing-file">파일 없음</span>
              )}
            </div>

            <div className="viewer-body">
              {currentPost.hasHtml ? (
                <iframe
                  key={`${currentPost.id}-html-${refreshKey}`}
                  className="viewer-frame"
                  src={getOriginalUrl(currentPost)}
                  title="Original HTML"
                />
              ) : (
                <div className="empty-view">original.html이 없습니다.</div>
              )}
            </div>
          </section>

          <section className="viewer">
            <div className="viewer-header">
              <span>index.md</span>

              {!currentPost.hasMarkdown && (
                <span className="missing-file">파일 없음</span>
              )}
            </div>

            <div className="viewer-body">
              {currentPost.hasMarkdown ? (
                <iframe
                  key={`${currentPost.id}-markdown-${refreshKey}`}
                  className="viewer-frame"
                  src={getMarkdownUrl(currentPost)}
                  title="Markdown"
                />
              ) : (
                <div className="empty-view">index.md가 없습니다.</div>
              )}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}

export default App;
