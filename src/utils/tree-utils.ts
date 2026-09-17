import { CustomTreeNode, GroupNode } from "../types/tree";
import { EMPTY_ARRAY } from "../store/tab-store";

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
