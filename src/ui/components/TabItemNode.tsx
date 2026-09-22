import * as React from "react";
import { useCallback, useState } from "react";
import { Menu } from "obsidian";
import { TabNode } from "../../types/tree";
import { useTabStore } from "../../store/tab-store";
import { ObsidianIcon } from "./ObsidianIcon";
import { resolveNodeIcon } from "../../engine/icon-engine";
import { getSiblingIds } from "../../utils/tree-utils";
import { usePlugin, useSettings } from "../context/plugin-context";
import { RenameModal } from "../../modals/rename-modal";
import { GroupPickerModal } from "../../modals/group-picker-modal";

const DRAG_MIME = "text/tab-engine-node-id";

interface TabItemNodeProps {
  node: TabNode;
  depth: number;
}

function TabItemNodeImpl({ node, depth }: TabItemNodeProps): React.ReactElement {
  const plugin = usePlugin();
  const settings = useSettings();
  const activeLeafId = useTabStore((s) => s.activeLeafId);
  const nodes = useTabStore((s) => s.nodes);
  const rootIds = useTabStore((s) => s.rootIds);
  const renameNode = useTabStore((s) => s.renameNode);
  const moveNode = useTabStore((s) => s.moveNode);
  const removeTab = useTabStore((s) => s.removeTab);

  const [isDragOver, setIsDragOver] = useState(false);

  const isActive = activeLeafId === node.leafId;
  const icon = resolveNodeIcon(node, settings.defaultGroupIcon);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation(); // Rule 4: tab selection must not bubble to a parent group
      if (node.leaf) {
        plugin.app.workspace.setActiveLeaf(node.leaf, { focus: true });
      }
    },
    [node.leaf, plugin]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation(); // Rule 4

      const menu = new Menu();

      menu.addItem((item) =>
        item
          // WorkspaceLeaf has no public `pinned` property (confirmed against
          // Obsidian's own API docs — only setPinned()/togglePinned() are
          // exposed on the leaf itself). The readable field lives on
          // ViewState, which getViewState() returns and IS publicly typed
          // (ViewState.pinned?: boolean) — so no `any` cast is needed.
          .setTitle(node.leaf?.getViewState().pinned ? "Unpin tab" : "Pin tab")
          .setIcon("pin")
          .onClick(() => {
            const leaf = node.leaf;
            if (!leaf) return;
            leaf.setPinned(!leaf.getViewState().pinned);
          })
      );

      menu.addItem((item) =>
        item
          .setTitle("Rename")
          .setIcon("pencil")
          .onClick(() => {
            new RenameModal(plugin.app, node.title, (newTitle) => {
              renameNode(node.id, newTitle);
            }).open();
          })
      );

      menu.addItem((item) =>
        item
          .setTitle("Move to group")
          .setIcon("folder-input")
          .onClick(() => {
            new GroupPickerModal(plugin.app, nodes, new Set([node.id]), (targetParentId) =>
              moveNode(node.id, targetParentId)
            ).open();
          })
      );

      menu.addSeparator();

      menu.addItem((item) =>
        item
          .setTitle("Close tab")
          .setIcon("x")
          .onClick(() => removeTab(node.id))
      );

      menu.showAtMouseEvent(e.nativeEvent);
    },
    [node, plugin, nodes, renameNode, moveNode, removeTab]
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

      // Drop-on-tab = "insert as the next sibling", within this tab's own
      // parent (group or root) — a simple, predictable reorder gesture.
      const siblings = getSiblingIds(nodes, rootIds, node.id);
      const targetIndex = siblings.indexOf(node.id) + 1;
      moveNode(draggedId, node.parentId, targetIndex);
    },
    [node.id, node.parentId, nodes, rootIds, moveNode]
  );

  return (
    <div
      className={`tab-engine-item${isActive ? " is-active" : ""}${
        isDragOver ? " is-drag-over" : ""
      }${node.detached ? " is-detached" : ""}`}
      style={{ paddingLeft: depth * settings.indentSize }}
      draggable
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      title={node.detached ? `${node.title} (hidden — toggle its group to restore)` : node.title}
    >
      {settings.showTabIcons && <ObsidianIcon name={icon} />}
      <span className="tab-engine-item-title">{node.title}</span>
      {node.detached && (
        <ObsidianIcon name="eye-off" className="tab-engine-item-detached-indicator" />
      )}
    </div>
  );
}

// Section 6: Performance Isolation — memoize so this node only re-renders
// when its own props change, not when a sibling tab or group updates.
export const TabItemNode = React.memo(TabItemNodeImpl);
