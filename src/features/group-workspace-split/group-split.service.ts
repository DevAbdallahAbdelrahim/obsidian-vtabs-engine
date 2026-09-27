import { App, Notice, WorkspaceLeaf, TFile } from "obsidian";
import type TabEnginePlugin from "../../main";
import { useTabStore, getLeafFilePath } from "../../store/tab-store";
import {
  CustomTreeNode,
  TabNode,
  isGroupNode,
  isTabNode,
} from "../../types/tree";
import {
  SplitOptions,
  AttachedTabEntry,
  DetachedTabEntry,
  TabActionOutcome,
  ToggleGroupSplitOutcome,
} from "./group-split.types";

const DEFAULT_OPTIONS: Required<SplitOptions> = {
  direction: "vertical",
  before: false,
  focusFirstLeaf: true,
};

export function computeIsGroupOpen(
  nodes: Record<string, CustomTreeNode>,
  groupId: string,
): boolean {
  const group = nodes[groupId];
  if (!group || !isGroupNode(group)) return false;

  const childrenIds = Array.isArray(group.childrenIds) ? group.childrenIds : [];
  for (const childId of childrenIds) {
    const child = nodes[childId];
    if (child?.type === "tab" && child.leaf && getLeafFilePath(child.leaf)) {
      return true;
    }
  }
  return false;
}

export class GroupSplitService {
  private static pendingGroupIds = new Set<string>();
  private static managedContainers = new WeakSet<WorkspaceLeaf["parent"]>();

  // ── Public API ────────────────────────────────────────────────────────────

  static async toggleGroupSplit(
    groupId: string,
    plugin: TabEnginePlugin,
    options?: SplitOptions,
  ): Promise<ToggleGroupSplitOutcome> {
    if (GroupSplitService.pendingGroupIds.has(groupId)) {
      return "busy";
    }
    GroupSplitService.pendingGroupIds.add(groupId);

    try {
      if (GroupSplitService.isGroupOpen(groupId)) {
        return GroupSplitService.close(groupId, plugin);
      }

      return await GroupSplitService.open(groupId, plugin, {
        ...DEFAULT_OPTIONS,
        ...options,
      });
    } finally {
      GroupSplitService.pendingGroupIds.delete(groupId);
    }
  }

  /**
   * ميزة جديدة: التبديل وإظهار/إخفاء تاب منفرد
   */
  static async toggleSingleTab(
    nodeId: string,
    plugin: TabEnginePlugin,
  ): Promise<void> {
    const { nodes, detachTab, restoreTab } = useTabStore.getState();
    const node = nodes[nodeId];
    if (!node || !isTabNode(node)) return;

    if (node.leaf && !node.detached) {
      // إخفاء التاب المفرد
      const filePath = getLeafFilePath(node.leaf) ?? node.filePath;
      if (!filePath) return;
      const container = node.leaf.parent;
      const viewState = node.leaf.getViewState();

      detachTab(node.id, filePath, viewState);
      node.leaf.detach();

      if (plugin.settings.autoCollapseManagedSplits && container) {
        const remaining: WorkspaceLeaf[] = [];
        plugin.app.workspace.iterateAllLeaves((l: WorkspaceLeaf) => {
          if (l.parent === container) remaining.push(l);
        });
        if (
          remaining.length === 1 &&
          remaining[0].getViewState().type === "empty"
        ) {
          remaining[0].detach();
        }
      }
    } else if (node.filePath) {
      // إعادة إظهار التاب المفرد
      const leaf = plugin.app.workspace.getLeaf("tab");
      const file = plugin.app.vault.getAbstractFileByPath(node.filePath);
      if (file && file instanceof TFile) {
        await leaf.openFile(file);
        if (node.viewState) {
          await leaf.setViewState(node.viewState);
        }
        restoreTab(node.id, leaf);
        plugin.app.workspace.setActiveLeaf(leaf, { focus: true });
      }
    }
  }

  static isGroupOpen(groupId: string): boolean {
    const { nodes } = useTabStore.getState();
    return computeIsGroupOpen(nodes, groupId);
  }

