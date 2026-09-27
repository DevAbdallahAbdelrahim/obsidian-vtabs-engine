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

function SingleTabSplitButtonImpl({
  nodeId,
  className,
}: SingleTabSplitButtonProps): React.ReactElement | null {
  const plugin = usePlugin();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const tabNode = useTabStore((s) => s.nodes[nodeId] as TabNode | undefined);

  if (!tabNode || tabNode.type !== "tab") return null;

  const isOpen = Boolean(tabNode.leaf && !tabNode.detached);

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
    e.stopPropagation(); // منع تعارض Drag and Drop
  }, []);

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
