import { useRef, useState, type PointerEvent } from "react";

const DEFAULT_SPLIT_RATIO = 50;
const MIN_SPLIT_RATIO = 20;
const MAX_SPLIT_RATIO = 80;
const SPLIT_RATIO_KEY = "viewerSplitRatio";

export function useSplitter() {
  const [draggingSplitter, setDraggingSplitter] = useState(false);

  const [splitRatio, setSplitRatio] = useState(() => {
    const saved = Number(localStorage.getItem(SPLIT_RATIO_KEY));

    if (Number.isFinite(saved) && saved >= MIN_SPLIT_RATIO && saved <= MAX_SPLIT_RATIO) {
      return saved;
    }

    return DEFAULT_SPLIT_RATIO;
  });

  const compareViewRef = useRef<HTMLElement>(null);
  const splitterRef = useRef<HTMLDivElement>(null);
  const splitRatioRef = useRef(splitRatio);
  const splitterPointerIdRef = useRef<number | null>(null);

  const updateSplitRatio = (clientX: number) => {
    const container = compareViewRef.current;

    if (!container) return;

    const bounds = container.getBoundingClientRect();
    const ratio = ((clientX - bounds.left) / bounds.width) * 100;
    const next = Math.min(MAX_SPLIT_RATIO, Math.max(MIN_SPLIT_RATIO, ratio));

    splitRatioRef.current = next;
    setSplitRatio(next);
  };

  const startSplitterDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    event.preventDefault();

    splitterPointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);

    setDraggingSplitter(true);
    updateSplitRatio(event.clientX);
  };

  const moveSplitter = (event: PointerEvent<HTMLDivElement>) => {
    if (!draggingSplitter) return;
    if (splitterPointerIdRef.current !== event.pointerId) return;

    event.preventDefault();
    updateSplitRatio(event.clientX);
  };

  const stopSplitterDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (splitterPointerIdRef.current !== event.pointerId) return;

    splitterPointerIdRef.current = null;
    setDraggingSplitter(false);

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    localStorage.setItem(SPLIT_RATIO_KEY, String(splitRatioRef.current));
  };

  const handleLostPointerCapture = (event: PointerEvent<HTMLDivElement>) => {
    if (splitterPointerIdRef.current !== event.pointerId) return;

    splitterPointerIdRef.current = null;
    setDraggingSplitter(false);
    localStorage.setItem(SPLIT_RATIO_KEY, String(splitRatioRef.current));
  };

  const resetSplitRatio = () => {
    splitRatioRef.current = DEFAULT_SPLIT_RATIO;
    setSplitRatio(DEFAULT_SPLIT_RATIO);
    localStorage.setItem(SPLIT_RATIO_KEY, String(DEFAULT_SPLIT_RATIO));
  };

  return {
    splitRatio,
    draggingSplitter,
    compareViewRef,
    splitterRef,
    startSplitterDrag,
    moveSplitter,
    stopSplitterDrag,
    handleLostPointerCapture,
    resetSplitRatio,
  };
}