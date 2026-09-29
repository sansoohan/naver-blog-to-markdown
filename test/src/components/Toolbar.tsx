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
  onSettings: () => void;
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
  onSettings,
}: ToolbarProps) {
  return (
    <header className="toolbar d-flex align-items-center gap-3 flex-shrink-0 px-3 py-2 border-bottom bg-body">
      <SearchBox posts={posts} onSelectPost={onSelectPost} />

      <div className="d-flex align-items-center gap-2 flex-shrink-0">
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm icon-button"
          onClick={onPrevious}
          disabled={currentIndex <= 0}
          title="이전 게시글"
          aria-label="이전 게시글"
        >
          <i className="bi bi-chevron-left"></i>
        </button>

        <span className="post-counter text-center text-nowrap small">
          {currentPost ? `${currentIndex + 1} / ${posts.length}` : `0 / ${posts.length}`}
        </span>

        <button
          type="button"
          className="btn btn-outline-secondary btn-sm icon-button"
          onClick={onNext}
          disabled={currentIndex < 0 || currentIndex === posts.length - 1}
          title="다음 게시글"
          aria-label="다음 게시글"
        >
          <i className="bi bi-chevron-right"></i>
        </button>
      </div>

      <div className="d-flex align-items-center gap-2 flex-grow-1 min-width-0">
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
          className="form-select form-select-sm flex-grow-1 min-width-0"
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

      <div className="d-flex align-items-center gap-2 flex-shrink-0">
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm icon-button"
          onClick={onRefresh}
          disabled={!currentPost}
          title="새로고침"
          aria-label="새로고침"
        >
          <i className="bi bi-arrow-clockwise"></i>
        </button>

        <button
          type="button"
          className="btn btn-outline-secondary btn-sm icon-button"
          onClick={onSettings}
          title="설정"
          aria-label="설정"
        >
          <i className="bi bi-gear"></i>
        </button>
      </div>
    </header>
  );
}

export default Toolbar;
