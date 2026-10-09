import { App, Notice, WorkspaceLeaf } from "obsidian";
import type TabEnginePlugin from "../../main";
import { useTabStore, getLeafFilePath } from "../../store/tab-store";
import { safeDetach, safeSetActiveLeaf } from "../../utils/focus-guards";
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

/**
 * Pure form of the open/closed check[cite: 12].
 */
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

/**
 * GroupSplitService — manages group tab visibility and splitting[cite: 12].
 */
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
        return await GroupSplitService.close(groupId, plugin);
      }

      return await GroupSplitService.open(groupId, plugin, {
        ...DEFAULT_OPTIONS,
        ...options,
      });
    } finally {
      GroupSplitService.pendingGroupIds.delete(groupId);
    }
  }

  static isGroupOpen(groupId: string): boolean {
    const { nodes } = useTabStore.getState();
    return computeIsGroupOpen(nodes, groupId);
  }

  private static pendingNodeIds = new Set<string>();

  static async toggleSingleTab(
    nodeId: string,
    plugin: TabEnginePlugin,
  ): Promise<void> {
    if (GroupSplitService.pendingNodeIds.has(nodeId)) return;
    GroupSplitService.pendingNodeIds.add(nodeId);

    try {
      const { nodes } = useTabStore.getState();
      const node = nodes[nodeId];
      if (!node || node.type !== "tab") {
        new Notice("TabEngine: that tab no longer exists.");
        return;
      }

      if (node.leaf && !node.detached) {
        const filePath = getLeafFilePath(node.leaf);
        if (!filePath) {
          new Notice(
            `TabEngine: "${node.title}" can't be hidden (nothing to restore it from).`,
          );
          return;
        }

        const leaf = node.leaf;
        const leavesBefore = new Set<WorkspaceLeaf>();
        plugin.app.workspace.iterateAllLeaves((l) => leavesBefore.add(l));

        const viewState = leaf.getViewState();
        useTabStore.getState().detachTab(nodeId, filePath, viewState);
        safeDetach(leaf);

        await GroupSplitService.cleanupFillerLeaves(plugin, leavesBefore);
        new Notice(`TabEngine: hid "${node.title}".`);
        return;
      }

      if (node.detached && node.filePath && node.viewState) {
        const referenceLeaf =
          plugin.app.workspace.getMostRecentLeaf() ??
          plugin.app.workspace.getLeaf(false);
        const targetLeaf = plugin.app.workspace.createLeafBySplit(
          referenceLeaf,
          "vertical",
          false,
        );
        GroupSplitService.managedContainers.add(targetLeaf.parent);

        try {
          await targetLeaf.setViewState(node.viewState);
          useTabStore.getState().restoreTab(nodeId, targetLeaf);
          safeSetActiveLeaf(plugin.app, targetLeaf, { focus: true });
          new Notice(`TabEngine: restored "${node.title}".`);
        } catch (err) {
          safeDetach(targetLeaf);
          new Notice(`TabEngine: couldn't restore "${node.title}".`);
          console.warn("[TabEngine] toggleSingleTab restore failure:", err);
        }
        return;
      }

      new Notice(`TabEngine: "${node.title}" has nothing to toggle.`);
    } finally {
      GroupSplitService.pendingNodeIds.delete(nodeId);
    }
  }

  // ── Close ─────────────────────────────────────────────────────────────────

  private static async close(
    groupId: string,
    plugin: TabEnginePlugin,
  ): Promise<ToggleGroupSplitOutcome> {
    const { nodes } = useTabStore.getState();
    const group = nodes[groupId];
    if (!group || !isGroupNode(group)) {
      new Notice("TabEngine: that group no longer exists.");
      return "not-found";
    }

    const attached = GroupSplitService.collectAttached(nodes, groupId);
    if (attached.length === 0) return "closed";

    const leavesBefore = new Set<WorkspaceLeaf>();
    plugin.app.workspace.iterateAllLeaves((leaf) => leavesBefore.add(leaf));

    const outcomes: TabActionOutcome[] = [];
    let skippedNoFile = 0;

    for (const entry of attached) {
      const filePath = getLeafFilePath(entry.leaf);
      if (!filePath) {
        skippedNoFile++;
        continue;
      }

      try {
        const viewState = entry.leaf.getViewState();
        useTabStore.getState().detachTab(entry.nodeId, filePath, viewState);
        safeDetach(entry.leaf);
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

    await GroupSplitService.cleanupFillerLeaves(plugin, leavesBefore);

    GroupSplitService.reportOutcome(
      "closed",
      group.title,
      outcomes,
      skippedNoFile,
    );
    return "closed";
  }

  private static nextFrame(): Promise<void> {
    return new Promise((resolve) =>
      window.requestAnimationFrame(() => resolve()),
    );
  }

  private static async cleanupFillerLeaves(
    plugin: TabEnginePlugin,
    leavesBefore: Set<WorkspaceLeaf>,
  ): Promise<void> {
    const MAX_ROUNDS = 4;
    for (let round = 0; round < MAX_ROUNDS; round++) {
      await GroupSplitService.nextFrame();
      const filler: WorkspaceLeaf[] = [];
      plugin.app.workspace.iterateAllLeaves((leaf) => {
        if (leavesBefore.has(leaf)) return;
        if (GroupSplitService.isEmptyViewLeaf(leaf)) filler.push(leaf);
      });
      if (filler.length === 0) break;
      for (const leaf of filler) safeDetach(leaf);
    }
  }

  private static isEmptyViewLeaf(leaf: WorkspaceLeaf): boolean {
    try {
      return leaf.getViewState()?.type === "empty";
    } catch {
      return false;
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

  // ── Collection (pure, store-read-only) ─────────────────────────────────────

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

  // ── Population ─────────────────────────────────────────────────────────────

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
        safeDetach(targetLeaf);
        outcomes.push({
          nodeId: entry.nodeId,
          title: entry.title,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (hostLeaf && opts.focusFirstLeaf) {
      safeSetActiveLeaf(app, hostLeaf, { focus: true });
    }

    return outcomes;
  }

  // ── Reporting ───────────────────────────────────────────────────────────────

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
