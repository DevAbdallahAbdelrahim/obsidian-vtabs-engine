import * as React from "react";
import { useCallback, useEffect, useRef } from "react";
import { setTooltip } from "obsidian";
import { usePlugin } from "../../ui/context/plugin-context";
import { ObsidianIcon } from "../../ui/components/ObsidianIcon";
import { useTabStore } from "../../store/tab-store";
import { GroupSplitService, computeIsGroupOpen } from "./group-split.service";

interface GroupSplitButtonProps {
  groupId: string;
  className?: string;
}

/**
 * "Focus View" trigger for a group header — toggles the group's tracked
 * tabs between hidden and visible.
 *
 * This subscribes to the store now, which is a deliberate change from the
 * original "zero store subscription" design: showing the correct eye/
 * eye-off state means React has to know when it changes. What keeps this
 * from reintroducing the re-render storm that design was avoiding is the
 * SHAPE of the selector, not avoiding a subscription altogether —
 * computeIsGroupOpen(s.nodes, groupId) runs on every store change (cheap:
 * O(this group's own children), not O(whole tree)) but returns a plain
 * boolean, so Zustand's default equality check skips re-rendering unless
 * THIS group's own open/closed state actually flipped. A rename in some
 * other group, a reorder, a color change — none of those change the
 * returned boolean, so this button doesn't re-render for them.
 * Hover/focus feedback is still 100% CSS, unaffected by any of this.
 */
function GroupSplitButtonImpl({
  groupId,
  className,
}: GroupSplitButtonProps): React.ReactElement {
  const plugin = usePlugin();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isOpen = useTabStore((s) => computeIsGroupOpen(s.nodes, groupId));

  useEffect(() => {
    if (buttonRef.current) {
      setTooltip(buttonRef.current, isOpen ? "Hide group" : "Show group");
    }
  }, [isOpen]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation(); // MUST NOT toggle the group's collapse state
      void GroupSplitService.toggleGroupSplit(groupId, plugin);
    },
    [groupId, plugin],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // TabGroupNode's header has draggable=true; without this, Chromium can
    // interpret a click here as a drag gesture starting instead, and the
    // click never fires.
    e.stopPropagation();
  }, []);

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`tab-engine-group-split-btn clickable-icon ${className ?? ""}`.trim()}
      aria-label={isOpen ? "Hide group" : "Show group"}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
    >
      <ObsidianIcon name={isOpen ? "eye" : "eye-off"} />
    </button>
  );
}

export const GroupSplitButton = React.memo(GroupSplitButtonImpl);
