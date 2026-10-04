import { useEffect, useRef } from "react";
import { Navigate, useParams } from "react-router-dom";
import Workspace from "~/components/Workspace";
import { ROUTE_HOME } from "~/constants/routes";
import { usePosts } from "~/hooks/usePosts";

type PostPageProps = {
  blogIds: string[];
  blogId: string;
  setBlogId: (blogId: string) => void;
  blogsLoading: boolean;
  blogsError: string;
};

function PostPage({
  blogIds,
  blogId,
  setBlogId,
  blogsLoading,
  blogsError,
}: PostPageProps) {
  const {blogId: routeBlogId, postId} = useParams();
  const initializedBlogIdRef = useRef(false);

  const validBlogId = routeBlogId && blogIds.includes(routeBlogId) ? routeBlogId : "";
  const {posts, loading, error} = usePosts(validBlogId);

  const currentPost = posts.find(post => post.postId === postId);

  useEffect(() => {
    if (initializedBlogIdRef.current || !validBlogId) return;

    initializedBlogIdRef.current = true;

    if (validBlogId !== blogId) {
      setBlogId(validBlogId);
    }
  }, [validBlogId, blogId, setBlogId]);

  useEffect(() => {
    if (loading || error || !postId || currentPost || !validBlogId) return;

    const key = `lastViewedPost:${validBlogId}`;
    const saved = localStorage.getItem(key);

    if (saved === postId) {
      localStorage.removeItem(key);
    }
  }, [loading, error, postId, currentPost, validBlogId]);

  if (blogsLoading) {
    return (
      <div className="d-flex flex-column w-100 vh-100 bg-body text-body">
        <div className="d-flex align-items-center justify-content-center flex-grow-1 text-secondary small">
          블로그 목록을 불러오는 중...
        </div>
      </div>
    );
  }

  if (blogsError) {
    return (
      <div className="d-flex flex-column w-100 vh-100 bg-body text-body">
        <div className="d-flex align-items-center justify-content-center flex-grow-1 text-danger small">
          {blogsError}
        </div>
      </div>
    );
  }

  if (!validBlogId || !postId) {
    return <Navigate to={ROUTE_HOME} replace />;
  }

  if (loading) {
    return (
      <div className="d-flex flex-column w-100 vh-100 bg-body text-body">
        <div className="d-flex align-items-center justify-content-center flex-grow-1 text-secondary small">
          게시글 목록을 불러오는 중...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="d-flex flex-column w-100 vh-100 bg-body text-body">
        <div className="d-flex align-items-center justify-content-center flex-grow-1 text-danger small">
          {error}
        </div>
      </div>
    );
  }

  if (!currentPost) {
    return <Navigate to={ROUTE_HOME} replace />;
  }

  return (
    <Workspace
      posts={posts}
      postId={postId}
      blogIds={blogIds}
      blogId={validBlogId}
      setBlogId={setBlogId}
    />
  );
}

export default PostPage;