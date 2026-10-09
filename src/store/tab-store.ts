import { create } from "zustand";
import { WorkspaceLeaf, Notice, ViewState } from "obsidian";
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
} from "../utils/persistence";

// ─── Reference-Stable Empty Fallbacks ────────────────────────────────────────
export const EMPTY_ARRAY: readonly string[] = Object.freeze([]);
export const EMPTY_NODES: Readonly<Record<string, never>> = Object.freeze({});

// ─── WorkspaceLeaf Accessors ──────────────────────────────────────────────────
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

export function getLeafFilePath(leaf: WorkspaceLeaf): string | null {
  try {
    const state = leaf.getViewState()?.state;
    const file =
      state && typeof state === "object"
        ? (state as Record<string, unknown>).file
        : undefined;
    return typeof file === "string" && file.length > 0 ? file : null;
  } catch {
    return null;
  }
}

// ─── Pure Helper — Remove a Node From Its Current Position ───────────────────
function removeNodeFromParent(
  nodeId: string,
  nodes: Record<string, CustomTreeNode>,
  rootIds: string[],
): { nodes: Record<string, CustomTreeNode>; rootIds: string[] } {
  const node = nodes[nodeId];
  if (!node) return { nodes, rootIds };

  const newNodes: Record<string, CustomTreeNode> = { ...nodes };
  const parentId = node.parentId;

  if (parentId !== null && newNodes[parentId]?.type === "group") {
    const parent = newNodes[parentId] as GroupNode;
    newNodes[parentId] = {
      ...parent,
      childrenIds: parent.childrenIds.filter((id) => id !== nodeId),
    };
    return { nodes: newNodes, rootIds };
  }

  return {
    nodes: newNodes,
    rootIds: rootIds.filter((id) => id !== nodeId),
  };
}

// ─── Store Interface ──────────────────────────────────────────────────────────

export interface TabStoreState {
  nodes: Record<string, CustomTreeNode>;
  rootIds: string[];
  activeLeafId: string | null;
  searchQuery: string;
  _saveCallback: (() => void) | null;

  setSaveCallback: (cb: () => void) => void;
  hydrateStore: (savedState: SerializedTreeState) => void;
  syncLeaves: (leaves: WorkspaceLeaf[]) => void;
  createGroup: (title: string, parentId?: string | null) => string;
  renameNode: (id: string, title: string) => void;
  moveNode: (
    nodeId: string,
    targetParentId: string | null,
    targetIndex?: number,
  ) => void;
  toggleCollapse: (groupId: string) => void;
  deleteGroup: (groupId: string) => void;
  removeTab: (tabId: string) => void;
  setNodeIcon: (id: string, icon: string) => void;
  setNodeColor: (id: string, color: string) => void;
  detachTab: (id: string, filePath: string, viewState: ViewState) => void;
  restoreTab: (id: string, leaf: WorkspaceLeaf) => void;
  setActiveLeaf: (leafId: string | null) => void;
  setSearchQuery: (query: string) => void;
  updateLeafBinding: (leafId: string, leaf: WorkspaceLeaf) => void;
  getSerializedState: () => SerializedTreeState;
  _triggerSave: () => void;
}

// ─── Store Implementation ─────────────────────────────────────────────────────

