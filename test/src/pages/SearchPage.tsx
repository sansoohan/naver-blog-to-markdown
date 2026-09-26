import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Link,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import SearchBox from "../components/SearchBox";
import { ROUTE_HOME } from "../constants/routes";
import { usePosts } from "../hooks/usePosts";
import { getPostRoute } from "../utils/route";
import {
  getAutomaticSearchPageSize,
  getSearchPage,
  getSearchPageSize,
  getSearchRoute,
  SEARCH_PAGE_SIZE_OPTIONS,
  searchPosts,
  type SearchPageSize,
} from "../utils/search";

function SearchPage() {
  const navigate = useNavigate();

  const [searchParams] =
    useSearchParams();

  const measureRowRef =
    useRef<HTMLDivElement>(null);

  const query =
    searchParams.get("q")?.trim() || "";

  const urlPageSize =
    getSearchPageSize(
      searchParams.get("size")
    );

  const [automaticPageSize, setAutomaticPageSize] =
    useState<SearchPageSize | null>(null);

  const {
    posts,
    loading,
    error,
  } = usePosts();

  const results = useMemo(
    () => searchPosts(posts, query),
    [posts, query]
  );

  useEffect(() => {
    if (urlPageSize) return;

    const calculate = () => {
      const row =
        measureRowRef.current;

      if (!row) return;

      const rowHeight =
        row.getBoundingClientRect().height;

      if (rowHeight <= 0) return;

      /*
       * 현재 CSS 기준:
       *
       * search-header:
       *   min-height 52px
       *
       * search-results:
       *   padding-top    24px
       *   padding-bottom 24px
       *
       * search-summary:
       *   높이 + margin-bottom 16px
       *
       * pagination:
       *   margin-top 20px + 버튼 높이
       *
       * 약간의 안전 여백까지 포함해서
       * 결과 목록에 실제 사용할 수 있는 높이를 계산한다.
       */

      const searchHeader =
        document.querySelector(
          ".search-header"
        ) as HTMLElement | null;

      const searchSummary =
        document.querySelector(
          ".search-summary"
        ) as HTMLElement | null;

      const headerHeight =
        searchHeader
          ?.getBoundingClientRect()
          .height ?? 0;

      const summaryHeight =
        searchSummary
          ?.getBoundingClientRect()
          .height ?? 0;

      const searchResults =
        document.querySelector(
          ".search-results"
        ) as HTMLElement | null;

      const resultsStyle =
        searchResults
          ? window.getComputedStyle(
              searchResults
            )
          : null;

      const paddingTop =
        resultsStyle
          ? parseFloat(
              resultsStyle.paddingTop
            ) || 0
          : 0;

      const paddingBottom =
        resultsStyle
          ? parseFloat(
              resultsStyle.paddingBottom
            ) || 0
          : 0;

      /*
       * summary의 margin-bottom 16px.
       * pagination은 버튼 높이 약 31px +
       * margin-top 20px.
       *
       * 마지막에 8px 정도 여유를 둔다.
       */
      const summaryGap = 16;
      const paginationHeight = 31;
      const paginationGap = 20;
      const safetySpace = 8;

      const availableHeight =
        window.innerHeight -
        headerHeight -
        paddingTop -
        paddingBottom -
        summaryHeight -
        summaryGap -
        paginationHeight -
        paginationGap -
        safetySpace;

      const availableRows =
        Math.max(
          0,
          Math.floor(
            availableHeight /
              rowHeight
          )
        );

      setAutomaticPageSize(
        getAutomaticSearchPageSize(
          availableRows
        )
      );
    };

    /*
     * DOM/CSS layout이 끝난 다음 측정.
     */
    const frame =
      requestAnimationFrame(calculate);

    return () => {
      cancelAnimationFrame(frame);
    };
  }, [
    urlPageSize,
    query,
    results.length,
  ]);

  const pageSize =
    urlPageSize ??
    automaticPageSize ??
    5;

  const totalPages =
    Math.ceil(
      results.length / pageSize
    );

  const page =
    getSearchPage(
      searchParams.get("page"),
      totalPages
    );

  const visiblePosts =
    useMemo(() => {
      const start =
        (page - 1) * pageSize;

      return results.slice(
        start,
        start + pageSize
      );
    }, [
      results,
      page,
      pageSize,
    ]);

  const changePage = (
    nextPage: number
  ) => {
    /*
     * 자동 선택 상태에서는 size를 URL에
     * 넣지 않는다.
     *
     * 그래야 다른 브라우저 높이에서 열었을 때
     * 다시 자동 계산된다.
     */
    navigate(
      getSearchRoute(
        query,
        nextPage,
        urlPageSize ?? undefined
      )
    );
  };

  const changePageSize = (
    nextPageSize: SearchPageSize
  ) => {
    navigate(
      getSearchRoute(
        query,
        1,
        nextPageSize
      ),
      {
        replace: true,
      }
    );
  };

  return (
    <div className="app search-page">
      <header className="search-header">
        <button
          className="btn btn-outline-secondary btn-sm"
          onClick={() =>
            navigate(ROUTE_HOME)
          }
        >
          홈
        </button>

        <SearchBox
          initialQuery={query}
        />
      </header>

      {loading && (
        <div className="status-message">
          게시글 목록을 불러오는 중...
        </div>
      )}

      {!loading && error && (
        <div className="status-message error-message">
          {error}
        </div>
      )}

      {!loading && !error && (
        <main className="search-results">
          <div className="search-summary">
            <strong>
              &quot;{query}&quot;
            </strong>

            <span>
              검색 결과 {results.length}개
            </span>

            <label className="page-size-control">
              <span>표시</span>

              <select
                className="form-select form-select-sm"
                value={pageSize}
                onChange={event =>
                  changePageSize(
                    Number(
                      event.target.value
                    ) as SearchPageSize
                  )
                }
              >
                {SEARCH_PAGE_SIZE_OPTIONS.map(
                  size => (
                    <option
                      key={size}
                      value={size}
                    >
                      {size}개
                    </option>
                  )
                )}
              </select>
            </label>
          </div>

          {/*
           * 실제 검색 결과와 동일한 CSS로
           * 한 줄 높이를 측정한다.
           *
           * 화면에는 보이지 않는다.
           */}
          <div
            className="search-result-list search-measure-list"
            aria-hidden="true"
          >
            <div
              ref={measureRowRef}
              className="search-result-item"
            >
              <span className="search-result-title">
                측정
              </span>

              <span className="search-result-category">
                측정
              </span>
            </div>
          </div>

          {!query && (
            <div className="search-empty">
              검색어를 입력하세요.
            </div>
          )}

          {query &&
            results.length === 0 && (
              <div className="search-empty">
                검색 결과가 없습니다.
              </div>
            )}

          {visiblePosts.length > 0 && (
            <>
              <div className="search-result-list">
                {visiblePosts.map(
                  post => (
                    <Link
                      key={post.id}
                      to={getPostRoute(
                        post.id
                      )}
                      className="search-result-item"
                    >
                      <span className="search-result-title">
                        {post.folderName}
                      </span>

                      <span className="search-result-category">
                        {post.category ||
                          "(카테고리 없음)"}
                      </span>
                    </Link>
                  )
                )}
              </div>

              {totalPages > 1 && (
                <div className="pagination-bar">
                  <button
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() =>
                      changePage(
                        page - 1
                      )
                    }
                    disabled={page <= 1}
                  >
                    ← 이전
                  </button>

                  <span className="pagination-info">
                    {page} / {totalPages}
                  </span>

                  <button
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() =>
                      changePage(
                        page + 1
                      )
                    }
                    disabled={
                      page >= totalPages
                    }
                  >
                    다음 →
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      )}
    </div>
  );
}

export default SearchPage;
