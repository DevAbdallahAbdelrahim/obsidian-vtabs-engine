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
      e.stopPropagation();
      void GroupSplitService.toggleGroupSplit(groupId, plugin);
    },
    [groupId, plugin],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // إيقاف حدث السحب حتى يكتمل النقر بنجاح
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
