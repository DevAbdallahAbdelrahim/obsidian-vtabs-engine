import { Plugin, WorkspaceLeaf } from "obsidian";
import { useTabStore, getLeafFilePath } from "../../store/tab-store";
import {
  safeDetach,
  focusGuardActive,
  getActiveLeaf,
} from "../../utils/focus-guards";

/**
 * Closes duplicate leaves showing the same file, keeping exactly one.
 *
 * Deliberately excludes any leaf that's the current tracked binding for a
 * GROUPED TabNode (parentId !== null with a live .leaf). Restoring a
 * hidden group's tabs (GroupSplitService.open()/toggleSingleTab()) creates
 * a fresh leaf from saved state, which can legitimately show the same file
 * as some other, independently-opened leaf elsewhere — that's not user
 * error to silently "fix", and closing either side of it would fight with
 * a mechanism this service has no visibility into. Root-level (ungrouped)
 * duplicates are the actual target: the ordinary case of a link opened in
 * a new pane, or a file opened twice by hand.
 */
export class DeduplicationService {
  /**
   * Re-entrancy guard. Detaching a duplicate below fires layout-change,
   * which calls reconcile() again — potentially nested inside this call if
   * Obsidian dispatches that event synchronously. Same guard pattern
   * GroupSplitService uses (pendingGroupIds/pendingNodeIds) for the same
   * reason: a leaf closing is itself a layout change.
   */
  private static running = false;

  /**
   * Called from obsidian-events.ts on every layout-change, before
   * syncAllLeaves() runs — so by the time the tree reconciles, a
   * duplicate that's about to be closed is already gone rather than
   * briefly appearing as its own TabNode. That call site is where the
   * autoDeduplicateTabs setting is checked; this method itself is the
   * ungated operation, so anything that wants to run it on demand (a
   * command, say) isn't tied to the automatic-trigger setting.
   */
  static reconcile(plugin: Plugin): void {
    if (DeduplicationService.running) return;
    if (focusGuardActive(plugin.app)) return;

    DeduplicationService.running = true;
    try {
      const groupedLeaves = DeduplicationService.collectGroupedLeaves();
      const byFile = new Map<string, WorkspaceLeaf[]>();

      plugin.app.workspace.iterateAllLeaves((leaf) => {
        if (groupedLeaves.has(leaf)) return; // GroupSplitService owns these — never touch
        const filePath = getLeafFilePath(leaf);
        if (!filePath) return; // non-file views (graph, search, ...) are never deduplicated
        const existing = byFile.get(filePath);
        if (existing) {
          existing.push(leaf);
        } else {
          byFile.set(filePath, [leaf]);
        }
      });

      const activeLeaf = getActiveLeaf(plugin.app);
      for (const leaves of byFile.values()) {
        if (leaves.length < 2) continue;
        DeduplicationService.resolveGroup(leaves, activeLeaf);
      }
    } finally {
      DeduplicationService.running = false;
    }
  }

  private static collectGroupedLeaves(): Set<WorkspaceLeaf> {
    const { nodes } = useTabStore.getState();
    const grouped = new Set<WorkspaceLeaf>();
    for (const node of Object.values(nodes)) {
      if (node.type === "tab" && node.parentId !== null && node.leaf) {
        grouped.add(node.leaf);
      }
    }
    return grouped;
  }

  private static resolveGroup(
    leaves: WorkspaceLeaf[],
    activeLeaf: WorkspaceLeaf | null,
  ): void {
    const keep = DeduplicationService.pickLeafToKeep(leaves, activeLeaf);
    const toClose = leaves.filter((leaf) => leaf !== keep);

    // If the leaf being kept ISN'T the active one (e.g. a pinned duplicate
    // won out), the active duplicate about to close reflects the user's
    // most recent reading position — carry that onto the survivor via
    // Obsidian's own public ephemeral-state API. If we're keeping the
    // active leaf itself (the common case), its state is already current
    // and nothing needs to move.
    if (activeLeaf && activeLeaf !== keep && toClose.includes(activeLeaf)) {
      try {
        keep.setEphemeralState(activeLeaf.getEphemeralState());
      } catch {
        // Best-effort — never block closing a duplicate over this.
      }
    }

    for (const leaf of toClose) {
      safeDetach(leaf);
    }
  }

  /**
   * Keep priority: the active leaf first (whatever the user just navigated
   * to — including a heading/subpath jump — is already baked into its
   * current view state, so keeping it preserves that for free) > a pinned
   * leaf (getViewState().pinned, the same public field TabItemNode's own
   * pin/unpin menu item already reads) > whichever was found first.
   */
  private static pickLeafToKeep(
    leaves: WorkspaceLeaf[],
    activeLeaf: WorkspaceLeaf | null,
  ): WorkspaceLeaf {
    if (activeLeaf && leaves.includes(activeLeaf)) return activeLeaf;

    const pinned = leaves.find((leaf) => {
      try {
        return leaf.getViewState().pinned === true;
      } catch {
        return false;
      }
    });

    return pinned ?? leaves[0];
  }
}
