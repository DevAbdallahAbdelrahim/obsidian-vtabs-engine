import { App, Notice, WorkspaceLeaf } from "obsidian";
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

/**
 * Pure form of the open/closed check — given a nodes snapshot, true if at
 * least one of groupId's direct child tabs is a file-backed view that's
 * currently live. No store read of its own, so this is safe to call from
 * inside a Zustand selector (see GroupSplitButton.tsx) as well as from
 * GroupSplitService.isGroupOpen() below. Non-file-backed children are
 * deliberately excluded — see the class docs on GroupSplitService for why.
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

  /**
   * Containers (WorkspaceTabs/WorkspaceMobileDrawer) that VTab Engine
   * itself created via createLeafBySplit while restoring a group. Used
   * only to decide how far cleanupContainers() is allowed to go for a
   * container that wasn't fully vacated by us (see its docs) — never as a
   * record of what's currently open, which is what caused problems the
   * last time a WeakMap tried to double as open/closed state.
   */
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
    return computeIsGroupOpen(nodes, groupId);
  }

  /**
   * Re-entrancy guard for toggleSingleTab, mirroring pendingGroupIds — kept
   * as a separate set since a single-tab toggle and a group toggle can
   * legitimately run concurrently without conflicting with each other.
   */
  private static pendingNodeIds = new Set<string>();

  /**
   * Hides or restores exactly one tracked tab, independent of any group.
   * Uses the same detachTab()/restoreTab() survival mechanism as group
   * close()/open() — this works identically for a root-level standalone
   * tab or a grouped one, since neither the store actions nor syncLeaves'
   * staleness guard care about parentId.
   */
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
        leaf.detach();

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
          plugin.app.workspace.setActiveLeaf(targetLeaf, { focus: true });
          new Notice(`TabEngine: restored "${node.title}".`);
        } catch (err) {
          targetLeaf.detach();
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
    if (attached.length === 0) return "closed"; // defensive — see isGroupOpen's guarantee

    // Snapshot every live leaf before touching anything. close() never
    // awaits, so nothing else in the app can create a leaf while this
    // function runs — any leaf found afterward that wasn't in this set can
    // only be something Obsidian itself inserted as a direct consequence
    // of the detaches below. This replaces an earlier design that compared
    // leaf.parent against a captured container reference, which silently
    // failed to find anything whenever Obsidian replaced the container
    // object itself rather than reusing it.
    const leavesBefore = new Set<WorkspaceLeaf>();
    plugin.app.workspace.iterateAllLeaves((leaf) => leavesBefore.add(leaf));

    const containersTouched = new Set<WorkspaceLeaf["parent"]>();
    const outcomes: TabActionOutcome[] = [];
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

    if (plugin.settings.autoCollapseStandaloneSplits) {
      await GroupSplitService.collapseLoneStandaloneTabs(
        plugin,
        containersTouched,
        leavesBefore,
      );
    }

    await GroupSplitService.sweepOptedInManagedContainers(
      plugin,
      containersTouched,
    );

    GroupSplitService.reportOutcome(
      "closed",
      group.title,
      outcomes,
      skippedNoFile,
    );
    return "closed";
  }

  /**
   * Obsidian won't leave a pane region with zero leaves in it — the instant
   * the last leaf in a container is detached, it synchronously inserts a
   * fresh leaf of its own (the empty/"Home" view) to fill the gap. Any
   * leaf that's both NEW (absent from leavesBefore) and has an "empty"
   * view type is provably that filler — nothing else could have created a
   * leaf during this same synchronous call, and genuine content never has
   * an empty view type. Always runs, unconditionally: this only ever
   * removes leaves Obsidian itself just created, never anything the user
   * had open.
   */
  /**
   * Yields to the browser's paint cycle. Used before every filler check
   * below: the original design assumed Obsidian inserts its fallback
   * "empty" leaf synchronously, inside detach() itself. Reported behavior
   * (leaf.detach() succeeds, the tab's content disappears, but the pane
   * itself stays open) points to that insertion actually happening on a
   * deferred tick instead — checking immediately would see the container
   * still genuinely empty for a moment and correctly find "nothing to
   * clean up", right before Obsidian fills it a beat later with nothing
   * left to catch it. Waiting a frame first covers both cases: if the fill
   * is synchronous, this is a harmless extra tick; if it's deferred, this
   * is what makes detecting it possible at all.
   */
  private static nextFrame(): Promise<void> {
    return new Promise((resolve) =>
      window.requestAnimationFrame(() => resolve()),
    );
  }

  /**
   * Obsidian won't leave a pane region with zero leaves in it — at some
   * point after the last leaf in a container is detached, it inserts a
   * fresh leaf of its own (the empty/"Home" view) to fill the gap. Any
   * leaf that's both NEW (absent from leavesBefore) and has an "empty"
   * view type is provably that filler — nothing else creates a leaf as a
   * consequence of this call, and genuine content never has an empty view
   * type. Always runs, unconditionally: this only ever removes leaves
   * Obsidian itself just created, never anything the user had open.
   */
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
      for (const leaf of filler) leaf.detach();
    }
  }

  private static isEmptyViewLeaf(leaf: WorkspaceLeaf): boolean {
    try {
      return leaf.getViewState()?.type === "empty";
    } catch {
      return false;
    }
  }

  /**
   * autoCollapseStandaloneSplits: after the group's own tabs are hidden and
   * Obsidian's filler is cleared, a touched container might have exactly
   * one leaf left that isn't ours — a standalone (root-level, ungrouped)
   * tab that happened to share the pane. If so, and the setting is on,
   * hide that tab too, using the SAME detachTab()-backed survival every
   * other hidden tab gets, so it stays fully restorable (via its own
   * SingleTabSplitButton, or by reopening the file) rather than being
   * silently lost. Only ever acts when exactly one non-filler leaf
   * remains and it maps to a genuine tracked root-level TabNode — never a
   * blind sweep of "whatever's left". Runs after cleanupFillerLeaves has
   * already settled, so "what remains" here reflects Obsidian's actual
   * final state, not a snapshot taken before it finished reacting.
   */
  private static async collapseLoneStandaloneTabs(
    plugin: TabEnginePlugin,
    containersTouched: Set<WorkspaceLeaf["parent"]>,
    leavesBefore: Set<WorkspaceLeaf>,
  ): Promise<void> {
    for (const container of containersTouched) {
      const remaining: WorkspaceLeaf[] = [];
      plugin.app.workspace.iterateAllLeaves((leaf) => {
        if (leaf.parent === container) remaining.push(leaf);
      });
      if (remaining.length !== 1) continue;

      const soleLeaf = remaining[0];
      const { nodes } = useTabStore.getState();
      const match = Object.values(nodes).find(
        (n): n is TabNode =>
          n.type === "tab" && n.parentId === null && n.leaf === soleLeaf,
      );
      if (!match) continue; // not a tracked standalone tab — leave it alone

      const filePath = getLeafFilePath(soleLeaf);
      if (!filePath) continue; // nothing to restore from later — never hide it

      try {
        const viewState = soleLeaf.getViewState();
        useTabStore.getState().detachTab(match.id, filePath, viewState);
        soleLeaf.detach();
        // This tab's own detach can trigger a fresh round of Obsidian
        // filler in the same container — clean that up too.
        await GroupSplitService.cleanupFillerLeaves(plugin, leavesBefore);
      } catch {
        // Leave it live if anything goes wrong — never risk losing it.
      }
    }
  }

  /**
   * autoCollapseManagedSplits: for a container VTab Engine itself created
   * (managedContainers), if anything is STILL left after the baseline
   * filler cleanup and the standalone-tab pass above, it predates our
   * involvement or was added by the user afterward — genuine content, not
   * provably filler. Clearing it anyway is a deliberately more aggressive
   * behavior, so it only runs with explicit opt-in, and only for splits
   * this service owns.
   */
  private static async sweepOptedInManagedContainers(
    plugin: TabEnginePlugin,
    containersTouched: Set<WorkspaceLeaf["parent"]>,
  ): Promise<void> {
    if (!plugin.settings.autoCollapseManagedSplits) return;
    const MAX_ROUNDS = 4;

    for (const container of containersTouched) {
      if (!GroupSplitService.managedContainers.has(container)) continue;
      for (let round = 0; round < MAX_ROUNDS; round++) {
        await GroupSplitService.nextFrame();
        const remaining: WorkspaceLeaf[] = [];
        plugin.app.workspace.iterateAllLeaves((leaf) => {
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
