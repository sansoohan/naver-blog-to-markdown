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
  onSelectCategory: (category: string) => void;
  onSelectPost: (id: string) => void;
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
    <header className="toolbar align-items-center gap-3 flex-shrink-0 px-3 py-2 border-bottom">
      <div className="d-flex align-items-center gap-2">
        <button className="btn btn-outline-secondary btn-sm" onClick={onPrevious} disabled={currentIndex <= 0}>
          ← 이전
        </button>

        <span className="text-center text-nowrap small" style={{ minWidth: 70 }}>
          {currentPost ? `${currentIndex + 1} / ${posts.length}` : `0 / ${posts.length}`}
        </span>

        <button
          className="btn btn-outline-secondary btn-sm"
          onClick={onNext}
          disabled={currentIndex < 0 || currentIndex === posts.length - 1}
        >
          다음 →
        </button>
      </div>

      <div className="post-selector gap-2">
        <select
          className="form-select form-select-sm category-select"
          value={currentPost?.category ?? ""}
          onChange={event => onSelectCategory(event.target.value)}
          disabled={posts.length === 0}
          aria-label="카테고리"
        >
          {!currentPost && <option value="">카테고리 선택</option>}

          {categories.map(category => (
            <option key={category} value={category}>
              {category || "(카테고리 없음)"}
            </option>
          ))}
        </select>

        <select
          className="form-select form-select-sm post-select"
          value={currentPost?.id ?? ""}
          onChange={event => onSelectPost(event.target.value)}
          disabled={posts.length === 0}
          aria-label="게시글"
        >
          {!currentPost && <option value="">게시글 선택</option>}

          {categoryPosts.map(post => (
            <option key={post.id} value={post.id}>
              {post.folderName}
            </option>
          ))}
        </select>
      </div>

      <div className="toolbar-actions d-flex align-items-center gap-2">
        <SearchBox />

        <button className="btn btn-outline-secondary btn-sm" onClick={onRefresh} disabled={!currentPost}>
          새로고침
        </button>
      </div>
    </header>
  );
}

export default Toolbar;
