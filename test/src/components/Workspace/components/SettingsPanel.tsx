import { useAppSettings } from "~/contexts/AppSettingsContext";

type SettingsPanelProps = {
  show: boolean;
  blogIds: string[];
  blogId: string;
  setBlogId: (blogId: string) => void;
  onClose: () => void;
};

function SettingsPanel({show, blogIds, blogId, setBlogId, onClose}: SettingsPanelProps) {
  const {
    removeParagraphMargins,
    setRemoveParagraphMargins,
    darkMode,
    setDarkMode,
    fancyCheckboxes,
    setFancyCheckboxes,
    syncScroll,
    setSyncScroll,
  } = useAppSettings();

  const changeBlogId = (nextBlogId: string) => {
    if (nextBlogId === blogId) return;

    onClose();
    setBlogId(nextBlogId);
  };

  return (
    <>
      <aside
        className={
          `settings-panel position-fixed top-0 end-0 h-100 d-flex flex-column ` +
          `bg-body border-start shadow ${show ? "open" : ""}`
        }
        aria-hidden={!show}
      >
        <div className="settings-panel-header d-flex align-items-center justify-content-between flex-shrink-0 px-3 border-bottom">
          <span className="fw-semibold">설정</span>

          <button
            type="button"
            className="btn btn-outline-secondary btn-sm icon-button d-inline-flex align-items-center justify-content-center"
            onClick={onClose}
            title="닫기"
            aria-label="설정 닫기"
          >
            <i className="bi bi-x-lg"></i>
          </button>
        </div>

        <div className="settings-panel-body overflow-auto flex-grow-1">
          <div className="list-group list-group-flush">
            <div className="p-3">
              <label className="form-label small fw-semibold mb-2" htmlFor="blogId">
                블로그 ID
              </label>

              <select
                id="blogId"
                className="form-select form-select-sm"
                value={blogId}
                onChange={event => changeBlogId(event.target.value)}
                disabled={blogIds.length === 0}
              >
                {blogIds.length === 0 ? (
                  <option value="">백업된 블로그 없음</option>
                ) : (
                  blogIds.map(id => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))
                )}
              </select>
            </div>

            <label
              className="list-group-item list-group-item-action d-flex align-items-center justify-content-between gap-3 py-3"
              htmlFor="removeParagraphMargins"
            >
              <div>
                <div className="small fw-semibold">문단 여백 제거</div>
                <div className="small text-secondary mt-1">
                  Markdown 문단 사이의 기본 여백을 제거합니다.
                </div>
              </div>

              <div className="form-check form-switch flex-shrink-0 m-0">
                <input
                  id="removeParagraphMargins"
                  className="form-check-input"
                  type="checkbox"
                  role="switch"
                  checked={removeParagraphMargins}
                  onChange={event => setRemoveParagraphMargins(event.target.checked)}
                />
              </div>
            </label>

            <label
              className="list-group-item list-group-item-action d-flex align-items-center justify-content-between gap-3 py-3"
              htmlFor="fancyCheckboxes"
            >
              <div>
                <div className="small fw-semibold">체크박스 스타일</div>
                <div className="small text-secondary mt-1">
                  Markdown 체크박스에 보기 좋은 스타일을 적용합니다.
                </div>
              </div>

              <div className="form-check form-switch flex-shrink-0 m-0">
                <input
                  id="fancyCheckboxes"
                  className="form-check-input"
                  type="checkbox"
                  role="switch"
                  checked={fancyCheckboxes}
                  onChange={event => setFancyCheckboxes(event.target.checked)}
                />
              </div>
            </label>

            <label
              className="list-group-item list-group-item-action d-flex align-items-center justify-content-between gap-3 py-3"
              htmlFor="syncScroll"
            >
              <div>
                <div className="small fw-semibold">스크롤 동기화</div>
                <div className="small text-secondary mt-1">
                  양쪽 뷰어의 스크롤 위치를 비율에 맞춰 동기화합니다.
                </div>
              </div>

              <div className="form-check form-switch flex-shrink-0 m-0">
                <input
                  id="syncScroll"
                  className="form-check-input"
                  type="checkbox"
                  role="switch"
                  checked={syncScroll}
                  onChange={event => setSyncScroll(event.target.checked)}
                />
              </div>
            </label>

            <label
              className="list-group-item list-group-item-action d-flex align-items-center justify-content-between gap-3 py-3"
              htmlFor="darkMode"
            >
              <div>
                <div className="small fw-semibold">다크 모드</div>
                <div className="small text-secondary mt-1">
                  Tester와 뷰어를 어두운 테마로 표시합니다.
                </div>
              </div>

              <div className="form-check form-switch flex-shrink-0 m-0">
                <input
                  id="darkMode"
                  className="form-check-input"
                  type="checkbox"
                  role="switch"
                  checked={darkMode}
                  onChange={event => setDarkMode(event.target.checked)}
                />
              </div>
            </label>
          </div>

          <div className="border-top p-3">
            <div className="small fw-semibold mb-3">키보드 단축키</div>

            <div className="d-flex flex-column gap-2 small">
              <div className="d-flex align-items-center justify-content-between gap-3">
                <span className="text-secondary">검색</span>
                <span className="d-flex align-items-center gap-1">
                  <kbd>Ctrl</kbd>
                  <span>+</span>
                  <kbd>K</kbd>
                </span>
              </div>

              <div className="d-flex align-items-center justify-content-between gap-3">
                <span className="text-secondary">카테고리 선택</span>
                <span className="d-flex align-items-center gap-1">
                  <kbd>Ctrl</kbd>
                  <span>+</span>
                  <kbd>J</kbd>
                </span>
              </div>

              <div className="d-flex align-items-center justify-content-between gap-3">
                <span className="text-secondary">설정 열기</span>
                <span className="d-flex align-items-center gap-1">
                  <kbd>Ctrl</kbd>
                  <span>+</span>
                  <kbd>,</kbd>
                </span>
              </div>

              <div className="d-flex align-items-center justify-content-between gap-3">
                <span className="text-secondary">스크롤 동기화</span>
                <span className="d-flex align-items-center gap-1">
                  <kbd>Alt</kbd>
                  <span>+</span>
                  <kbd>S</kbd>
                </span>
              </div>

              <div className="d-flex align-items-center justify-content-between gap-3">
                <span className="text-secondary">이전 게시글</span>
                <span className="d-flex align-items-center gap-1">
                  <kbd>Ctrl</kbd>
                  <span>+</span>
                  <kbd>←</kbd>
                </span>
              </div>

              <div className="d-flex align-items-center justify-content-between gap-3">
                <span className="text-secondary">다음 게시글</span>
                <span className="d-flex align-items-center gap-1">
                  <kbd>Ctrl</kbd>
                  <span>+</span>
                  <kbd>→</kbd>
                </span>
              </div>

              <div className="d-flex align-items-center justify-content-between gap-3">
                <span className="text-secondary">설정 닫기</span>
                <kbd>Esc</kbd>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {show && (
        <div
          className="settings-panel-backdrop position-fixed top-0 start-0 w-100 h-100"
          onClick={onClose}
          aria-hidden="true"
        />
      )}
    </>
  );
}

export default SettingsPanel;