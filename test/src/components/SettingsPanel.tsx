import { useAppSettings } from "../contexts/AppSettingsContext";

type SettingsPanelProps = {
  show: boolean;
  onClose: () => void;
};

function SettingsPanel({ show, onClose }: SettingsPanelProps) {
  const {
    removeParagraphMargins,
    darkMode,
    fancyCheckboxes,
    setRemoveParagraphMargins,
    setDarkMode,
    setFancyCheckboxes,
  } = useAppSettings();

  return (
    <>
      <aside
        className={
          "settings-panel position-fixed top-0 end-0 vh-100 border-start shadow bg-body text-body " +
          `${show ? "open" : ""}`
        }
        aria-hidden={!show}
      >
        <div className="d-flex align-items-center justify-content-between px-3 border-bottom settings-panel-header">
          <span className="fw-semibold">설정</span>

          <button
            type="button"
            className="btn-close"
            aria-label="닫기"
            onClick={onClose}
          />
        </div>

        <div className="list-group list-group-flush">
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
              <div className="small fw-semibold">멋진 체크박스</div>
              <div className="small text-secondary mt-1">
                Markdown 체크박스의 표시 스타일을 변경합니다.
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
            htmlFor="darkMode"
          >
            <div>
              <div className="small fw-semibold">다크 모드</div>
              <div className="small text-secondary mt-1">
                뷰어 전체를 어두운 화면으로 표시합니다.
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
      </aside>

      {show && (
        <div
          className="settings-panel-backdrop position-fixed top-0 start-0 w-100 h-100"
          onClick={onClose}
        />
      )}
    </>
  );
}

export default SettingsPanel;
