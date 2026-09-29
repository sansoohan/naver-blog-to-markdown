import { useEffect, useMemo, useRef, useState } from "react";
import type { PostInfo } from "../types/post";

type SearchBoxProps = {
  posts: PostInfo[];
  onSelectPost: (id: string) => void;
};

const MAX_RESULTS = 10;

function SearchBox({ posts, onSelectPost }: SearchBoxProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const value = query.trim().toLowerCase();

    if (!value) return [];

    return posts
      .filter(post => {
        const title = post.folderName.toLowerCase();
        const category = post.category.toLowerCase();

        return title.includes(value) || category.includes(value);
      })
      .slice(0, MAX_RESULTS);
  }, [posts, query]);

  const open = focused && query.trim().length > 0;

  useEffect(() => {
    setSelectedIndex(-1);
  }, [query]);

  useEffect(() => {
    const handleMouseDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setFocused(false);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);

    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
    };
  }, []);

  const selectResult = (post: PostInfo) => {
    setQuery("");
    setSelectedIndex(-1);
    setFocused(false);
    onSelectPost(post.id);
  };

  return (
    <div ref={containerRef} className="search-box position-relative">
      <div className="input-group input-group-sm">
        <span className="input-group-text bg-body">
          <i className="bi bi-search"></i>
        </span>

        <input
          type="search"
          className="form-control"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={event => {
            if (event.key === "ArrowDown") {
              event.preventDefault();

              if (results.length > 0) {
                setSelectedIndex(index => Math.min(index + 1, results.length - 1));
              }

              return;
            }

            if (event.key === "ArrowUp") {
              event.preventDefault();

              if (results.length > 0) {
                setSelectedIndex(index => Math.max(index - 1, 0));
              }

              return;
            }

            if (event.key === "Enter") {
              event.preventDefault();

              const post = results[selectedIndex >= 0 ? selectedIndex : 0];

              if (post) {
                selectResult(post);
              }

              return;
            }

            if (event.key === "Escape") {
              setFocused(false);
            }
          }}
          placeholder="게시글 검색"
          aria-label="게시글 검색"
          autoComplete="off"
        />
      </div>

      {open && (
        <div className="search-dropdown position-absolute start-0 overflow-auto border rounded shadow bg-body">
          {results.length > 0 ? (
            <div className="list-group list-group-flush">
              {results.map((post, index) => (
                <button
                  key={post.id}
                  type="button"
                  className={
                    "list-group-item list-group-item-action d-flex align-items-center " +
                    `justify-content-between gap-3 ${index === selectedIndex ? "active" : ""}`
                  }
                  onMouseEnter={() => setSelectedIndex(index)}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => selectResult(post)}
                >
                  <span className="text-truncate small">{post.folderName}</span>

                  <span
                    className={
                      "search-result-category text-truncate flex-shrink-0 " +
                      `${index === selectedIndex ? "" : "text-secondary"}`
                    }
                  >
                    {post.category || "(카테고리 없음)"}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="px-3 py-3 text-center text-secondary small">
              검색 결과가 없습니다.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default SearchBox;
