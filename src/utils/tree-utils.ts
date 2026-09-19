import { CustomTreeNode, GroupNode } from "../types/tree";
import { EMPTY_ARRAY } from "../store/tab-store";

// ─── Sibling Lookup (drag-to-reorder) ──────────────────────────────────────────
// Formerly engine/tree-utils.ts.

/**
 * Returns the ordered list of sibling IDs (including `nodeId` itself) that a
 * node currently lives among — either a parent group's childrenIds, or the
 * tree's rootIds when the node has no parent.
 *
 * Used by drag-and-drop "drop on a tab" reordering (see TabItemNode.tsx) to
 * compute an insertion index without duplicating tree-walk logic.
 *
 * Rule 2: every array access is guarded with Array.isArray().
 * Reference Stability: every empty-array branch returns the same
 * module-scoped EMPTY_ARRAY constant from the store, never a fresh `[]`.
 */
export function getSiblingIds(
  nodes: Record<string, CustomTreeNode>,
  rootIds: string[],
  nodeId: string
): readonly string[] {
  const node = nodes[nodeId];
  if (!node) return EMPTY_ARRAY;

  if (node.parentId !== null) {
    const parent = nodes[node.parentId];
    if (parent?.type === "group") {
      const childrenIds = (parent as GroupNode).childrenIds;
      return Array.isArray(childrenIds) ? childrenIds : EMPTY_ARRAY;
    }
  }

  return Array.isArray(rootIds) ? rootIds : EMPTY_ARRAY;
}

// ─── Search Filter (VirtualTabList) ────────────────────────────────────────────
// Formerly engine/search-engine.ts — consolidated here since that file is no
// longer part of the project's structure. The two `Array.isArray(...) ? x : []`
// fallbacks below were upgraded to the shared EMPTY_ARRAY constant above for
// consistency with getSiblingIds now that both live in the same module.

/**
 * Performs a Depth-First traversal of the tree, returning a Set of node IDs
 * that should be rendered when `query` is active.
 *
 * Rules:
 * - A TabNode is visible if its title contains the query (case-insensitive).
 * - A GroupNode is visible if its own title matches OR any descendant matches.
 *   This keeps ancestor groups in view so matched tabs aren't orphaned.
 * - Returns an empty Set for a blank query — callers treat that as "no filter".
 *
 * Rule 2 enforced: every childrenIds access is guarded by Array.isArray().
 */
export function filterTree(
  nodes: Record<string, CustomTreeNode>,
  rootIds: string[],
  query: string
): Set<string> {
  const q = query.trim().toLowerCase();
  if (!q) return new Set<string>();

  const visible = new Set<string>();

  function matchesQuery(node: CustomTreeNode): boolean {
    return node.title.toLowerCase().includes(q);
  }

  // Returns true if this node or any of its descendants matched.
  function dfs(nodeId: string): boolean {
    const node = nodes[nodeId];
    if (!node) return false;

    // Rule 5: strict discriminant checks
    if (node.type === "tab") {
      const matched = matchesQuery(node);
      if (matched) visible.add(nodeId);
      return matched;
    }

    if (node.type === "group") {
      const groupNode = node as GroupNode;
      // Rule 2: guard before iterating childrenIds
      const childrenIds = Array.isArray(groupNode.childrenIds)
        ? groupNode.childrenIds
        : EMPTY_ARRAY;

      let anyDescendantVisible = false;
      for (const childId of childrenIds) {
        if (dfs(childId)) anyDescendantVisible = true;
      }

      // Group is visible if its name matches OR a child matched
      if (anyDescendantVisible || matchesQuery(groupNode)) {
        visible.add(nodeId);
        return true;
      }
      return false;
    }

    return false;
  }

  // Rule 2: guard rootIds before iterating
  const safeRootIds = Array.isArray(rootIds) ? rootIds : EMPTY_ARRAY;
  for (const rootId of safeRootIds) {
    dfs(rootId);
  }

  return visible;
}

// ─── Visibility Helper ────────────────────────────────────────────────────────

/**
 * Returns true if a node should be rendered given the current filter state.
 *
 * @param visibleIds  null  = no filter active (show everything)
 *                    Set   = filter is active (only show IDs in the set)
 */
export function isNodeVisible(
  nodeId: string,
  visibleIds: Set<string> | null
): boolean {
  if (visibleIds === null) return true;
  return visibleIds.has(nodeId);
}
