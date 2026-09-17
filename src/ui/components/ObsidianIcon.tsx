import * as React from "react";
import { useEffect, useRef } from "react";
import { applyIcon } from "../../engine/icon-engine";

interface ObsidianIconProps {
  name: string;
  className?: string;
}

/**
 * Renders a Lucide icon using Obsidian's native setIcon() API rather than an
 * npm icon library — this guarantees visual consistency with the rest of
 * Obsidian's UI and avoids bundling a duplicate icon set into main.js.
 *
 * React.memo isolates re-renders: the icon only re-applies when its `name`
 * prop actually changes, not on every parent re-render (Section 6:
 * Performance Isolation).
 */
function ObsidianIconImpl({ name, className }: ObsidianIconProps): React.ReactElement {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    applyIcon(ref.current, name);
  }, [name]);

  return <span ref={ref} className={`tab-engine-icon ${className ?? ""}`.trim()} />;
}

export const ObsidianIcon = React.memo(ObsidianIconImpl);
