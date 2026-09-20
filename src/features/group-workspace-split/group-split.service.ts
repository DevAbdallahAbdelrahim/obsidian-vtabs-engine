import { App, Notice, WorkspaceLeaf, WorkspaceSplit } from "obsidian";
import { useTabStore } from "../../store/tab-store";
import { CustomTreeNode, isGroupNode, isTabNode } from "../../types/tree";
import {
  SplitOptions,
  CollectedLeafEntry,
  PopulateOutcome,
  OpenGroupInSplitOutcome,
} from "./group-split.types";

const DEFAULT_OPTIONS: Required<SplitOptions> = {
  direction: "vertical",
  before: false,
  focusFirstLeaf: true,
};

/**
 * GroupSplitService — "Focus View" for a manual group.
 *
 * Reads the Zustand tree read-only (via the store's already-public
 * `getState()`) to recursively collect every tab beneath a group, then opens
 * that content into one new adjacent Workspace split, stacked as tabs.
 *
 * Zero Core Pollution: this file is the ONLY place that knows this feature
 * exists. `tab-store.ts`, `persistence.ts`, and `main.ts` are untouched and
 * have no awareness of "group split" as a concept — the store's existing
 * `nodes` read surface and the `isGroupNode`/`isTabNode` guards already
 * exported from `types/tree.ts` are all this service needs.
 *
 * Design choice, stated explicitly: this OPENS FRESH LEAVES carrying the
 * same view state as each source tab — it does not relocate the original
 * WorkspaceLeaf objects. Obsidian's public plugin API has no supported way
 * to reparent an already-open leaf into a different split; `getViewState()`
 * + `setViewState()` is the documented, view-type-agnostic way to reopen a
 * leaf's content elsewhere (Markdown, Canvas, Graph, Bases, PDF — anything),
 * and it satisfies "no orphan leaves elsewhere" by construction: the
 * originals are left exactly where the user already has them, pinned or not.
 */
export class GroupSplitService {
  /**
   * Opens every tab belonging to `groupId` (recursively, including nested
   * subgroups) into one new adjacent split, stacked together as tabs.
   *
   * Exits cleanly with a Notice, doing nothing further, if the group id no
   * longer resolves to a group, or the group (recursively) has no tabs.
   */
  static async openGroupInSplit(
    groupId: string,
    app: App,
    options?: SplitOptions
  ): Promise<void> {
    const opts: Required<SplitOptions> = { ...DEFAULT_OPTIONS, ...options };

    const { nodes } = useTabStore.getState();
    const group = nodes[groupId];

    if (!group || !isGroupNode(group)) {
      new Notice("TabEngine: that group no longer exists.");
      return;
    }

    const collected = GroupSplitService.collectLeaves(nodes, groupId);

    if (collected.length === 0) {
      new Notice(`TabEngine: "${group.title}" has no open tabs to focus.`);
      return;
    }

    const outcome = await GroupSplitService.populateSplit(app, groupId, collected, opts);
    GroupSplitService.reportOutcome(group.title, outcome);
  }

  // ── Collection (pure, store-read-only) ────────────────────────────────────

  /**
   * Recursively walks `groupId`'s childrenIds, collecting every TabNode's
   * live leaf — including tabs inside nested subgroups, at any depth.
   * Skips TabNodes with no live leaf bound yet (e.g. mid-hydration, before
   * syncLeaves() has run) rather than crashing on them.
   */
  private static collectLeaves(
    nodes: Record<string, CustomTreeNode>,
    groupId: string
  ): CollectedLeafEntry[] {
    const entries: CollectedLeafEntry[] = [];
    const group = nodes[groupId];
    if (!group || !isGroupNode(group)) return entries;

    // Defensive guard, matching the project-wide convention: never iterate
    // a possibly-malformed array without checking it first.
    const childrenIds = Array.isArray(group.childrenIds) ? group.childrenIds : [];

    for (const childId of childrenIds) {
      const child = nodes[childId];
      if (!child) continue;

      if (isTabNode(child)) {
        if (child.leaf) {
          entries.push({ nodeId: child.id, title: child.title, sourceLeaf: child.leaf });
        }
        // else: tab exists in the tree but has no live leaf bound yet —
        // skip silently rather than surface a confusing partial-failure
        // Notice for something the user didn't cause.
        continue;
      }

      if (isGroupNode(child)) {
        // Recurse into nested subgroups — "including nested children" per spec.
        entries.push(...GroupSplitService.collectLeaves(nodes, child.id));
      }
    }

    return entries;
  }

