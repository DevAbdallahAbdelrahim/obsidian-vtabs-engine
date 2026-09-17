import { create } from "zustand";
import { WorkspaceLeaf } from "obsidian";
import {
  CustomTreeNode,
  TabNode,
  GroupNode,
  SerializedTreeState,
} from "../types/tree";
import {
  generateId,
  serializeTreeState,
  deserializeTreeState,
  validateTreeIntegrity,
} from "./persistence";

// ─── Reference-Stable Empty Fallbacks ────────────────────────────────────────
// Module-scoped constants prevent selector-driven infinite re-renders.
// Selectors that could return [] MUST use these instead of creating new arrays.
export const EMPTY_ARRAY: readonly string[] = Object.freeze([]);
export const EMPTY_NODES: Readonly<Record<string, never>> = Object.freeze({});

// ─── WorkspaceLeaf Accessors ──────────────────────────────────────────────────
// Obsidian's `leaf.id` is not officially typed; access it via intersection cast.
type LeafWithId = WorkspaceLeaf & { id: string };

function getLeafId(leaf: WorkspaceLeaf): string {
  return (leaf as LeafWithId).id ?? "";
}

function safeGetLeafTitle(leaf: WorkspaceLeaf): string {
  try {
    const text = leaf.getDisplayText();
    return text?.trim() ? text : "Untitled";
  } catch {
    return "Untitled";
  }
}

function safeGetViewType(leaf: WorkspaceLeaf): string {
  try {
    return leaf.view?.getViewType() ?? "unknown";
  } catch {
    return "unknown";
  }
}

// ─── Pure Helper — Remove a Node From Its Current Position ───────────────────
// Accepts and returns plain state slices; never touches Zustand's set/get.
// This keeps moveNode, removeTab, and deleteGroup DRY while staying immutable.
function removeNodeFromParent(
  nodeId: string,
  nodes: Record<string, CustomTreeNode>,
  rootIds: string[]
): { nodes: Record<string, CustomTreeNode>; rootIds: string[] } {
  const node = nodes[nodeId];
  if (!node) return { nodes, rootIds };

  // New nodes map — shallow copy so we can mutate safely
  const newNodes: Record<string, CustomTreeNode> = { ...nodes };
  const parentId = node.parentId;

  if (parentId !== null && newNodes[parentId]?.type === "group") {
    // Rule 3: spread parent to produce a new reference
    const parent = newNodes[parentId] as GroupNode;
    newNodes[parentId] = {
      ...parent,
      childrenIds: parent.childrenIds.filter((id) => id !== nodeId),
    };
    return { nodes: newNodes, rootIds };
  }

  // Node is at root — filter produces a new array (immutable, Rule 3)
  return {
    nodes: newNodes,
    rootIds: rootIds.filter((id) => id !== nodeId),
  };
}

// ─── Store Interface ──────────────────────────────────────────────────────────

export interface TabStoreState {
  // ── Persistent (synced to data.json via savedTreeState) ──────────────────
  nodes: Record<string, CustomTreeNode>;
  rootIds: string[];

  // ── Ephemeral runtime (never persisted) ──────────────────────────────────
  activeLeafId: string | null;
  searchQuery: string;
  _saveCallback: (() => void) | null;

  // ── Setup ─────────────────────────────────────────────────────────────────
  /** Register the plugin's debounced save function. Call once in onload(). */
  setSaveCallback: (cb: () => void) => void;

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  /**
   * Loads saved group structures and tab metadata from data.json into the store.
   * TabNode.leaf fields remain undefined until syncLeaves() runs.
   * Called once at plugin startup, before workspace layout is ready.
   */
  hydrateStore: (savedState: SerializedTreeState) => void;

  /**
   * Reconciles the store's TabNodes with the list of currently-open WorkspaceLeaves.
   * - Binds live leaves to existing TabNodes by leafId.
   * - Creates new root TabNodes for leaves that aren't in the store yet.
   * - Removes TabNodes for leaves that have been closed.
   * Triggers a debounced save only when the tree structure actually changed.
   */
  syncLeaves: (leaves: WorkspaceLeaf[]) => void;

