import { useEffect } from "react";
import {
  Navigate,
  useParams,
} from "react-router-dom";
import ViewerPage from "../components/ViewerPage";
import { ROUTE_HOME } from "../constants/routes";
import { usePosts } from "../hooks/usePosts";

const LAST_VIEWED_POST_KEY =
  "lastViewedPostId";

function PostPage() {
  const { postId } = useParams();

  const {
    posts,
    loading,
    error,
  } = usePosts();

  const currentPost = posts.find(
    post => post.id === postId
  );

  useEffect(() => {
    if (
      loading ||
      error ||
      !postId ||
      currentPost
    ) {
      return;
    }

    const saved =
      localStorage.getItem(
        LAST_VIEWED_POST_KEY
      );

    if (saved === postId) {
      localStorage.removeItem(
        LAST_VIEWED_POST_KEY
      );
    }
  }, [
    loading,
    error,
    postId,
    currentPost,
  ]);

  if (loading) {
    return (
      <div className="app">
        <div className="status-message">
          게시글 목록을 불러오는 중...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="app">
        <div className="status-message error-message">
          {error}
        </div>
      </div>
    );
  }

  if (!postId || !currentPost) {
    return (
      <Navigate
        to={ROUTE_HOME}
        replace
      />
    );
  }

  return (
    <ViewerPage
      posts={posts}
      postId={postId}
    />
  );
}

export default PostPage;
