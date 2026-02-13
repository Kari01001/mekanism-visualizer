import React from "react";

export const createHorizontalResize =
(
  currentValue: number,
  setter: React.Dispatch<React.SetStateAction<number>>,
  invert = false,
  min = 180
) =>
(e: React.MouseEvent) => {
  e.preventDefault();

  const startX = e.clientX;
  const startWidth = currentValue;

  document.body.style.userSelect = "none";

  const onMove = (ev: MouseEvent) => {
    const delta = ev.clientX - startX;
    const next = invert
      ? startWidth - delta
      : startWidth + delta;

    setter(Math.max(min, next));
  };

  const onUp = () => {
    document.body.style.userSelect = "auto";
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
};

export const createVerticalResize =
(
  currentValue: number,
  setter: React.Dispatch<React.SetStateAction<number>>,
  min = 100
) =>
(e: React.MouseEvent) => {
  e.preventDefault();

  const startY = e.clientY;
  const startHeight = currentValue;

  document.body.style.userSelect = "none";

  const onMove = (ev: MouseEvent) => {
    const delta = ev.clientY - startY;
    const next = startHeight - delta;

    setter(Math.max(min, next));
  };

  const onUp = () => {
    document.body.style.userSelect = "auto";
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
};