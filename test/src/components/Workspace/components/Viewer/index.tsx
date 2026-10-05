import { useEffect, useRef, useState } from "react";
import { useAppSettings } from "~/contexts/AppSettingsContext";
import type { PostInfo } from "~/types/post";
import { applyMarkdownSettings, applyOriginalSettings } from "~/utils/settings";
import { useScrollPosition } from "./hooks/useScrollPosition";
import { useScrollSync } from "./hooks/useScrollSync";
import { useSplitter } from "./hooks/useSplitter";

const DEFAULT_MARKDOWN_ZOOM = 80;
const MIN_MARKDOWN_ZOOM = 50;
const MAX_MARKDOWN_ZOOM = 150;
const MARKDOWN_ZOOM_STEP = 5;
const MARKDOWN_ZOOM_KEY = "markdownZoom";

type ViewerProps = {
  post?: PostInfo;
  refreshKey: number;
  onShortcut: (event: KeyboardEvent) => void;
  onRegisterSaveScrollPositions: (save: () => void) => void;
};

function Viewer({post, refreshKey, onShortcut, onRegisterSaveScrollPositions}: ViewerProps) {
  const {removeParagraphMargins, darkMode, fancyCheckboxes, applyFonts, syncScroll} = useAppSettings();

  const [originalLoaded, setOriginalLoaded] = useState(false);
  const [markdownLoaded, setMarkdownLoaded] = useState(false);

  const [markdownZoom, setMarkdownZoom] = useState(() => {
    const saved = Number(localStorage.getItem(MARKDOWN_ZOOM_KEY));

    if (Number.isFinite(saved) && saved >= MIN_MARKDOWN_ZOOM && saved <= MAX_MARKDOWN_ZOOM) {
      return saved;
    }

    return DEFAULT_MARKDOWN_ZOOM;
  });

  const originalFrameRef = useRef<HTMLIFrameElement>(null);
  const markdownFrameRef = useRef<HTMLIFrameElement>(null);

  const {
    splitRatio,
    draggingSplitter,
    compareViewRef,
    splitterRef,
    startSplitterDrag,
    moveSplitter,
    stopSplitterDrag,
    handleLostPointerCapture,
    resetSplitRatio,
  } = useSplitter();

  const {
    saveCurrentScrollPositions,
    restoreOriginalScrollPosition,
    restoreMarkdownScrollPosition,
  } = useScrollPosition({
    postId: post?.postId,
    originalFrameRef,
    markdownFrameRef,
  });

  const getOriginalUrl = (post: PostInfo) => {
    return (
      `/api/post/original?path=${encodeURIComponent(post.relativePath)}` +
      `&applyFonts=${applyFonts ? "1" : "0"}&refresh=${refreshKey}`
    );
  };

  const getMarkdownUrl = (post: PostInfo) => {
    return (
      `/api/post/markdown?path=${encodeURIComponent(post.relativePath)}` +
      `&applyFonts=${applyFonts ? "1" : "0"}&refresh=${refreshKey}`
    );
  };

  const changeMarkdownZoom = (amount: number) => {
    setMarkdownZoom(current => {
      const next = Math.min(MAX_MARKDOWN_ZOOM, Math.max(MIN_MARKDOWN_ZOOM, current + amount));

      localStorage.setItem(MARKDOWN_ZOOM_KEY, String(next));
      return next;
    });
  };

  const resetMarkdownZoom = () => {
    setMarkdownZoom(DEFAULT_MARKDOWN_ZOOM);
    localStorage.setItem(MARKDOWN_ZOOM_KEY, String(DEFAULT_MARKDOWN_ZOOM));
  };

  useScrollSync({
    enabled: syncScroll,
    originalFrameRef,
    markdownFrameRef,
    originalLoaded,
    markdownLoaded,
    postId: post?.postId,
    refreshKey,
  });

  useEffect(() => {
    onRegisterSaveScrollPositions(saveCurrentScrollPositions);
  }, [post?.postId, onRegisterSaveScrollPositions]);

  useEffect(() => {
    setOriginalLoaded(false);
    setMarkdownLoaded(false);
  }, [post?.postId, refreshKey, applyFonts]);

  useEffect(() => {
    const originalDocument = originalFrameRef.current?.contentDocument;
    const markdownDocument = markdownFrameRef.current?.contentDocument;

    if (originalDocument) {
      applyOriginalSettings(originalDocument, darkMode);
    }

    if (markdownDocument) {
      applyMarkdownSettings(
        markdownDocument,
        markdownZoom,
        removeParagraphMargins,
        darkMode,
        fancyCheckboxes
      );
    }
  }, [markdownZoom, removeParagraphMargins, darkMode, fancyCheckboxes, post?.postId, refreshKey]);

  useEffect(() => {
    const originalWindow = originalFrameRef.current?.contentWindow;
    const markdownWindow = markdownFrameRef.current?.contentWindow;

    if (originalWindow) {
      originalWindow.addEventListener("keydown", onShortcut);
    }

    if (markdownWindow) {
      markdownWindow.addEventListener("keydown", onShortcut);
    }

    return () => {
      originalWindow?.removeEventListener("keydown", onShortcut);
      markdownWindow?.removeEventListener("keydown", onShortcut);
    };
  }, [originalLoaded, markdownLoaded, onShortcut, post?.postId, refreshKey]);

  return (
    <main ref={compareViewRef} className="compare-view d-flex flex-grow-1 bg-body text-body position-relative">
      <section
        className="viewer d-flex flex-column bg-body"
        style={{width: `calc(${splitRatio}% - 4px)`}}
      >
        <div
          className={
            "viewer-header d-flex align-items-center justify-content-between flex-shrink-0 " +
            "px-3 border-bottom bg-body-tertiary fw-semibold"
          }
        >
          <span>original.html</span>

          {post && !post.hasHtml && (
            <span className="small text-danger fw-normal">파일 없음</span>
          )}
        </div>

        <div className="viewer-body flex-grow-1 overflow-hidden bg-body position-relative">
          {!post ? (
            <div className="d-flex align-items-center justify-content-center h-100 text-secondary small">
              선택된 게시글이 없습니다.
            </div>
          ) : post.hasHtml ? (
            <>
              {!originalLoaded && (
                <div
                  className={
                    "position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center " +
                    "justify-content-center text-secondary small"
                  }
                >
                  페이지 준비 중...
                </div>
              )}

              <iframe
                ref={originalFrameRef}
                key={`${post.postId}-html-${applyFonts ? "fonts" : "fallback"}-${refreshKey}`}
                className={`viewer-frame w-100 h-100 border-0 ${originalLoaded ? "visible" : "invisible"}`}
                src={getOriginalUrl(post)}
                title="Original HTML"
                onLoad={event => {
                  const document = event.currentTarget.contentDocument;

                  if (!document) return;

                  applyOriginalSettings(document, darkMode);
                  restoreOriginalScrollPosition(event.currentTarget);
                  setOriginalLoaded(true);
                }}
              />
            </>
          ) : (
            <div className="d-flex align-items-center justify-content-center h-100 text-secondary small">
              original.html이 없습니다.
            </div>
          )}
        </div>
      </section>

      <div
        ref={splitterRef}
        className={`viewer-splitter flex-shrink-0 border-start border-end ${draggingSplitter ? "active" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="뷰어 크기 조절"
        title="드래그하여 뷰어 크기 조절"
        onPointerDown={startSplitterDrag}
        onPointerMove={moveSplitter}
        onPointerUp={stopSplitterDrag}
        onPointerCancel={stopSplitterDrag}
        onLostPointerCapture={handleLostPointerCapture}
        onDoubleClick={resetSplitRatio}
      >
        <div className="viewer-splitter-handle position-absolute top-50 start-50 translate-middle rounded-pill bg-secondary" />
      </div>

      <section
        className="viewer d-flex flex-column bg-body"
        style={{width: `calc(${100 - splitRatio}% - 4px)`}}
      >
        <div
          className={
            "viewer-header d-flex align-items-center justify-content-between flex-shrink-0 " +
            "px-3 border-bottom bg-body-tertiary fw-semibold"
          }
        >
          <span>index.md</span>

          <div className="d-flex align-items-center gap-2 ms-auto">
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm icon-button d-inline-flex align-items-center justify-content-center"
              onClick={() => changeMarkdownZoom(-MARKDOWN_ZOOM_STEP)}
              disabled={!post || markdownZoom <= MIN_MARKDOWN_ZOOM}
              title="축소"
              aria-label="축소"
            >
              <i className="bi bi-dash-lg"></i>
            </button>

            <span className="zoom-value text-center small">{markdownZoom}%</span>

            <button
              type="button"
              className="btn btn-outline-secondary btn-sm icon-button d-inline-flex align-items-center justify-content-center"
              onClick={() => changeMarkdownZoom(MARKDOWN_ZOOM_STEP)}
              disabled={!post || markdownZoom >= MAX_MARKDOWN_ZOOM}
              title="확대"
              aria-label="확대"
            >
              <i className="bi bi-plus-lg"></i>
            </button>

            <button
              type="button"
              className="btn btn-outline-secondary btn-sm icon-button d-inline-flex align-items-center justify-content-center"
              onClick={resetMarkdownZoom}
              disabled={!post || markdownZoom === DEFAULT_MARKDOWN_ZOOM}
              title="배율 초기화"
              aria-label="배율 초기화"
            >
              <i className="bi bi-arrow-counterclockwise"></i>
            </button>

            {post && !post.hasMarkdown && (
              <span className="small text-danger fw-normal">파일 없음</span>
            )}
          </div>
        </div>

        <div className="viewer-body flex-grow-1 overflow-hidden bg-body position-relative">
          {!post ? (
            <div className="d-flex align-items-center justify-content-center h-100 text-secondary small">
              선택된 게시글이 없습니다.
            </div>
          ) : post.hasMarkdown ? (
            <>
              {!markdownLoaded && (
                <div
                  className={
                    "position-absolute top-0 start-0 w-100 h-100 d-flex align-items-center " +
                    "justify-content-center text-secondary small"
                  }
                >
                  페이지 준비 중...
                </div>
              )}

              <iframe
                ref={markdownFrameRef}
                key={`${post.postId}-markdown-${applyFonts ? "fonts" : "fallback"}-${refreshKey}`}
                className={`viewer-frame w-100 h-100 border-0 ${markdownLoaded ? "visible" : "invisible"}`}
                src={getMarkdownUrl(post)}
                title="Markdown"
                onLoad={event => {
                  const document = event.currentTarget.contentDocument;

                  if (!document) return;

                  applyMarkdownSettings(
                    document,
                    markdownZoom,
                    removeParagraphMargins,
                    darkMode,
                    fancyCheckboxes
                  );

                  restoreMarkdownScrollPosition(event.currentTarget);
                  setMarkdownLoaded(true);
                }}
              />
            </>
          ) : (
            <div className="d-flex align-items-center justify-content-center h-100 text-secondary small">
              index.md가 없습니다.
            </div>
          )}
        </div>
      </section>

      {draggingSplitter && (
        <div className="splitter-drag-overlay position-absolute top-0 start-0 w-100 h-100" />
      )}
    </main>
  );
}

export default Viewer;