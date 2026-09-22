import * as React from "react";
import { useCallback, useEffect, useRef } from "react";
import { setTooltip } from "obsidian";
import { usePlugin } from "../../ui/context/plugin-context";
import { ObsidianIcon } from "../../ui/components/ObsidianIcon";
import { GroupSplitService } from "./group-split.service";

interface GroupSplitButtonProps {
  groupId: string;
  className?: string;
}

/**
 * "Focus View" trigger for a group header — opens every tab in the group
 * (recursively) into a new adjacent split.
 *
 * Isolated from the group node's own re-render cycle by construction:
 * - No `useState`, no store subscription of any kind. Hover/focus feedback
 *   is 100% CSS (`:hover` in styles.css), so this component never
 *   re-renders for those interactions — the "zero store re-renders on
 *   hover" requirement is satisfied structurally, not by optimizing away
 *   renders that would otherwise happen.
 * - `React.memo` means it only re-renders if `groupId`/`className`
 *   themselves change, which in practice never happens for an
 *   already-mounted group row.
 */
function GroupSplitButtonImpl({
  groupId,
  className,
}: GroupSplitButtonProps): React.ReactElement {
  const plugin = usePlugin();
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Obsidian's native tooltip, applied once via a ref rather than through
  // React state — the tooltip text here never changes after mount.
  useEffect(() => {
    if (buttonRef.current) {
      setTooltip(buttonRef.current, "Open group in new split");
    }
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation(); // MUST NOT toggle the group's collapse state
      void GroupSplitService.toggleGroupSplit(groupId, plugin);
    },
    [groupId, plugin],
  );

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`tab-engine-group-split-btn clickable-icon ${className ?? ""}`.trim()}
      aria-label="Open group in new split"
      onClick={handleClick}
    >
      <ObsidianIcon name="eye" />
    </button>
  );
}

export const GroupSplitButton = React.memo(GroupSplitButtonImpl);
