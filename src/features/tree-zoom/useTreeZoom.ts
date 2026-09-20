import { useCallback, useEffect, useRef } from "react";
import { usePlugin, useSettings } from "../../ui/context/plugin-context";

/** Zoom scale bounds and step, per spec: 75%–150% in 5% increments. */
export const ZOOM_MIN = 0.75;
export const ZOOM_MAX = 1.5;
export const ZOOM_STEP = 0.05;
export const ZOOM_DEFAULT = 1.0;

function roundZoom(value: number): number {
  return Math.round(value * 100) / 100;
}

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, roundZoom(value)));
}

export interface UseTreeZoomResult {
  zoomLevel: number;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  /** Attach to the scrollable tree container to enable Ctrl+wheel zooming. */
  zoomRef: React.RefObject<HTMLDivElement>;
}

export function useTreeZoom(): UseTreeZoomResult {
  const plugin = usePlugin();
  const settings = useSettings();
  const zoomRef = useRef<HTMLDivElement>(null);

  const currentZoom =
    typeof settings?.zoomLevel === "number" ? settings.zoomLevel : ZOOM_DEFAULT;

  const zoomLevelRef = useRef(currentZoom);
  zoomLevelRef.current = currentZoom;

  const setZoom = useCallback(
    (next: number) => {
      const clamped = clampZoom(next);
      if (clamped === zoomLevelRef.current) return;
      plugin.settings.zoomLevel = clamped;
      void plugin.saveSettings();
    },
    [plugin],
  );

  const zoomIn = useCallback(() => {
    setZoom(zoomLevelRef.current + ZOOM_STEP);
  }, [setZoom]);

  const zoomOut = useCallback(() => {
    setZoom(zoomLevelRef.current - ZOOM_STEP);
  }, [setZoom]);

  const resetZoom = useCallback(() => {
    setZoom(ZOOM_DEFAULT);
  }, [setZoom]);

  useEffect(() => {
    const el = zoomRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const direction = e.deltaY < 0 ? 1 : -1;
      setZoom(zoomLevelRef.current + direction * ZOOM_STEP);
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [setZoom]);

  return { zoomLevel: currentZoom, zoomIn, zoomOut, resetZoom, zoomRef };
}
