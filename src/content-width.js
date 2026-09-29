// content-width.js

/*
 * 네이버 블로그 본문 폭 계산 전용.
 *
 * 매우 중요한 레이아웃 기준값이므로 editorVersion 1 / 2 / 3 / 4를 각각 독립적으로 관리한다.
 * 다른 파일에서 본문 폭을 임의로 계산하지 말고 반드시 이 파일을 사용한다.
 */

const CONTENT_WIDTH_LAYOUTS = {
  1: {leftWidth: 15, rightWidth: 15},
  2: {leftWidth: 15, rightWidth: 15},
  3: {leftWidth: 40, rightWidth: 40},
  4: {leftWidth: 40, rightWidth: 40},
};

function getContainerWidth(value) {
  const match = String(value || "").match(/\bcontw-(\d+)\b/i);
  if (!match) return 0;

  const width = Number(match[1]);
  return Number.isFinite(width) && width > 0 ? width : 0;
}

function getContentWidth(editorVersion, containerWidth) {
  const layout = CONTENT_WIDTH_LAYOUTS[editorVersion];
  const width = Number(containerWidth);

  if (!layout || !Number.isFinite(width) || width <= 0) return 0;

  return Math.max(0, width - layout.leftWidth - layout.rightWidth);
}

function getContentWidths(editorVersion, value) {
  const containerWidth = getContainerWidth(value);
  return {containerWidth, contentWidth: getContentWidth(editorVersion, containerWidth)};
}

module.exports = {
  CONTENT_WIDTH_LAYOUTS,
  getContainerWidth,
  getContentWidth,
  getContentWidths,
};
