import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { getSearchRoute } from "../utils/search";

type SearchBoxProps = {
  initialQuery?: string;
};

function SearchBox({ initialQuery = "" }: SearchBoxProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState(initialQuery);

  return (
    <form
      className="d-flex align-items-center gap-2"
      onSubmit={event => {
        event.preventDefault();

        const value = query.trim();

        if (!value) return;

        navigate(getSearchRoute(value));
      }}
    >
      <input
        type="search"
        className="form-control form-control-sm search-input"
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder="제목 검색"
        aria-label="제목 검색"
      />

      <button type="submit" className="btn btn-outline-secondary btn-sm" disabled={!query.trim()}>
        검색
      </button>
    </form>
  );
}

export default SearchBox;
