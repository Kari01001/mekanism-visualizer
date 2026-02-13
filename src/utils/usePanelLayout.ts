import { useState } from "react";

export const usePanelLayout = () => {
  const [leftWidth, setLeftWidth] = useState(240);
  const [rightWidth, setRightWidth] = useState(300);
  const [consoleHeight, setConsoleHeight] = useState(180);

  const MIN_LEFT = 180;
  const MAX_LEFT = 500;
  const COLLAPSE_LEFT = 120;

  const MIN_RIGHT = 220;
  const MAX_RIGHT = 600;
  const COLLAPSE_RIGHT = 160;

  const MIN_CONSOLE = 120;
  const MAX_CONSOLE = 400;
  const COLLAPSE_CONSOLE = 60;
  const HANDLE_HEIGHT = 28; // výška mini režimu

  const startLeftResize = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startWidth = leftWidth;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const next = startWidth + delta;

      if (next < COLLAPSE_LEFT) {
        setLeftWidth(0);
        return;
      }

      setLeftWidth(Math.min(MAX_LEFT, Math.max(MIN_LEFT, next)));
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startRightResize = (e: React.MouseEvent) => {
    const startX = e.clientX;
    const startWidth = rightWidth;

    const onMove = (ev: MouseEvent) => {
      const delta = ev.clientX - startX;
      const next = startWidth - delta;

      if (next < COLLAPSE_RIGHT) {
        setRightWidth(0);
        return;
      }

      setRightWidth(Math.min(MAX_RIGHT, Math.max(MIN_RIGHT, next)));
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startConsoleResize = (e: React.MouseEvent) => {
    const startY = e.clientY;
    const startHeight = consoleHeight;

    const onMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const next = startHeight + delta;

      if (next < COLLAPSE_CONSOLE) {
        setConsoleHeight(HANDLE_HEIGHT);
        return;
      }

      setConsoleHeight(
        Math.min(MAX_CONSOLE, Math.max(MIN_CONSOLE, next))
      );
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return {
    leftWidth,
    rightWidth,
    consoleHeight,
    startLeftResize,
    startRightResize,
    startConsoleResize,
  };
};
