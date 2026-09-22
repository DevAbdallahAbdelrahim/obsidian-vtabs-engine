import { App, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { useTabStore, getLeafFilePath } from "../../store/tab-store";
import { CustomTreeNode, TabNode, isGroupNode, isTabNode } from "../../types/tree";
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
 * GroupSplitService — "Focus View" toggle for a manual group's tabs.
 *
 * There are no ephemeral or duplicate leaves in this design — every leaf
 * this service ever touches is a tab's own real, permanent leaf. Hiding a
 * tab (close()) detaches its actual leaf and hands its filePath/viewState
 * to tab-store's detachTab(), which keeps the TabNode in the tree with
 * detached: true rather than deleting it. Showing it again (open())
 * creates a fresh leaf from that saved state and hands it to tab-store's
 * restoreTab(), which re-binds it to the SAME TabNode. Open/closed state
 * isn't tracked here at all — it's just whatever tab-store's nodes already
 * say (child.leaf present = live), so there's nothing to keep in sync.
 *
 * A group's live tabs can be scattered anywhere the user put them — there's
 * no more dedicated "the split" they all live in until they're hidden — so
 * closing a group can touch more than one pane; container cleanup runs once
 * per distinct pane actually touched, not once overall.
 *
 * Views with no backing file (graph, search, etc.) can't be tracked or
 * restored, so they're excluded from the open/closed decision entirely and
 * left untouched by close() — otherwise a group containing even one such
 * tab would permanently read as "open" and could never be restored via the
 * toggle again.
 */
export class GroupSplitService {
  /**
   * Re-entrancy guard only — prevents a second toggle for the SAME groupId
   * from starting while that group's own open()/close() is still running.
   */
  private static pendingGroupIds = new Set<string>();

  // ── Public API ────────────────────────────────────────────────────────────

  static async toggleGroupSplit(
    groupId: string,
    plugin: Plugin,
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
   * True if at least one of groupId's direct child tabs is a file-backed
   * view that's currently live. Read straight from tab-store — no
   * workspace scan needed, since child.leaf IS the live/hidden signal,
   * kept current by syncLeaves() on every layout-change. Non-file-backed
   * children are deliberately excluded (see class docs) so they can never
   * pin a group's toggle permanently "open".
   */
  static isGroupOpen(groupId: string): boolean {
    const { nodes } = useTabStore.getState();
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

  // ── Close ─────────────────────────────────────────────────────────────────

  private static close(groupId: string, plugin: Plugin): ToggleGroupSplitOutcome {
    const { nodes } = useTabStore.getState();
    const group = nodes[groupId];
    if (!group || !isGroupNode(group)) {
      new Notice("TabEngine: that group no longer exists.");
      return "not-found";
    }

    const attached = GroupSplitService.collectAttached(nodes, groupId);
    if (attached.length === 0) return "closed"; // defensive — see isGroupOpen's guarantee

    const outcomes: TabActionOutcome[] = [];
    const containersTouched = new Set<WorkspaceLeaf["parent"]>();
    let skippedNoFile = 0;

    for (const entry of attached) {
      const filePath = getLeafFilePath(entry.leaf);
      if (!filePath) {
        // No stable file identity to restore from later — leave this one
        // live rather than lose track of it. Never detach what we can't
        // safely bring back.
        skippedNoFile++;
        continue;
      }

      try {
        const viewState = entry.leaf.getViewState();
        containersTouched.add(entry.leaf.parent);
        useTabStore.getState().detachTab(entry.nodeId, filePath, viewState);
        entry.leaf.detach();
        outcomes.push({ nodeId: entry.nodeId, title: entry.title, success: true });
      } catch (err) {
        outcomes.push({
          nodeId: entry.nodeId,
          title: entry.title,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    GroupSplitService.cleanupOrphanedContainers(plugin, containersTouched);
    GroupSplitService.reportOutcome("closed", group.title, outcomes, skippedNoFile);
    return "closed";
  }

  /**
   * Obsidian won't leave a pane region with zero leaves in it — the instant
   * the last leaf in a container is detached, it fills the gap with a
   * fresh leaf of its own (typically the empty/"Home" view). Any leaf found
   * in a container we JUST vacated, right after our own detach, can only be
   * that filler — nothing else could have legitimately landed there in the
   * same synchronous call. Repeats per container (capped) in case filling
   * the gap itself cascades.
   */
  private static cleanupOrphanedContainers(
    plugin: Plugin,
    containers: Set<WorkspaceLeaf["parent"]>,
  ): void {
    const MAX_FILLER_ROUNDS = 4;
    for (const container of containers) {
      for (let round = 0; round < MAX_FILLER_ROUNDS; round++) {
        const filler: WorkspaceLeaf[] = [];
        plugin.app.workspace.iterateAllLeaves((leaf) => {
          if (leaf.parent === container) filler.push(leaf);
        });
        if (filler.length === 0) break;
        for (const leaf of filler) leaf.detach();
      }
    }
  }

  // ── Open ──────────────────────────────────────────────────────────────────

  private static async open(
    groupId: string,
    plugin: Plugin,
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

    const outcomes = await GroupSplitService.populateSplit(plugin.app, detached, opts);
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

    const childrenIds = Array.isArray(group.childrenIds) ? group.childrenIds : [];
    for (const childId of childrenIds) {
      const child = nodes[childId];
      if (!child || !isTabNode(child)) continue;
      if (child.leaf) {
        entries.push({ nodeId: child.id, title: child.title, leaf: child.leaf });
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

    const childrenIds = Array.isArray(group.childrenIds) ? group.childrenIds : [];
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

  /**
   * Restores a batch of detached tabs into one new split. The first
   * successful leaf opens the split (createLeafBySplit); every one after
   * it is stacked into that SAME split via duplicateLeaf(hostLeaf, "tab") —
   * still the only reliable way to place a new leaf into a specific
   * existing tab group, since createLeafInParent needs a WorkspaceSplit and
   * a leaf's parent is always a WorkspaceTabs. What's different from the
   * old ephemeral design: the leaf duplicateLeaf() produces here isn't a
   * disposable copy sitting alongside a live original — restoreTab()
   * immediately adopts it as that TabNode's own real, permanent leaf, so
   * there's nothing ephemeral left to tag or track separately.
   */
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
      const targetLeaf: WorkspaceLeaf = hostLeaf
        ? await app.workspace.duplicateLeaf(hostLeaf, "tab")
        : app.workspace.createLeafBySplit(
            referenceLeaf,
            opts.direction,
            opts.before,
          );

      try {
        await targetLeaf.setViewState(entry.viewState);
        useTabStore.getState().restoreTab(entry.nodeId, targetLeaf);

        outcomes.push({ nodeId: entry.nodeId, title: entry.title, success: true });
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
      parts.push(`${failures.length} of ${outcomes.length + skippedNoFile} tab(s) failed`);
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
