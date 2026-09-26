import {
  Navigate,
  Route,
  Routes,
} from "react-router-dom";
import "./App.css";
import {
  ROUTE_HOME,
  ROUTE_POST,
  ROUTE_SEARCH,
} from "./constants/routes";
import HomePage from "./pages/HomePage";
import PostPage from "./pages/PostPage";
import SearchPage from "./pages/SearchPage";

function App() {
  return (
    <Routes>
      <Route
        path={ROUTE_HOME}
        element={<HomePage />}
      />

      <Route
        path={ROUTE_POST}
        element={<PostPage />}
      />

      <Route
        path={ROUTE_SEARCH}
        element={<SearchPage />}
      />

      <Route
        path="*"
        element={
          <Navigate
            to={ROUTE_HOME}
            replace
          />
        }
      />
    </Routes>
  );
}

export default App;
