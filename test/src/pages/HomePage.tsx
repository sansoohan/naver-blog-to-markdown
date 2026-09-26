import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import ViewerPage from "../components/ViewerPage";
import { usePosts } from "../hooks/usePosts";
import { getPostRoute } from "../utils/route";

const LAST_VIEWED_POST_KEY = "lastViewedPostId";

function HomePage() {
  const navigate = useNavigate();
  const { posts, loading, error } = usePosts();

  useEffect(() => {
    if (loading || error) return;

    const lastViewedPostId = localStorage.getItem(LAST_VIEWED_POST_KEY);

    if (!lastViewedPostId) return;

    const exists = posts.some(post => post.id === lastViewedPostId);

    if (!exists) {
      localStorage.removeItem(LAST_VIEWED_POST_KEY);
      return;
    }

    navigate(getPostRoute(lastViewedPostId), { replace: true });
  }, [posts, loading, error, navigate]);

  if (loading) {
    return (
      <div className="d-flex flex-column w-100 vh-100 bg-white">
        <div className="d-flex align-items-center justify-content-center flex-grow-1 text-secondary small">
          게시글 목록을 불러오는 중...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="d-flex flex-column w-100 vh-100 bg-white">
        <div className="d-flex align-items-center justify-content-center flex-grow-1 text-danger small">{error}</div>
      </div>
    );
  }

  return <ViewerPage posts={posts} />;
}

export default HomePage;
