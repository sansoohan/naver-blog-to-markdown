import { Route, Routes } from "react-router-dom";
import "./App.css";
import { ROUTE_HOME, ROUTE_POST } from "~/constants/routes";
import { useBlogs } from "~/hooks/useBlogs";
import HomePage from "~/pages/HomePage";
import PostPage from "~/pages/PostPage";

function App() {
  const {
    blogIds,
    blogId,
    setBlogId,
    loading: blogsLoading,
    error: blogsError,
  } = useBlogs();

  return (
    <Routes>
      <Route
        path={ROUTE_HOME}
        element={
          <HomePage
            blogIds={blogIds}
            blogId={blogId}
            setBlogId={setBlogId}
            blogsLoading={blogsLoading}
            blogsError={blogsError}
          />
        }
      />

      <Route
        path={ROUTE_POST}
        element={
          <PostPage
            blogIds={blogIds}
            blogId={blogId}
            setBlogId={setBlogId}
            blogsLoading={blogsLoading}
            blogsError={blogsError}
          />
        }
      />
    </Routes>
  );
}

export default App;