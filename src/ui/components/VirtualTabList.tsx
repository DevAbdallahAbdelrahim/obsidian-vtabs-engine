import * as React from "react";
import { useMemo, useCallback } from "react";
import { useTabStore, EMPTY_ARRAY } from "../../store/tab-store";
import { filterTree, isNodeVisible } from "../../utils/tree-utils";
import { TabGroupNode } from "./TabGroupNode";
import { TabItemNode } from "./TabItemNode";
import { ObsidianIcon } from "./ObsidianIcon";
import { CustomTreeNode } from "../../types/tree";
import { usePlugin, useSettings } from "../context/plugin-context";
import { RenameModal } from "../../modals/rename-modal";

/**
 * The root recursive tree renderer (Section 3: "Recursive DFS UI Rendering").
 * Also owns the toolbar (search input + "new group" button), since this is
 * the single top-level component the project's file layout assigns that
 * responsibility to ("Recursive tree renderer with search filter").
 *
 * Search behavior: when a query is active, non-matching branches are hidden
 * entirely, but any ancestor group of a match stays visible AND forced open
 * via a render-time-only override (never dispatched through toggleCollapse,
 * so it is never persisted) — see engine/search-engine.ts for matching rules.
 */
export function VirtualTabList(): React.ReactElement {
  const plugin = usePlugin();
  const settings = useSettings();
  const nodes = useTabStore((s) => s.nodes);
  const rootIds = useTabStore((s) => s.rootIds);
  const searchQuery = useTabStore((s) => s.searchQuery);
  const setSearchQuery = useTabStore((s) => s.setSearchQuery);
  const createGroup = useTabStore((s) => s.createGroup);

  // Rule 2 + reference-stable fallback: EMPTY_ARRAY keeps this useMemo's
  // dependency stable across renders in the (defensive) case rootIds is malformed.
  const safeRootIds: readonly string[] = Array.isArray(rootIds) ? rootIds : EMPTY_ARRAY;

  const visibleIds = useMemo(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) return null; // null = "no filter active"
    return filterTree(nodes, safeRootIds as string[], trimmed);
  }, [nodes, safeRootIds, searchQuery]);

  const isSearching = visibleIds !== null;

  const handleNewGroup = useCallback(() => {
    new RenameModal(plugin.app, "New Group", (title) => {
      createGroup(title, null);
    }).open();
  }, [plugin, createGroup]);

  const renderNode = (nodeId: string, depth: number): React.ReactNode => {
    if (!isNodeVisible(nodeId, visibleIds)) return null;

    const node: CustomTreeNode | undefined = nodes[nodeId];
    if (!node) return null; // Defensive: dangling ID self-heals on next mutation

    // Rule 5: strict discriminant, no loose property checks
    if (node.type === "tab") {
      return <TabItemNode key={node.id} node={node} depth={depth} />;
    }

    const effectiveNode =
      isSearching && node.isCollapsed ? { ...node, isCollapsed: false } : node;

    return (
      <TabGroupNode
        key={node.id}
        node={effectiveNode}
        depth={depth}
        renderChild={(childId, childDepth) => renderNode(childId, childDepth)}
      />
    );
  };

  return (
    <div className={`tab-engine-panel${settings.compactView ? " is-compact" : ""}`}>
      <div className="tab-engine-toolbar">
        <div className="tab-engine-search">
          <ObsidianIcon name="search" />
          <input
            type="text"
            placeholder="Search tabs and groups…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery.length > 0 && (
            <button
              type="button"
              className="tab-engine-search-clear clickable-icon"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
            >
              <ObsidianIcon name="x" />
            </button>
          )}
        </div>
        <button
          type="button"
          className="tab-engine-new-group clickable-icon"
          onClick={handleNewGroup}
          aria-label="New group"
          title="New group"
        >
          <ObsidianIcon name="folder-plus" />
        </button>
      </div>

      <div className="tab-engine-tree-root">
        {safeRootIds.length === 0 ? (
          <div className="tab-engine-empty-state">
            <p>No open tabs yet.</p>
            <p className="tab-engine-empty-hint">
              Open a file, canvas, or view and it will appear here automatically.
            </p>
          </div>
        ) : (
          safeRootIds.map((id) => renderNode(id, 0))
        )}
      </div>
    </div>
  );
}
