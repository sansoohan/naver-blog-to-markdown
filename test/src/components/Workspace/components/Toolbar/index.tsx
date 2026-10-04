import type { Ref } from "react";
import type { PostInfo } from "~/types/post";
import SearchBox from "./components/SearchBox";

type ToolbarProps = {
  posts: PostInfo[];
  currentPost?: PostInfo;
  currentIndex: number;
  categories: string[];
  categoryPosts: PostInfo[];
  searchInputRef: Ref<HTMLInputElement>;
  categorySelectRef: Ref<HTMLSelectElement>;
  onPrevious: () => void;
  onNext: () => void;
  onSelectCategory: (category: string) => void;
  onSelectPost: (postId: string) => void;
  onRefresh: () => void;
  onSettings: () => void;
};

function Toolbar({
  posts,
  currentPost,
  currentIndex,
  categories,
  categoryPosts,
  searchInputRef,
  categorySelectRef,
  onPrevious,
  onNext,
  onSelectCategory,
  onSelectPost,
  onRefresh,
  onSettings,
}: ToolbarProps) {
  return (
    <header className="toolbar d-flex align-items-center gap-3 flex-shrink-0 px-3 py-2 border-bottom bg-body">
      <SearchBox
        ref={searchInputRef}
        posts={posts}
        onSelectPost={onSelectPost}
      />

      <div className="d-flex align-items-center gap-1 flex-shrink-0">
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm icon-button d-inline-flex align-items-center justify-content-center"
          onClick={onPrevious}
          disabled={currentIndex <= 0}
          title="이전 게시글 (Ctrl + ←)"
          aria-label="이전 게시글"
        >
          <i className="bi bi-chevron-left"></i>
        </button>

        <span className="post-counter text-center small text-secondary">
          {posts.length > 0 && currentIndex >= 0
            ? `${currentIndex + 1} / ${posts.length}`
            : `0 / ${posts.length}`}
        </span>

        <button
          type="button"
          className="btn btn-outline-secondary btn-sm icon-button d-inline-flex align-items-center justify-content-center"
          onClick={onNext}
          disabled={currentIndex < 0 || currentIndex >= posts.length - 1}
          title="다음 게시글 (Ctrl + →)"
          aria-label="다음 게시글"
        >
          <i className="bi bi-chevron-right"></i>
        </button>
      </div>

      <select
        ref={categorySelectRef}
        className="category-select form-select form-select-sm"
        value={currentPost?.category ?? ""}
        onChange={event => onSelectCategory(event.target.value)}
        aria-label="카테고리 선택"
        title="카테고리 선택 (Ctrl + J)"
      >
        {!currentPost && (
          <option value="">카테고리 선택</option>
        )}

        {categories.map(category => (
          <option key={category} value={category}>
            {category || "(카테고리 없음)"}
          </option>
        ))}
      </select>

      <select
        className="form-select form-select-sm min-width-0"
        value={currentPost?.postId ?? ""}
        onChange={event => onSelectPost(event.target.value)}
        aria-label="게시글 선택"
      >
        {categoryPosts.map(post => (
          <option key={post.postId} value={post.postId}>
            {post.title || post.folderName}
          </option>
        ))}
      </select>

      <div className="d-flex align-items-center gap-1 ms-auto flex-shrink-0">
        <button
          type="button"
          className="btn btn-outline-secondary btn-sm icon-button d-inline-flex align-items-center justify-content-center"
          onClick={onRefresh}
          title="새로고침"
          aria-label="새로고침"
        >
          <i className="bi bi-arrow-clockwise"></i>
        </button>

        <button
          type="button"
          className="btn btn-outline-secondary btn-sm icon-button d-inline-flex align-items-center justify-content-center"
          onClick={onSettings}
          title="설정 (Ctrl + ,)"
          aria-label="설정"
        >
          <i className="bi bi-gear"></i>
        </button>
      </div>
    </header>
  );
}

export default Toolbar;