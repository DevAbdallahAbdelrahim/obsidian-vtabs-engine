import * as React from "react";
import { useCallback, useState } from "react";
import { Menu } from "obsidian";
import { GroupNode, CustomTreeNode } from "../../types/tree";
import { useTabStore, EMPTY_ARRAY } from "../../store/tab-store";
import { ObsidianIcon } from "./ObsidianIcon";
import { resolveNodeIcon } from "../../engine/icon-engine";
import { usePlugin, useSettings } from "../context/plugin-context";
import { RenameModal } from "../modals/rename-modal";
import { IconPickerModal } from "../modals/icon-picker-modal";
import { ColorPickerModal } from "../modals/color-picker-modal";
import { GroupPickerModal } from "../modals/group-picker-modal";

const DRAG_MIME = "text/tab-engine-node-id";

interface TabGroupNodeProps {
  node: GroupNode;
  depth: number;
  /** Supplied by VirtualTabList, which owns the actual DFS recursion loop. */
  renderChild: (childId: string, depth: number) => React.ReactNode;
}

/** Walks a group's subtree, returning its own ID plus every nested group ID. */
function collectGroupAndDescendantIds(
  nodes: Record<string, CustomTreeNode>,
  groupId: string
): Set<string> {
  const ids = new Set<string>([groupId]);
  const node = nodes[groupId];
  if (!node || node.type !== "group") return ids; // Rule 5: strict discriminant

  const childrenIds = Array.isArray(node.childrenIds) ? node.childrenIds : EMPTY_ARRAY; // Rule 2
  for (const childId of childrenIds) {
    if (nodes[childId]?.type === "group") {
      for (const id of collectGroupAndDescendantIds(nodes, childId)) {
        ids.add(id);
      }
    }
  }
  return ids;
}

function TabGroupNodeImpl({
  node,
  depth,
  renderChild,
}: TabGroupNodeProps): React.ReactElement {
  const plugin = usePlugin();
  const settings = useSettings();
  const nodes = useTabStore((s) => s.nodes);
  const toggleCollapse = useTabStore((s) => s.toggleCollapse);
  const renameNode = useTabStore((s) => s.renameNode);
  const moveNode = useTabStore((s) => s.moveNode);
  const deleteGroup = useTabStore((s) => s.deleteGroup);
  const setNodeIcon = useTabStore((s) => s.setNodeIcon);
  const setNodeColor = useTabStore((s) => s.setNodeColor);

  const [isDragOver, setIsDragOver] = useState(false);

  const icon = resolveNodeIcon(node, settings.defaultGroupIcon);
  // Rule 2 + reference-stable fallback (module-scoped EMPTY_ARRAY, never a fresh `[]`)
  const childrenIds = Array.isArray(node.childrenIds) ? node.childrenIds : EMPTY_ARRAY;

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation(); // Rule 4: must not bubble to an ancestor group's header
      toggleCollapse(node.id);
    },
    [node.id, toggleCollapse]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation(); // Rule 4

      const menu = new Menu();

      menu.addItem((item) =>
        item
          .setTitle("Rename group")
          .setIcon("pencil")
          .onClick(() => {
            new RenameModal(plugin.app, node.title, (newTitle) => {
              renameNode(node.id, newTitle);
            }).open();
          })
      );

      menu.addItem((item) =>
        item
          .setTitle("Change icon")
          .setIcon("image")
          .onClick(() => {
            new IconPickerModal(plugin.app, (iconName) => {
              setNodeIcon(node.id, iconName);
            }).open();
          })
      );

      menu.addItem((item) =>
        item
          .setTitle("Set accent color")
          .setIcon("palette")
          .onClick(() => {
            new ColorPickerModal(plugin.app, node.color, (color) => {
              setNodeColor(node.id, color);
            }).open();
          })
      );

      menu.addItem((item) =>
        item
          .setTitle("Move to group")
          .setIcon("folder-input")
          .onClick(() => {
            const excludeIds = collectGroupAndDescendantIds(nodes, node.id);
            new GroupPickerModal(plugin.app, nodes, excludeIds, (targetParentId) =>
              moveNode(node.id, targetParentId)
            ).open();
          })
      );

      menu.addSeparator();

      menu.addItem((item) =>
        item
          .setTitle("Delete group (keep tabs)")
          .setIcon("trash")
          .onClick(() => deleteGroup(node.id))
      );

      menu.showAtMouseEvent(e.nativeEvent);
    },
    [node, plugin, nodes, renameNode, setNodeIcon, setNodeColor, moveNode, deleteGroup]
  );

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      e.stopPropagation(); // Rule 4
      e.dataTransfer.setData(DRAG_MIME, node.id);
      e.dataTransfer.effectAllowed = "move";
    },
    [node.id]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation(); // Rule 4
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.stopPropagation(); // Rule 4
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation(); // Rule 4
      setIsDragOver(false);

      const draggedId = e.dataTransfer.getData(DRAG_MIME);
      if (!draggedId || draggedId === node.id) return;

      // Guard against dropping a group inside its own subtree (would cycle).
      const forbidden = collectGroupAndDescendantIds(nodes, draggedId);
      if (forbidden.has(node.id)) return;

      // Drop-on-group-header = "nest inside this group" (append to end).
      moveNode(draggedId, node.id);
    },
    [node.id, nodes, moveNode]
  );

  const headerStyle: React.CSSProperties = {
    paddingLeft: depth * settings.indentSize,
    ...(node.color ? ({ "--tab-engine-accent": node.color } as React.CSSProperties) : {}),
  };

  return (
    <div className="tab-engine-group">
      <div
        className={`tab-engine-group-header${isDragOver ? " is-drag-over" : ""}`}
        style={headerStyle}
        draggable
        onClick={handleToggle}
        onContextMenu={handleContextMenu}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        title={node.title}
      >
        <span className={`tab-engine-chevron${node.isCollapsed ? "" : " is-expanded"}`}>
          <ObsidianIcon name="chevron-right" />
        </span>
        <ObsidianIcon name={icon} />
        <span className="tab-engine-group-title">{node.title}</span>
        <span className="tab-engine-group-count">{childrenIds.length}</span>
      </div>

      {!node.isCollapsed && (
        <div className="tab-engine-group-children">
          {childrenIds.map((childId) => renderChild(childId, depth + 1))}
        </div>
      )}
    </div>
  );
}

// Section 6: Performance Isolation — isolates re-renders when switching
// active leaves elsewhere in the tree; only this group's own prop changes
// (rename, icon, color, collapse, children) force a re-render.
export const TabGroupNode = React.memo(TabGroupNodeImpl);
