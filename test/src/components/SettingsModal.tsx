import { useAppSettings } from "../contexts/AppSettingsContext";

type SettingsModalProps = {
  show: boolean;
  onClose: () => void;
};

function SettingsModal({ show, onClose }: SettingsModalProps) {
  const { removeParagraphMargins, darkMode, setRemoveParagraphMargins, setDarkMode } = useAppSettings();

  if (!show) return null;

  return (
    <>
      <div className="modal fade show d-block" tabIndex={-1} role="dialog" aria-modal="true">
        <div className="modal-dialog">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">설정</h5>
              <button type="button" className="btn-close" aria-label="닫기" onClick={onClose} />
            </div>

            <div className="modal-body">
              <div className="form-check mb-3">
                <input
                  id="removeParagraphMargins"
                  className="form-check-input"
                  type="checkbox"
                  checked={removeParagraphMargins}
                  onChange={event => setRemoveParagraphMargins(event.target.checked)}
                />

                <label className="form-check-label" htmlFor="removeParagraphMargins">
                  문단 여백 제거
                </label>
              </div>

              <div className="form-check">
                <input
                  id="darkMode"
                  className="form-check-input"
                  type="checkbox"
                  checked={darkMode}
                  onChange={event => setDarkMode(event.target.checked)}
                />

                <label className="form-check-label" htmlFor="darkMode">
                  다크 모드
                </label>
              </div>
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-secondary" onClick={onClose}>
                닫기
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="modal-backdrop fade show" onClick={onClose} />
    </>
  );
}

export default SettingsModal;
