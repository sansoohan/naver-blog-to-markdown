import { Navigate, Route, Routes } from "react-router-dom";
import "./App.css";
import { ROUTE_HOME, ROUTE_POST } from "./constants/routes";
import HomePage from "./pages/HomePage";
import PostPage from "./pages/PostPage";

function App() {
  return (
    <Routes>
      <Route path={ROUTE_HOME} element={<HomePage />} />
      <Route path={ROUTE_POST} element={<PostPage />} />
      <Route path="*" element={<Navigate to={ROUTE_HOME} replace />} />
    </Routes>
  );
}

export default App;
