import * as React from "react";
import { useCallback, useEffect, useRef } from "react";
import { setTooltip } from "obsidian";
import { usePlugin } from "../../ui/context/plugin-context";
import { ObsidianIcon } from "../../ui/components/ObsidianIcon";
import { useTabStore } from "../../store/tab-store";
import { GroupSplitService } from "./group-split.service";
import { TabNode } from "../../types/tree";

interface SingleTabSplitButtonProps {
  nodeId: string;
  className?: string;
}

/**
 * "Focus View" trigger for one tab, independent of any group — hides or
 * restores exactly this tab via GroupSplitService.toggleSingleTab().
 *
 * All hooks run unconditionally, every render, in the same order — the
 * `!tabNode` case is handled by returning null from the JSX at the end,
 * not by an early return placed between hook calls. (An earlier version of
 * this component had `if (!tabNode) return null;` sitting between the
 * useTabStore selector and useEffect, which violates the Rules of Hooks:
 * if tabNode is ever undefined on one render and defined on the next, React
 * calls a different number of hooks for the same component instance,
 * which corrupts its state or throws outright.)
 *
 * The selector returns the specific node object at s.nodes[nodeId] (or
 * undefined), not a derived value — that's fine for re-render scoping
 * because tab-store's own mutation pattern (two-level spread) preserves
 * object identity for every OTHER node when one node changes, so this
 * still only re-renders when THIS tab's own node actually changes.
 */
function SingleTabSplitButtonImpl({
  nodeId,
  className,
}: SingleTabSplitButtonProps): React.ReactElement | null {
  const plugin = usePlugin();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tabNode = useTabStore((s) => {
    const node = s.nodes[nodeId];
    return node?.type === "tab" ? (node as TabNode) : undefined;
  });

  const isOpen = Boolean(tabNode?.leaf && !tabNode?.detached);

  useEffect(() => {
    if (buttonRef.current) {
      setTooltip(buttonRef.current, isOpen ? "Hide tab" : "Restore tab");
    }
  }, [isOpen]);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      void GroupSplitService.toggleSingleTab(nodeId, plugin);
    },
    [nodeId, plugin],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // TabItemNode's row has draggable=true; without this, Chromium can
    // interpret a click here as a drag gesture starting instead, and the
    // click never fires.
    e.stopPropagation();
  }, []);

  if (!tabNode) return null;

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`tab-engine-tab-split-btn clickable-icon ${className ?? ""}`.trim()}
      aria-label={isOpen ? "Hide tab" : "Restore tab"}
      onClick={handleClick}
      onMouseDown={handleMouseDown}
    >
      <ObsidianIcon name={isOpen ? "eye" : "eye-off"} />
    </button>
  );
}

export const SingleTabSplitButton = React.memo(SingleTabSplitButtonImpl);
