import * as React from "react";
import { useEffect, useRef } from "react";
import { setTooltip } from "obsidian";
import { ObsidianIcon } from "../../ui/components/ObsidianIcon";
import { ZOOM_MIN, ZOOM_MAX, ZOOM_DEFAULT } from "./useTreeZoom";

interface ZoomControlsProps {
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  className?: string;
}

interface IconButtonProps {
  icon: string;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

/** Shared button so all three toolbar actions get identical tooltip/a11y wiring. */
function IconButton({ icon, label, onClick, disabled }: IconButtonProps): React.ReactElement {
  const ref = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (ref.current) setTooltip(ref.current, label);
  }, [label]);

  return (
    <button
      ref={ref}
      type="button"
      className="tab-engine-zoom-btn clickable-icon"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      <ObsidianIcon name={icon} />
    </button>
  );
}

/**
 * Zoom Out / Reset / Zoom In toolbar for the sidebar header.
 *
 * Icons render through Obsidian's own bundled Lucide set via ObsidianIcon
 * (setIcon()), not the separate `lucide-react` package — this project
 * deliberately renders every icon this way (docs/ARCHITECTURE.md, ADR-002)
 * to avoid bundling a second copy of the icon set into main.js. "zoom-in",
 * "zoom-out", and "rotate-ccw" are the exact icons lucide-react's
 * ZoomIn/ZoomOut/RotateCcw components would render — Lucide's kebab-case
 * icon names map 1:1 to its PascalCase component names.
 *
 * Purely presentational: receives zoomLevel and the three actions as props
 * rather than calling useTreeZoom() itself. The hook's zoomRef needs to
 * attach to the scrollable tree body, not this toolbar row, so there must
 * be exactly one call site for the hook — see the VirtualTabList
 * integration — with state and stable callbacks flowing down from there.
 * Those callbacks being stable (see useTreeZoom's zoomLevelRef) is what
 * lets React.memo here actually skip re-renders on unrelated parent
 * re-renders, only re-rendering when zoomLevel itself changes.
 */
function ZoomControlsImpl({
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  className,
}: ZoomControlsProps): React.ReactElement {
  const percent = Math.round(zoomLevel * 100);

  return (
    <div
      className={`tab-engine-zoom-controls ${className ?? ""}`.trim()}
      role="group"
      aria-label="Sidebar zoom"
    >
      <IconButton
        icon="zoom-out"
        label="Zoom out"
        onClick={onZoomOut}
        disabled={zoomLevel <= ZOOM_MIN}
      />
      <IconButton
        icon="rotate-ccw"
        label={`Reset zoom (currently ${percent}%)`}
        onClick={onResetZoom}
        disabled={zoomLevel === ZOOM_DEFAULT}
      />
      <IconButton
        icon="zoom-in"
        label="Zoom in"
        onClick={onZoomIn}
        disabled={zoomLevel >= ZOOM_MAX}
      />
    </div>
  );
}

export const ZoomControls = React.memo(ZoomControlsImpl);
