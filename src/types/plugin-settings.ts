import { SerializedTreeState } from "./tree";

// ─── Settings Interface ───────────────────────────────────────────────────────

export interface PluginSettings {
  /** Controls the ribbon (sidebar) icon appearance. */
  ribbonIconStyle: "brand" | "native" | "none";

  /** Show a Lucide icon next to each tab item in the panel. */
  showTabIcons: boolean;

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
  defaultGroupIcon: "folder",
  indentSize: 14,
  compactView: false,
  zoomLevel: 1.0,
  savedTreeState: {
    nodes: {},
    rootIds: [],
  },
} as const;