  // ── Close ─────────────────────────────────────────────────────────────────

  private static close(
    groupId: string,
    plugin: TabEnginePlugin,
  ): ToggleGroupSplitOutcome {
    const { nodes } = useTabStore.getState();
    const group = nodes[groupId];
    if (!group || !isGroupNode(group)) {
      new Notice("TabEngine: that group no longer exists.");
      return "not-found";
    }

    const attached = GroupSplitService.collectAttached(nodes, groupId);
    if (attached.length === 0) return "closed";

    const containersInvolved = new Set<WorkspaceLeaf["parent"]>();
    for (const entry of attached) containersInvolved.add(entry.leaf.parent);
    const totalPerContainer = new Map<WorkspaceLeaf["parent"], number>();
    plugin.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
      if (containersInvolved.has(leaf.parent)) {
        totalPerContainer.set(
          leaf.parent,
          (totalPerContainer.get(leaf.parent) ?? 0) + 1,
        );
      }
    });

    const outcomes: TabActionOutcome[] = [];
    const removedPerContainer = new Map<WorkspaceLeaf["parent"], number>();
    let skippedNoFile = 0;

    for (const entry of attached) {
      const filePath = getLeafFilePath(entry.leaf);
      if (!filePath) {
        skippedNoFile++;
        continue;
      }

      const container = entry.leaf.parent;
      try {
        const viewState = entry.leaf.getViewState();
        useTabStore.getState().detachTab(entry.nodeId, filePath, viewState);
        entry.leaf.detach();
        removedPerContainer.set(
          container,
          (removedPerContainer.get(container) ?? 0) + 1,
        );
        outcomes.push({
          nodeId: entry.nodeId,
          title: entry.title,
          success: true,
        });
      } catch (err) {
        outcomes.push({
          nodeId: entry.nodeId,
          title: entry.title,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    GroupSplitService.cleanupContainers(
      plugin,
      totalPerContainer,
      removedPerContainer,
    );
    GroupSplitService.reportOutcome(
      "closed",
      group.title,
      outcomes,
      skippedNoFile,
    );
    return "closed";
  }

  private static cleanupContainers(
    plugin: TabEnginePlugin,
    totalPerContainer: Map<WorkspaceLeaf["parent"], number>,
    removedPerContainer: Map<WorkspaceLeaf["parent"], number>,
  ): void {
    const MAX_FILLER_ROUNDS = 4;
    const autoCollapseManaged =
      plugin.settings.autoCollapseManagedSplits === true;

    for (const [container, total] of totalPerContainer) {
      const removed = removedPerContainer.get(container) ?? 0;
      const provenVacated = removed === total;
      const isManaged = GroupSplitService.managedContainers.has(container);

      if (!provenVacated && !(isManaged && autoCollapseManaged)) continue;

      for (let round = 0; round < MAX_FILLER_ROUNDS; round++) {
        const remaining: WorkspaceLeaf[] = [];
        plugin.app.workspace.iterateAllLeaves((leaf: WorkspaceLeaf) => {
          if (leaf.parent === container) remaining.push(leaf);
        });
        if (remaining.length === 0) break;
        for (const leaf of remaining) leaf.detach();
      }
    }
  }

  // ── Open ──────────────────────────────────────────────────────────────────

  private static async open(
    groupId: string,
    plugin: TabEnginePlugin,
    opts: Required<SplitOptions>,
  ): Promise<ToggleGroupSplitOutcome> {
    const { nodes } = useTabStore.getState();
    const group = nodes[groupId];

    if (!group || !isGroupNode(group)) {
      new Notice("TabEngine: that group no longer exists.");
      return "not-found";
    }

    const detached = GroupSplitService.collectDetached(nodes, groupId);
    if (detached.length === 0) {
      new Notice(`TabEngine: "${group.title}" has nothing hidden to restore.`);
      return "empty";
    }

    const outcomes = await GroupSplitService.populateSplit(
      plugin.app,
      detached,
      opts,
    );
    GroupSplitService.reportOutcome("opened", group.title, outcomes, 0);
    return "opened";
  }

  private static collectAttached(
    nodes: Record<string, CustomTreeNode>,
    groupId: string,
  ): AttachedTabEntry[] {
    const entries: AttachedTabEntry[] = [];
    const group = nodes[groupId];
    if (!group || !isGroupNode(group)) return entries;

    const childrenIds = Array.isArray(group.childrenIds)
      ? group.childrenIds
      : [];
    for (const childId of childrenIds) {
      const child = nodes[childId];
      if (!child || !isTabNode(child)) continue;
      if (child.leaf) {
        entries.push({
          nodeId: child.id,
          title: child.title,
          leaf: child.leaf,
        });
      }
    }
    return entries;
  }

  private static collectDetached(
    nodes: Record<string, CustomTreeNode>,
    groupId: string,
  ): DetachedTabEntry[] {
    const entries: DetachedTabEntry[] = [];
    const group = nodes[groupId];
    if (!group || !isGroupNode(group)) return entries;

    const childrenIds = Array.isArray(group.childrenIds)
      ? group.childrenIds
      : [];
    for (const childId of childrenIds) {
      const child = nodes[childId] as TabNode | undefined;
      if (!child || !isTabNode(child)) continue;
      if (child.detached && child.filePath && child.viewState) {
        entries.push({
          nodeId: child.id,
          title: child.title,
          filePath: child.filePath,
          viewState: child.viewState,
        });
      }
    }
    return entries;
  }

  private static async populateSplit(
    app: App,
    detached: DetachedTabEntry[],
    opts: Required<SplitOptions>,
  ): Promise<TabActionOutcome[]> {
    const outcomes: TabActionOutcome[] = [];
    let hostLeaf: WorkspaceLeaf | null = null;

    const referenceLeaf =
      app.workspace.getMostRecentLeaf() ?? app.workspace.getLeaf(false);

    for (const entry of detached) {
      const isNewSplit = hostLeaf === null;
      const targetLeaf: WorkspaceLeaf = hostLeaf
        ? await app.workspace.duplicateLeaf(hostLeaf, "tab")
        : app.workspace.createLeafBySplit(
            referenceLeaf,
            opts.direction,
            opts.before,
          );

      if (isNewSplit) {
        GroupSplitService.managedContainers.add(targetLeaf.parent);
      }

      try {
        await targetLeaf.setViewState(entry.viewState);
        useTabStore.getState().restoreTab(entry.nodeId, targetLeaf);

        outcomes.push({
          nodeId: entry.nodeId,
          title: entry.title,
          success: true,
        });
        if (!hostLeaf) hostLeaf = targetLeaf;
      } catch (err) {
        targetLeaf.detach();
        outcomes.push({
          nodeId: entry.nodeId,
          title: entry.title,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (hostLeaf && opts.focusFirstLeaf) {
      app.workspace.setActiveLeaf(hostLeaf, { focus: true });
    }

    return outcomes;
  }

  private static reportOutcome(
    action: "opened" | "closed",
    groupTitle: string,
    outcomes: TabActionOutcome[],
    skippedNoFile: number,
  ): void {
    const failures = outcomes.filter((o) => !o.success);
    const verb = action === "opened" ? "restored" : "hid";

    if (failures.length === 0 && skippedNoFile === 0) {
      new Notice(`TabEngine: ${verb} "${groupTitle}".`);
      return;
    }

    const parts: string[] = [];
    if (failures.length > 0) {
      parts.push(
        `${failures.length} of ${outcomes.length + skippedNoFile} tab(s) failed`,
      );
    }
    if (skippedNoFile > 0) {
      parts.push(`${skippedNoFile} tab(s) left open (nothing to track)`);
    }
    new Notice(`TabEngine: ${verb} "${groupTitle}" — ${parts.join(", ")}.`);

    if (failures.length > 0) {
      console.warn("[TabEngine] GroupSplitService outcome:", failures);
    }
  }
}
