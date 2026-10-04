import { forwardRef, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { PostInfo } from "~/types/post";

type SearchBoxProps = {
  posts: PostInfo[];
  onSelectPost: (postId: string) => void;
};

const SearchBox = forwardRef<HTMLInputElement, SearchBoxProps>(function SearchBox(
  {posts, onSelectPost},
  forwardedRef
) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [focused, setFocused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const value = query.trim().toLowerCase();

    if (!value) return [];

    return posts
      .filter(post => {
        const title = (post.title || post.folderName).toLowerCase();
        const folderName = post.folderName.toLowerCase();
        const category = post.category.toLowerCase();

        return title.includes(value) || folderName.includes(value) || category.includes(value);
      })
      .slice(0, 10);
  }, [posts, query]);

  const showResults = focused && query.trim().length > 0;

  const highlight = (text: string): ReactNode => {
    const value = query.trim();

    if (!value) return text;

    const lowerText = text.toLowerCase();
    const lowerValue = value.toLowerCase();
    const parts: ReactNode[] = [];

    let start = 0;
    let index = lowerText.indexOf(lowerValue);

    while (index >= 0) {
      if (index > start) {
        parts.push(text.slice(start, index));
      }

      parts.push(
        <mark key={`${index}-${parts.length}`} className="p-0">
          {text.slice(index, index + value.length)}
        </mark>
      );

      start = index + value.length;
      index = lowerText.indexOf(lowerValue, start);
    }

    if (start < text.length) {
      parts.push(text.slice(start));
    }

    return parts;
  };

  const setInputRef = (element: HTMLInputElement | null) => {
    if (typeof forwardedRef === "function") {
      forwardedRef(element);
      return;
    }

    if (forwardedRef) {
      forwardedRef.current = element;
    }
  };

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (selectedIndex < results.length) return;
    setSelectedIndex(Math.max(0, results.length - 1));
  }, [results, selectedIndex]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setFocused(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  const selectResult = (post: PostInfo) => {
    setQuery("");
    onSelectPost(post.postId);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!showResults) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();

      if (results.length > 0) {
        setSelectedIndex(current => Math.min(current + 1, results.length - 1));
      }

      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();

      if (results.length > 0) {
        setSelectedIndex(current => Math.max(current - 1, 0));
      }

      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();

      const post = results[selectedIndex];

      if (post) {
        selectResult(post);
      }

      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      setFocused(false);
      event.currentTarget.blur();
    }
  };

  return (
    <div ref={containerRef} className="search-box position-relative">
      <div className="input-group input-group-sm">
        <span className="input-group-text">
          <i className="bi bi-search"></i>
        </span>

        <input
          ref={setInputRef}
          type="search"
          className="form-control"
          placeholder="검색"
          value={query}
          onChange={event => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          aria-label="게시글 검색"
        />
      </div>

      {showResults && (
        <div className="search-dropdown position-absolute start-0 overflow-auto shadow">
          <div className="list-group">
            {results.length > 0 ? (
              results.map((post, index) => (
                <button
                  key={post.postId}
                  type="button"
                  className={
                    "list-group-item list-group-item-action d-flex align-items-center justify-content-between gap-3 " +
                    (index === selectedIndex ? "active" : "")
                  }
                  onMouseEnter={() => setSelectedIndex(index)}
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => selectResult(post)}
                >
                  <span className="text-truncate">
                    {highlight(post.title || post.folderName)}
                  </span>

                  {post.category && (
                    <span className="search-result-category text-truncate opacity-75 flex-shrink-0">
                      {highlight(post.category)}
                    </span>
                  )}
                </button>
              ))
            ) : (
              <div className="list-group-item text-secondary small">
                검색 결과가 없습니다.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

export default SearchBox;