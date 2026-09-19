import { Plugin, WorkspaceLeaf } from "obsidian";
import { useTabStore } from "../store/tab-store";

type LeafWithId = WorkspaceLeaf & { id: string };

function getLeafId(leaf: WorkspaceLeaf): string {
  return (leaf as LeafWithId).id ?? "";
}

/**
 * Collects every currently-open WorkspaceLeaf across the whole workspace
 * tree (main area + sidebars) and hands them to the store's syncLeaves()
 * reconciler. Per Core Philosophy ("Manual-First"), TabEngine surfaces
 * everything rather than pre-filtering by pane — the user decides what to
 * manually organize.
 */
function collectAllLeaves(plugin: Plugin): WorkspaceLeaf[] {
  const leaves: WorkspaceLeaf[] = [];
  plugin.app.workspace.iterateAllLeaves((leaf) => {
    leaves.push(leaf);
  });
  return leaves;
}

/**
 * Runs a full leaf sync. Exported standalone (not just used internally by
 * registerWorkspaceEvents) so main.ts can also trigger a manual resync —
 * e.g. after the Settings tab's "Reset layout" action clears the tree and
 * needs open leaves re-appended as fresh root tabs.
 */
export function syncAllLeaves(plugin: Plugin): void {
  useTabStore.getState().syncLeaves(collectAllLeaves(plugin));
}

/**
 * Wires up every Obsidian workspace event TabEngine needs to keep its
 * Zustand tree in sync with live WorkspaceLeaf instances.
 *
 * Called once from TabEnginePlugin.onload(). All listeners are registered
 * via plugin.registerEvent(), so Obsidian automatically detaches them on
 * plugin unload — no manual cleanup required here.
 */
export function registerWorkspaceEvents(plugin: Plugin): void {
  // Initial sync: fires once Obsidian has restored the previous session's
  // leaves — the earliest safe point to bind saved TabNodes to their live
  // WorkspaceLeaf counterparts.
  plugin.app.workspace.onLayoutReady(() => syncAllLeaves(plugin));

  // Fires on nearly every structural change: split, tab open/close, move
  // between panes, sidebar toggle. syncLeaves() itself only persists when
  // something structural actually changed, so re-running it liberally here
  // is cheap.
  plugin.registerEvent(
    plugin.app.workspace.on("layout-change", () => syncAllLeaves(plugin)),
  );

  // Fires when focus moves to a different leaf — tracks the active tab for
  // highlighting, and refreshes that leaf's title/viewType immediately
  // rather than waiting for the next layout-change.
  plugin.registerEvent(
    plugin.app.workspace.on("active-leaf-change", (leaf) => {
      const store = useTabStore.getState();

      if (!leaf) {
        store.setActiveLeaf(null);
        return;
      }

      const leafId = getLeafId(leaf);
      store.setActiveLeaf(leafId || null);

      if (leafId) {
        store.updateLeafBinding(leafId, leaf);
      }
    }),
  );

  // File renames change a leaf's display text without necessarily firing
  // layout-change — re-running the full sync keeps titles accurate.
  plugin.registerEvent(
    plugin.app.vault.on("rename", () => syncAllLeaves(plugin)),
  );
}
