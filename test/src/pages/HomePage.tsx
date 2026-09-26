import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import ViewerPage from "../components/ViewerPage";
import { usePosts } from "../hooks/usePosts";
import { getPostRoute } from "../utils/route";

const LAST_VIEWED_POST_KEY =
  "lastViewedPostId";

function HomePage() {
  const navigate = useNavigate();

  const {
    posts,
    loading,
    error,
  } = usePosts();

  useEffect(() => {
    if (loading || error) return;

    const lastViewedPostId =
      localStorage.getItem(
        LAST_VIEWED_POST_KEY
      );

    if (!lastViewedPostId) return;

    const exists = posts.some(
      post =>
        post.id ===
        lastViewedPostId
    );

    if (!exists) {
      localStorage.removeItem(
        LAST_VIEWED_POST_KEY
      );

      return;
    }

    navigate(
      getPostRoute(
        lastViewedPostId
      ),
      {
        replace: true,
      }
    );
  }, [
    posts,
    loading,
    error,
    navigate,
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

  return (
    <ViewerPage
      posts={posts}
    />
  );
}

export default HomePage;
