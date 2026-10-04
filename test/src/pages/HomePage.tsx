import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import Workspace from "~/components/Workspace";
import { usePosts } from "~/hooks/usePosts";
import { getPostRoute } from "~/utils/route";

type HomePageProps = {
  blogIds: string[];
  blogId: string;
  setBlogId: (blogId: string) => void;
  blogsLoading: boolean;
  blogsError: string;
};

function HomePage({
  blogIds,
  blogId,
  setBlogId,
  blogsLoading,
  blogsError,
}: HomePageProps) {
  const navigate = useNavigate();
  const {posts, loading, error} = usePosts(blogId);

  useEffect(() => {
    if (blogsLoading || loading || blogsError || error || !blogId || posts.length === 0) return;

    const key = `lastViewedPost:${blogId}`;
    const lastViewedPostId = localStorage.getItem(key);

    if (lastViewedPostId) {
      const post = posts.find(post => post.postId === lastViewedPostId);

      if (post) {
        const route = getPostRoute(post.blogId, post.postId);

        console.log("NAVIGATE TO:", route);

        navigate(route, {replace: true});
        return;
      }

      localStorage.removeItem(key);
    }

    const firstPost = posts[0];
    const route = getPostRoute(firstPost.blogId, firstPost.postId);

    console.log("NAVIGATE TO:", route);

    navigate(route, {replace: true});
  }, [posts, blogId, blogsLoading, loading, blogsError, error, navigate]);

  if (blogsLoading || loading) {
    return (
      <div className="d-flex flex-column w-100 vh-100 bg-body text-body">
        <div className="d-flex align-items-center justify-content-center flex-grow-1 text-secondary small">
          게시글 목록을 불러오는 중...
        </div>
      </div>
    );
  }

  if (blogsError || error) {
    return (
      <div className="d-flex flex-column w-100 vh-100 bg-body text-body">
        <div className="d-flex align-items-center justify-content-center flex-grow-1 text-danger small">
          {blogsError || error}
        </div>
      </div>
    );
  }

  if (!blogId) {
    return (
      <div className="d-flex flex-column w-100 vh-100 bg-body text-body">
        <div className="d-flex align-items-center justify-content-center flex-grow-1 text-secondary small">
          백업된 블로그가 없습니다.
        </div>
      </div>
    );
  }

  if (posts.length === 0) {
    return (
      <Workspace
        posts={posts}
        blogIds={blogIds}
        blogId={blogId}
        setBlogId={setBlogId}
      />
    );
  }

  return (
    <div className="d-flex flex-column w-100 vh-100 bg-body text-body">
      <div className="d-flex align-items-center justify-content-center flex-grow-1 text-secondary small">
        게시글을 여는 중...
      </div>
    </div>
  );
}

export default HomePage;