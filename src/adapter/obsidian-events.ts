import { Plugin, WorkspaceLeaf } from "obsidian";
import type TabEnginePlugin from "../main";
import { useTabStore } from "../store/tab-store";
import { DeduplicationService } from "../features/deduplication/deduplication.service";

type LeafWithId = WorkspaceLeaf & { id: string };

function getLeafId(leaf: WorkspaceLeaf): string {
  return (leaf as LeafWithId).id ?? "";
}

/**
 * Collects currently-open WorkspaceLeaf instances exclusively across the main
 * editor root area, completely excluding sidebars (Search, Bookmarks, Files, etc.).
 */
function collectAllLeaves(plugin: Plugin): WorkspaceLeaf[] {
  const leaves: WorkspaceLeaf[] = [];
  // استخدام iterateRootLeaves لجلب التابات الأساسية للمحرر الرئيسي فقط واستبعاد الشريط الجانبي
  plugin.app.workspace.iterateRootLeaves((leaf) => {
    leaves.push(leaf);
  });
  return leaves;
}

/**
 * Runs a full leaf sync. Exported standalone so main.ts or workspace events
 * can trigger a manual resync whenever tabs change.
 */
export function syncAllLeaves(plugin: Plugin): void {
  useTabStore.getState().syncLeaves(collectAllLeaves(plugin));
}

/**
 * Wires up every Obsidian workspace event TabEngine needs to keep its
 * Zustand tree in sync with live WorkspaceLeaf instances.
 *
 * Fully compliant with Obsidian 1.14.4+ workspace lifecycle events.
 */
export function registerWorkspaceEvents(plugin: TabEnginePlugin): void {
  // Initial sync: fires once Obsidian has restored the previous session's leaves.
  plugin.app.workspace.onLayoutReady(() => syncAllLeaves(plugin));

  // Fires on structural changes (splits, panes, sidebar toggles).
  plugin.registerEvent(
    plugin.app.workspace.on("layout-change", () => {
      if (plugin.settings.autoDeduplicateTabs) {
        DeduplicationService.reconcile(plugin);
      }
      syncAllLeaves(plugin);
    }),
  );

  // Fires when focus moves or a new leaf is created/focused.
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

      syncAllLeaves(plugin);
    }),
  );

  // Fires explicitly when any note/file is opened
  plugin.registerEvent(
    plugin.app.workspace.on("file-open", () => {
      syncAllLeaves(plugin);
    }),
  );

  // File renames are a Vault event — updates display titles independently.
  plugin.registerEvent(
    plugin.app.vault.on("rename", () => syncAllLeaves(plugin)),
  );
}