  // ── Tree Mutations — Rule 1: every mutation MUST trigger _triggerSave() ──

  /**
   * Creates a new GroupNode and inserts it at the end of the target parent
   * (or at root level if parentId is null/undefined).
   * @returns The new group's ID.
   */
  createGroup: (title: string, parentId?: string | null) => string;

  /** Renames any node (tab or group) by ID. */
  renameNode: (id: string, title: string) => void;

  /**
   * Moves any node to a new parent (or root) at a specific index.
   * targetIndex is relative to the target parent's children AFTER the
   * dragged node has been removed — consistent with HTML5 DnD semantics.
   */
  moveNode: (
    nodeId: string,
    targetParentId: string | null,
    targetIndex?: number
  ) => void;

  /** Toggles a group's isCollapsed state. */
  toggleCollapse: (groupId: string) => void;

  /**
   * Deletes a group, promoting all its direct children one level up
   * (into the group's parent, or root). Tabs are preserved.
   */
  deleteGroup: (groupId: string) => void;

  /**
   * Removes a tab from the store AND detaches its WorkspaceLeaf
   * from Obsidian's workspace (closes the tab in the UI).
   */
  removeTab: (tabId: string) => void;

  /** Sets a custom Lucide icon override on any node. */
  setNodeIcon: (id: string, icon: string) => void;

  /** Sets a CSS accent color override on any node. */
  setNodeColor: (id: string, color: string) => void;

  // ── Runtime — no persistence trigger ─────────────────────────────────────

  /** Updates which leaf is currently focused. Driven by active-leaf-change events. */
  setActiveLeaf: (leafId: string | null) => void;

  /** Updates the search query for real-time tree filtering. */
  setSearchQuery: (query: string) => void;

  /**
   * Re-binds a live WorkspaceLeaf to a TabNode without triggering full syncLeaves().
   * Used by the active-leaf-change event handler to keep titles current.
   */
  updateLeafBinding: (leafId: string, leaf: WorkspaceLeaf) => void;

  // ── Serialization ─────────────────────────────────────────────────────────

  /** Produces the data.json-safe snapshot of the current tree state. */
  getSerializedState: () => SerializedTreeState;

  // ── Internal ──────────────────────────────────────────────────────────────
  /** Fires the registered save callback. Called at the end of every mutation. */
  _triggerSave: () => void;
}

// ─── Store Implementation ─────────────────────────────────────────────────────