export const useTabStore = create<TabStoreState>()((set, get) => ({
  nodes: {},
  rootIds: [],
  activeLeafId: null,
  searchQuery: "",
  _saveCallback: null,

  setSaveCallback: (cb) => set({ _saveCallback: cb }),

  _triggerSave: () => {
    get()._saveCallback?.();
  },

  hydrateStore: (savedState) => {
    const { nodes, rootIds } = deserializeTreeState(savedState);
    const warnings = validateTreeIntegrity(nodes, rootIds);
    if (warnings.length > 0) {
      console.warn(
        `[TabEngine] Tree integrity warnings on hydration (${warnings.length}):\n` +
          warnings.map((w: string) => `  • ${w}`).join("\n"),
      );
    }
    set({ nodes, rootIds });
  },

  syncLeaves: (leaves) => {
    const { nodes, rootIds } = get();
    const newNodes: Record<string, CustomTreeNode> = { ...nodes };
    const newRootIds: string[] = [...rootIds];
    let structurallyChanged = false;

    const leafIdToNodeId = new Map<string, string>();
    for (const [id, node] of Object.entries(newNodes)) {
      if (node.type === "tab") {
        leafIdToNodeId.set((node as TabNode).leafId, id);
      }
    }

    const openLeafIds = new Set<string>();

    for (const leaf of leaves) {
      const leafId = getLeafId(leaf);
      if (!leafId) continue;
      openLeafIds.add(leafId);

      if (leafIdToNodeId.has(leafId)) {
        const nodeId = leafIdToNodeId.get(leafId)!;
        const existing = newNodes[nodeId] as TabNode;
        const freshTitle = safeGetLeafTitle(leaf);
        const freshViewType = safeGetViewType(leaf);

        if (
          existing.title !== freshTitle ||
          existing.viewType !== freshViewType
        ) {
          structurallyChanged = true;
        }

        newNodes[nodeId] = {
          ...existing,
          leaf,
          title: freshTitle,
          viewType: freshViewType,
        };
      } else {
        const filePath = getLeafFilePath(leaf);
        const detachedMatch = filePath
          ? (Object.values(newNodes).find(
              (n): n is TabNode =>
                n.type === "tab" &&
                (n as TabNode).detached === true &&
                (n as TabNode).filePath === filePath,
            ) as TabNode | undefined)
          : undefined;

        if (detachedMatch) {
          const freshTitle = safeGetLeafTitle(leaf);
          newNodes[detachedMatch.id] = {
            ...detachedMatch,
            leaf,
            leafId,
            title: freshTitle,
            viewType: safeGetViewType(leaf),
            detached: false,
            filePath: undefined,
            viewState: undefined,
          };
          leafIdToNodeId.delete(detachedMatch.leafId);
          leafIdToNodeId.set(leafId, detachedMatch.id);
          structurallyChanged = true;

          const parent =
            detachedMatch.parentId !== null
              ? newNodes[detachedMatch.parentId]
              : null;
          new Notice(
            parent?.type === "group"
              ? `TabEngine: Opened "${freshTitle}", tracked in group "${parent.title}".`
              : `TabEngine: Opened "${freshTitle}", restored to its tracked tab.`,
          );
        } else {
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
    }

    const toRemove: string[] = [];
    for (const [id, node] of Object.entries(newNodes)) {
      if (
        node.type === "tab" &&
        !(node as TabNode).detached &&
        !openLeafIds.has((node as TabNode).leafId)
      ) {
        toRemove.push(id);
      }
    }

    for (const removeId of toRemove) {
      const staleTab = newNodes[removeId] as TabNode;
      const parentId = staleTab.parentId;

      if (parentId !== null && newNodes[parentId]?.type === "group") {
        const parent = newNodes[parentId] as GroupNode;
        newNodes[parentId] = {
          ...parent,
          childrenIds: parent.childrenIds.filter((cid) => cid !== removeId),
        };
      } else {
        const idx = newRootIds.indexOf(removeId);
        if (idx !== -1) newRootIds.splice(idx, 1);
      }

      delete newNodes[removeId];
      structurallyChanged = true;
    }

    set({ nodes: newNodes, rootIds: newRootIds });

    if (structurallyChanged) {
      get()._triggerSave();
    }
  },

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

    const newNodes: Record<string, CustomTreeNode> = {
      ...nodes,
      [id]: newGroup,
    };
    const newRootIds = [...rootIds];

    if (parentId !== null && nodes[parentId]?.type === "group") {
      const parent = nodes[parentId] as GroupNode;
      newNodes[parentId] = {
        ...parent,
        childrenIds: [...parent.childrenIds, id],
      };
    } else {
      newRootIds.push(id);
    }

    set({ nodes: newNodes, rootIds: newRootIds });
    get()._triggerSave();
    return id;
  },

  renameNode: (id, title) => {
    const { nodes } = get();
    const node = nodes[id];
    if (!node) return;

    set({
      nodes: {
        ...nodes,
        [id]: { ...node, title },
      },
    });
    get()._triggerSave();
  },

  moveNode: (nodeId, targetParentId, targetIndex) => {
    const { nodes, rootIds } = get();
    const node = nodes[nodeId];
    if (!node) return;

    // حظر الحلقات الدائرية
    if (node.type === "group" && targetParentId !== null) {
      let currentParentId: string | null = targetParentId;
      while (currentParentId !== null) {
        if (currentParentId === nodeId) return;
        currentParentId = nodes[currentParentId]?.parentId ?? null;
      }
    }

    const sourceParentId = node.parentId;
    let adjustedTargetIndex = targetIndex;

    // تصحيح زحزحة الفهرس عند إعادة الترتيب ضمن نفس المستوى
    if (
      sourceParentId === targetParentId &&
      adjustedTargetIndex !== undefined
    ) {
      const siblings =
        sourceParentId !== null && nodes[sourceParentId]?.type === "group"
          ? (nodes[sourceParentId] as GroupNode).childrenIds
          : rootIds;

      const currentIndex = siblings.indexOf(nodeId);
      if (currentIndex !== -1 && currentIndex < adjustedTargetIndex) {
        adjustedTargetIndex -= 1;
      }
    }

    const { nodes: nodesAfterRemove, rootIds: rootIdsAfterRemove } =
      removeNodeFromParent(nodeId, nodes, rootIds);

    const newNodes: Record<string, CustomTreeNode> = {
      ...nodesAfterRemove,
      [nodeId]: { ...node, parentId: targetParentId },
    };
    const newRootIds = [...rootIdsAfterRemove];

    if (targetParentId !== null && newNodes[targetParentId]?.type === "group") {
      const parent = newNodes[targetParentId] as GroupNode;
      const newChildren = [...parent.childrenIds];
      const insertAt =
        adjustedTargetIndex !== undefined
          ? Math.max(0, Math.min(adjustedTargetIndex, newChildren.length))
          : newChildren.length;

      newChildren.splice(insertAt, 0, nodeId);
      newNodes[targetParentId] = { ...parent, childrenIds: newChildren };
    } else {
      const insertAt =
        adjustedTargetIndex !== undefined
          ? Math.max(0, Math.min(adjustedTargetIndex, newRootIds.length))
          : newRootIds.length;

      newRootIds.splice(insertAt, 0, nodeId);
    }

    set({ nodes: newNodes, rootIds: newRootIds });
    get()._triggerSave();
  },

  toggleCollapse: (groupId) => {
    const { nodes } = get();
    const node = nodes[groupId];
    if (!node || node.type !== "group") return;

    const group = node as GroupNode;
    set({
      nodes: {
        ...nodes,
        [groupId]: { ...group, isCollapsed: !group.isCollapsed },
      },
    });
    get()._triggerSave();
  },

  deleteGroup: (groupId) => {
    const { nodes, rootIds } = get();
    const node = nodes[groupId];
    if (!node || node.type !== "group") return;

    const group = node as GroupNode;
    const childrenIds: string[] = Array.isArray(group.childrenIds)
      ? [...group.childrenIds]
      : [];
    const parentId = group.parentId;

    const newNodes: Record<string, CustomTreeNode> = { ...nodes };
    const newRootIds = [...rootIds];

    for (const childId of childrenIds) {
      if (newNodes[childId]) {
        newNodes[childId] = { ...newNodes[childId], parentId };
      }
    }

    if (parentId !== null && newNodes[parentId]?.type === "group") {
      const parent = newNodes[parentId] as GroupNode;
      const groupIdx = parent.childrenIds.indexOf(groupId);
      const newChildren = [
        ...parent.childrenIds.slice(0, Math.max(0, groupIdx)),
        ...childrenIds,
        ...parent.childrenIds.slice(groupIdx + 1),
      ];
      newNodes[parentId] = { ...parent, childrenIds: newChildren };
    } else {
      const groupIdx = newRootIds.indexOf(groupId);
      if (groupIdx !== -1) {
        newRootIds.splice(groupIdx, 1, ...childrenIds);
      }
    }

    delete newNodes[groupId];

    set({ nodes: newNodes, rootIds: newRootIds });
    get()._triggerSave();
  },

  removeTab: (tabId) => {
    const { nodes, rootIds } = get();
    const node = nodes[tabId];
    if (!node || node.type !== "tab") return;

    const tab = node as TabNode;
    tab.leaf?.detach();

    const newNodes: Record<string, CustomTreeNode> = { ...nodes };
    const newRootIds = [...rootIds];

    if (tab.parentId !== null && newNodes[tab.parentId]?.type === "group") {
      const parent = newNodes[tab.parentId] as GroupNode;
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
    get()._triggerSave();
  },

  setNodeIcon: (id, icon) => {
    const { nodes } = get();
    const node = nodes[id];
    if (!node) return;
    set({ nodes: { ...nodes, [id]: { ...node, icon } } });
    get()._triggerSave();
  },

  setNodeColor: (id, color) => {
    const { nodes } = get();
    const node = nodes[id];
    if (!node) return;
    set({ nodes: { ...nodes, [id]: { ...node, color } } });
    get()._triggerSave();
  },

  detachTab: (id, filePath, viewState) => {
    const { nodes } = get();
    const node = nodes[id];
    if (!node || node.type !== "tab") return;
    set({
      nodes: {
        ...nodes,
        [id]: {
          ...node,
          leaf: undefined,
          detached: true,
          filePath,
          viewState,
        },
      },
    });
    get()._triggerSave();
  },

  restoreTab: (id, leaf) => {
    const { nodes } = get();
    const node = nodes[id];
    if (!node || node.type !== "tab") return;
    set({
      nodes: {
        ...nodes,
        [id]: {
          ...node,
          leaf,
          leafId: getLeafId(leaf),
          title: safeGetLeafTitle(leaf),
          viewType: safeGetViewType(leaf),
          detached: false,
          filePath: undefined,
          viewState: undefined,
        },
      },
    });
    get()._triggerSave();
  },

  setActiveLeaf: (leafId) => set({ activeLeafId: leafId }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  updateLeafBinding: (leafId, leaf) => {
    const { nodes } = get();

    for (const [id, node] of Object.entries(nodes)) {
      if (node.type === "tab" && (node as TabNode).leafId === leafId) {
        const tab = node as TabNode;
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
        return;
      }
    }
  },

  getSerializedState: () => {
    const { nodes, rootIds } = get();
    return serializeTreeState(nodes, rootIds);
  },
}));

export function selectChildrenIds(
  nodes: Record<string, CustomTreeNode>,
  groupId: string,
): readonly string[] {
  const node = nodes[groupId];
  if (!node || node.type !== "group") return EMPTY_ARRAY;
  return Array.isArray((node as GroupNode).childrenIds)
    ? (node as GroupNode).childrenIds
    : EMPTY_ARRAY;
}

export function selectRootIds(rootIds: string[]): readonly string[] {
  return Array.isArray(rootIds) && rootIds.length > 0 ? rootIds : EMPTY_ARRAY;
}
