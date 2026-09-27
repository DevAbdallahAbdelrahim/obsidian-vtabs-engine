import { SerializedTreeState } from "./tree";

// ─── Settings Interface ───────────────────────────────────────────────────────

export interface PluginSettings {
  /** Controls the ribbon (sidebar) icon appearance. */
  ribbonIconStyle: "brand" | "native" | "none";

  /** Show a Lucide icon next to each tab item in the panel. */
  showTabIcons: boolean;

  /** Display the number of open tabs next to each group name in the panel. */
  showGroupTabCount: boolean;

  /**
   * Automatically collapse split panes created by VTab Engine when their
   * grouped tabs are hidden via the Eye toggle, going further than the
   * baseline cleanup that already always runs (which only removes
   * Obsidian's own auto-inserted filler leaf). With this on, a
   * plugin-created split is fully cleared even if something else was
   * manually parked in it. Off by default — opt-in, since it can close a
   * pane the user added content to after the fact.
   */
  autoCollapseManagedSplits: boolean;

  /**
   * Reserved for a future "collapse standalone splits containing only an
   * isolated, ungrouped tab" behavior. NOT yet wired to any action: an
   * ungrouped tab has no detached-survival tracking (that only exists for
   * grouped tabs, closed via the Eye toggle), so detaching one today would
   * be silently, permanently deleted by syncLeaves() on the next
   * reconciliation pass. Left present and off by default so the setting UI
   * matches spec, but implementing the behavior needs detached-survival
   * extended to root-level tabs first — a separate, deliberate decision.
   */
  autoCollapseStandaloneSplits: boolean;

  /**
   * Lucide icon name used for groups that have no custom icon override.
   * Falls back to "folder" if empty or invalid.
   */
  defaultGroupIcon: string;

  /**
   * Pixel indentation applied per nesting depth level.
   * Computed as: `paddingLeft = depth * indentSize`.
   */
  indentSize: number;

  /** Reduces vertical padding for a denser tab list. */
  compactView: boolean;

  /**
   * Sidebar density scale, applied as the --tab-engine-zoom-scale CSS
   * variable. Range 0.75–1.50 in 0.05 steps; 1.0 = 100%.
   */
  zoomLevel: number;

  /**
   * The persisted structural tree: manual group definitions and tab ordering.
   * This is the ONLY field that gets read by hydrateStore() on startup.
   */
  savedTreeState: SerializedTreeState;
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: Readonly<PluginSettings> = {
  ribbonIconStyle: "brand",
  showTabIcons: true,
  showGroupTabCount: true,
  autoCollapseManagedSplits: false,
  autoCollapseStandaloneSplits: false,
  defaultGroupIcon: "folder",
  indentSize: 14,
  compactView: false,
  zoomLevel: 1.0,
  savedTreeState: {
    nodes: {},
    rootIds: [],
  },
} as const;