export const useTabStore = create<TabStoreState>()((set, get) => ({
  // ── Initial State ──────────────────────────────────────────────────────────
  nodes: {},
  rootIds: [],
  activeLeafId: null,
  searchQuery: "",
  _saveCallback: null,

  // ── Setup ──────────────────────────────────────────────────────────────────
  setSaveCallback: (cb) => set({ _saveCallback: cb }),

  // ── Internal ──────────────────────────────────────────────────────────────
  _triggerSave: () => {
    // Safe call — noop if callback hasn't been registered yet
    get()._saveCallback?.();
  },

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  hydrateStore: (savedState) => {
    const { nodes, rootIds } = deserializeTreeState(savedState);

    // Log any referential integrity warnings — do NOT throw; continue with what we have
    const warnings = validateTreeIntegrity(nodes, rootIds);
    if (warnings.length > 0) {
      console.warn(
        `[TabEngine] Tree integrity warnings on hydration (${warnings.length}):\n` +
          warnings.map((w) => `  • ${w}`).join("\n")
      );
    }

    set({ nodes, rootIds });
  },

  syncLeaves: (leaves) => {
    const { nodes, rootIds } = get();

    // Work on copies — never mutate the current Zustand state directly (Rule 3)
    const newNodes: Record<string, CustomTreeNode> = { ...nodes };
    const newRootIds: string[] = [...rootIds];
    let structurallyChanged = false;

    // ── Phase 1: Build a fast leafId → nodeId reverse-lookup ──────────────
    const leafIdToNodeId = new Map<string, string>();
    for (const [id, node] of Object.entries(newNodes)) {
      if (node.type === "tab") {
        leafIdToNodeId.set((node as TabNode).leafId, id);
      }
    }

    // ── Phase 2: Walk every live leaf ─────────────────────────────────────
    const openLeafIds = new Set<string>();

    for (const leaf of leaves) {
      const leafId = getLeafId(leaf);
      if (!leafId) continue; // Skip leaves without an ID (defensive)
      openLeafIds.add(leafId);

      if (leafIdToNodeId.has(leafId)) {
        // ── Existing node: bind the live leaf + refresh derived fields ──
        const nodeId = leafIdToNodeId.get(leafId)!;
        const existing = newNodes[nodeId] as TabNode;
        const freshTitle = safeGetLeafTitle(leaf);
        const freshViewType = safeGetViewType(leaf);

        // Always update the leaf reference (ephemeral — no save needed for this alone).
        // Only flag as structurally changed when persisted fields differ.
        if (existing.title !== freshTitle || existing.viewType !== freshViewType) {
          structurallyChanged = true;
        }

        // Produce a new object reference (Rule 3)
        newNodes[nodeId] = {
          ...existing,
          leaf,
          title: freshTitle,
          viewType: freshViewType,
        };
      } else {
        // ── New leaf: create a root-level TabNode ──────────────────────
        const newId = generateId();
        const newTab: TabNode = {
          id: newId,
          type: "tab",
          title: safeGetLeafTitle(leaf),
          leafId,
          leaf,
          viewType: safeGetViewType(leaf),
          parentId: null,
        };
        newNodes[newId] = newTab;
        newRootIds.push(newId);
        leafIdToNodeId.set(leafId, newId);
        structurallyChanged = true;
      }
    }

    // ── Phase 3: Collect stale TabNodes (leaves that are no longer open) ──
    // Collect IDs first, then delete — avoids mid-iteration mutation.
    const toRemove: string[] = [];
    for (const [id, node] of Object.entries(newNodes)) {
      if (node.type === "tab" && !openLeafIds.has((node as TabNode).leafId)) {
        toRemove.push(id);
      }
    }

    // ── Phase 4: Remove stale nodes from the tree ─────────────────────────
    for (const removeId of toRemove) {
      const staleTab = newNodes[removeId] as TabNode;
      const parentId = staleTab.parentId;

      if (parentId !== null && newNodes[parentId]?.type === "group") {
        // Remove from parent group's childrenIds (Rule 3: spread to new ref)
        const parent = newNodes[parentId] as GroupNode;
        newNodes[parentId] = {
          ...parent,
          childrenIds: parent.childrenIds.filter((cid) => cid !== removeId),
        };
      } else {
        // Remove from rootIds
        const idx = newRootIds.indexOf(removeId);
        if (idx !== -1) newRootIds.splice(idx, 1);
      }

      delete newNodes[removeId];
      structurallyChanged = true;
    }

    // Commit in a single set call to prevent intermediate renders
    set({ nodes: newNodes, rootIds: newRootIds });

    // Only persist when the structure actually changed — prevents noisy writes
    if (structurallyChanged) {
      get()._triggerSave();
    }
  },

  // ── Tree Mutations ─────────────────────────────────────────────────────────

  createGroup: (title, parentId = null) => {
    const { nodes, rootIds } = get();
    const id = generateId();

    const newGroup: GroupNode = {
      id,
      type: "group",
      title,
      parentId: parentId ?? null,
      childrenIds: [],
      isCollapsed: false,
    };

    // Start from a spread copy of nodes (Rule 3)
    const newNodes: Record<string, CustomTreeNode> = { ...nodes, [id]: newGroup };
    const newRootIds = [...rootIds];

    if (parentId !== null && nodes[parentId]?.type === "group") {
      // Append to end of parent group
      const parent = nodes[parentId] as GroupNode;
      newNodes[parentId] = {
        ...parent,
        childrenIds: [...parent.childrenIds, id],
      };
    } else {
      // Append to root level
      newRootIds.push(id);
    }

    set({ nodes: newNodes, rootIds: newRootIds });
    get()._triggerSave(); // Rule 1
    return id;
  },

  renameNode: (id, title) => {
    const { nodes } = get();
    const node = nodes[id];
    if (!node) return;

    // Rule 3: spread both the nodes map and the specific node
    set({
      nodes: {
        ...nodes,
        [id]: { ...node, title },
      },
    });
    get()._triggerSave(); // Rule 1
  },

  moveNode: (nodeId, targetParentId, targetIndex) => {
    const { nodes, rootIds } = get();
    const node = nodes[nodeId];
    if (!node) return;

    // Step 1: Remove from current position, get immutable copies back
    const { nodes: nodesAfterRemove, rootIds: rootIdsAfterRemove } =
      removeNodeFromParent(nodeId, nodes, rootIds);

    // Step 2: Update the node's parentId (Rule 3: new object ref)
    const newNodes: Record<string, CustomTreeNode> = {
      ...nodesAfterRemove,
      [nodeId]: { ...node, parentId: targetParentId },
    };
    const newRootIds = [...rootIdsAfterRemove];

    // Step 3: Insert into the new position
    if (targetParentId !== null && newNodes[targetParentId]?.type === "group") {
      const parent = newNodes[targetParentId] as GroupNode;
      const newChildren = [...parent.childrenIds];
      const insertAt =
        targetIndex !== undefined
          ? Math.min(targetIndex, newChildren.length)
          : newChildren.length;
      newChildren.splice(insertAt, 0, nodeId);
      // Rule 3: new parent reference with new children array
      newNodes[targetParentId] = { ...parent, childrenIds: newChildren };
    } else {
      const insertAt =
        targetIndex !== undefined
          ? Math.min(targetIndex, newRootIds.length)
          : newRootIds.length;
      newRootIds.splice(insertAt, 0, nodeId);
    }

    set({ nodes: newNodes, rootIds: newRootIds });
    get()._triggerSave(); // Rule 1
  },

  toggleCollapse: (groupId) => {
    const { nodes } = get();
    const node = nodes[groupId];
    // Rule 5: strict type narrowing
    if (!node || node.type !== "group") return;

    const group = node as GroupNode;
    // Rule 3: new object reference for both the map and the group
    set({
      nodes: {
        ...nodes,
        [groupId]: { ...group, isCollapsed: !group.isCollapsed },
      },
    });
    get()._triggerSave(); // Rule 1
  },

  deleteGroup: (groupId) => {
    const { nodes, rootIds } = get();
    const node = nodes[groupId];
    // Rule 5: strict type narrowing
    if (!node || node.type !== "group") return;

    const group = node as GroupNode;
    // Rule 2: defensive Array.isArray guard before operating on childrenIds
    const childrenIds: string[] = Array.isArray(group.childrenIds)
      ? [...group.childrenIds]
      : [];
    const parentId = group.parentId;

    const newNodes: Record<string, CustomTreeNode> = { ...nodes };
    const newRootIds = [...rootIds];

    // Re-parent every direct child to the group's own parent (one level up)
    for (const childId of childrenIds) {
      if (newNodes[childId]) {
        // Rule 3: new object ref for each re-parented child
        newNodes[childId] = { ...newNodes[childId], parentId };
      }
    }

    // Splice the group out of its container, inserting children in its place
    if (parentId !== null && newNodes[parentId]?.type === "group") {
      const parent = newNodes[parentId] as GroupNode;
      const groupIdx = parent.childrenIds.indexOf(groupId);
      const newChildren = [
        ...parent.childrenIds.slice(0, Math.max(0, groupIdx)),
        ...childrenIds,
        ...parent.childrenIds.slice(groupIdx + 1),
      ];
      // Rule 3: new parent ref
      newNodes[parentId] = { ...parent, childrenIds: newChildren };
    } else {
      const groupIdx = newRootIds.indexOf(groupId);
      if (groupIdx !== -1) {
        // Replace the group ID with its children IDs in-place
        newRootIds.splice(groupIdx, 1, ...childrenIds);
      }
    }

    delete newNodes[groupId];

    set({ nodes: newNodes, rootIds: newRootIds });
    get()._triggerSave(); // Rule 1
  },

  removeTab: (tabId) => {
    const { nodes, rootIds } = get();
    const node = nodes[tabId];
    // Rule 5: strict type narrowing
    if (!node || node.type !== "tab") return;

    const tab = node as TabNode;

    // Detach the live leaf from Obsidian's workspace first (closes the editor pane)
    tab.leaf?.detach();

    const newNodes: Record<string, CustomTreeNode> = { ...nodes };
    const newRootIds = [...rootIds];

    if (tab.parentId !== null && newNodes[tab.parentId]?.type === "group") {
      const parent = newNodes[tab.parentId] as GroupNode;
      // Rule 3: new parent ref with filtered children
      newNodes[tab.parentId] = {
        ...parent,
        childrenIds: parent.childrenIds.filter((id) => id !== tabId),
      };
    } else {
      const idx = newRootIds.indexOf(tabId);
      if (idx !== -1) newRootIds.splice(idx, 1);
    }

    delete newNodes[tabId];

    set({ nodes: newNodes, rootIds: newRootIds });
    get()._triggerSave(); // Rule 1
  },

  setNodeIcon: (id, icon) => {
    const { nodes } = get();
    const node = nodes[id];
    if (!node) return;
    // Rule 3: two levels of spread
    set({ nodes: { ...nodes, [id]: { ...node, icon } } });
    get()._triggerSave(); // Rule 1
  },

  setNodeColor: (id, color) => {
    const { nodes } = get();
    const node = nodes[id];
    if (!node) return;
    // Rule 3: two levels of spread
    set({ nodes: { ...nodes, [id]: { ...node, color } } });
    get()._triggerSave(); // Rule 1
  },

  // ── Runtime Mutations (no save trigger) ───────────────────────────────────

  setActiveLeaf: (leafId) => set({ activeLeafId: leafId }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  updateLeafBinding: (leafId, leaf) => {
    const { nodes } = get();

    // O(n) scan — acceptable since this runs only on active-leaf-change events
    for (const [id, node] of Object.entries(nodes)) {
      if (node.type === "tab" && (node as TabNode).leafId === leafId) {
        const tab = node as TabNode;
        // Rule 3: new object ref
        set({
          nodes: {
            ...nodes,
            [id]: {
              ...tab,
              leaf,
              title: safeGetLeafTitle(leaf),
              viewType: safeGetViewType(leaf),
            },
          },
        });
        return; // Match found — stop iterating
      }
    }
  },

  // ── Serialization ──────────────────────────────────────────────────────────

  getSerializedState: () => {
    const { nodes, rootIds } = get();
    return serializeTreeState(nodes, rootIds);
  },
}));

// ─── Selector Helpers ─────────────────────────────────────────────────────────
// Pre-built selectors that return the module-scoped EMPTY_ARRAY fallback
// so components that consume them do not get a new [] reference on every render.

/** Returns a group's childrenIds, or EMPTY_ARRAY if the node is missing/not a group. */
export function selectChildrenIds(
  nodes: Record<string, CustomTreeNode>,
  groupId: string
): readonly string[] {
  const node = nodes[groupId];
  if (!node || node.type !== "group") return EMPTY_ARRAY;
  // Rule 2: Array.isArray guard before returning
  return Array.isArray((node as GroupNode).childrenIds)
    ? (node as GroupNode).childrenIds
    : EMPTY_ARRAY;
}

/** Returns rootIds, or EMPTY_ARRAY if the store is empty. */
export function selectRootIds(rootIds: string[]): readonly string[] {
  return Array.isArray(rootIds) && rootIds.length > 0 ? rootIds : EMPTY_ARRAY;
}