  // ── Population (the only part that touches app.workspace) ─────────────────

  /**
   * Creates one new adjacent split and opens every collected leaf's content
   * into it — the first successful one via `createLeafBySplit()`, every
   * subsequent one stacked as an additional tab in the SAME split via
   * `createLeafInParent()`.
   *
   * `WorkspaceLeaf.parent` is officially typed `WorkspaceTabs |
   * WorkspaceMobileDrawer` (Obsidian's own docs: "perform an instanceof
   * check before making an assumption about the parent"). `WorkspaceTabs`
   * satisfies `WorkspaceSplit`; `WorkspaceMobileDrawer` (mobile) does not —
   * when it doesn't, each remaining tab falls back to getting its own
   * adjacent split rather than crashing or silently dropping it.
   *
   * Leaf creation itself (`createLeafBySplit`/`createLeafInParent`) is
   * treated as an effectively-infallible structural workspace operation.
   * The realistic failure point is `setViewState()` — an unregistered or
   * misbehaving view type for one specific tab. That call alone is wrapped
   * per-leaf: on failure the just-created (now-blank) leaf is detached
   * immediately rather than left behind as an orphaned, broken pane, the
   * failure is recorded, and the loop continues with the rest of the group.
   */
  private static async populateSplit(
    app: App,
    groupId: string,
    collected: CollectedLeafEntry[],
    opts: Required<SplitOptions>
  ): Promise<OpenGroupInSplitOutcome> {
    const outcomes: PopulateOutcome[] = [];
    let firstLeaf: WorkspaceLeaf | null = null;
    let hostSplit: WorkspaceSplit | null = null;

    // Split relative to the most recently active leaf — NOT
    // app.workspace.activeLeaf, which Obsidian's own docs say to avoid
    // touching directly. Falls back to getLeaf(false) (get-or-create any
    // usable leaf) if nothing is open yet.
    const referenceLeaf = app.workspace.getMostRecentLeaf() ?? app.workspace.getLeaf(false);

    for (let i = 0; i < collected.length; i++) {
      const entry = collected[i];

      const targetLeaf: WorkspaceLeaf = hostSplit
        ? app.workspace.createLeafInParent(hostSplit, i)
        : app.workspace.createLeafBySplit(referenceLeaf, opts.direction, opts.before);

      if (!hostSplit) {
        hostSplit = targetLeaf.parent instanceof WorkspaceSplit ? targetLeaf.parent : null;
      }

      try {
        const viewState = entry.sourceLeaf.getViewState();
        await targetLeaf.setViewState(viewState);
        if (!firstLeaf) firstLeaf = targetLeaf;
        outcomes.push({ nodeId: entry.nodeId, title: entry.title, success: true });
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

    if (firstLeaf && opts.focusFirstLeaf) {
      app.workspace.setActiveLeaf(firstLeaf, { focus: true });
    }

    return { groupId, outcomes, firstLeaf };
  }

  // ── Reporting ───────────────────────────────────────────────────────────────

  private static reportOutcome(groupTitle: string, outcome: OpenGroupInSplitOutcome): void {
    const failures = outcome.outcomes.filter((o) => !o.success);

    if (failures.length === 0) {
      new Notice(`TabEngine: opened "${groupTitle}" in a new split.`);
      return;
    }

    new Notice(
      `TabEngine: opened "${groupTitle}" (${failures.length} of ${outcome.outcomes.length} tab(s) failed — see console).`
    );
    console.warn("[TabEngine] GroupSplitService population failures:", failures);
  }
}
