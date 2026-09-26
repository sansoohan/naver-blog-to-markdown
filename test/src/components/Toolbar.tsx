import SearchBox from "./SearchBox";
import type { PostInfo } from "../types/post";

type ToolbarProps = {
  posts: PostInfo[];
  currentPost?: PostInfo;
  currentIndex: number;
  categories: string[];
  categoryPosts: PostInfo[];
  onPrevious: () => void;
  onNext: () => void;
  onSelectCategory: (
    category: string
  ) => void;
  onSelectPost: (
    id: string
  ) => void;
  onRefresh: () => void;
};

function Toolbar({
  posts,
  currentPost,
  currentIndex,
  categories,
  categoryPosts,
  onPrevious,
  onNext,
  onSelectCategory,
  onSelectPost,
  onRefresh,
}: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="navigation">
        <button
          className="btn btn-outline-secondary btn-sm"
          onClick={onPrevious}
          disabled={currentIndex <= 0}
        >
          ← 이전
        </button>

        <span className="counter">
          {currentPost
            ? `${currentIndex + 1} / ${posts.length}`
            : `0 / ${posts.length}`}
        </span>

        <button
          className="btn btn-outline-secondary btn-sm"
          onClick={onNext}
          disabled={
            currentIndex < 0 ||
            currentIndex ===
              posts.length - 1
          }
        >
          다음 →
        </button>
      </div>

      <div className="post-selector">
        <select
          className="form-select form-select-sm category-select"
          value={
            currentPost?.category ?? ""
          }
          onChange={event =>
            onSelectCategory(
              event.target.value
            )
          }
          disabled={
            posts.length === 0
          }
          aria-label="카테고리"
        >
          {!currentPost && (
            <option value="">
              카테고리 선택
            </option>
          )}

          {categories.map(category => (
            <option
              key={category}
              value={category}
            >
              {category ||
                "(카테고리 없음)"}
            </option>
          ))}
        </select>

        <select
          className="form-select form-select-sm post-select"
          value={currentPost?.id ?? ""}
          onChange={event =>
            onSelectPost(
              event.target.value
            )
          }
          disabled={
            posts.length === 0
          }
          aria-label="게시글"
        >
          {!currentPost && (
            <option value="">
              게시글 선택
            </option>
          )}

          {categoryPosts.map(post => (
            <option
              key={post.id}
              value={post.id}
            >
              {post.folderName}
            </option>
          ))}
        </select>
      </div>

      <div className="toolbar-actions">
        <SearchBox />

        <button
          className="btn btn-outline-secondary btn-sm"
          onClick={onRefresh}
          disabled={!currentPost}
        >
          새로고침
        </button>
      </div>
    </header>
  );
}

export default Toolbar;
