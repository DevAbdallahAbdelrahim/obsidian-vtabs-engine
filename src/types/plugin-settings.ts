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
   * The persisted structural tree: manual group definitions and tab ordering.
   * This is the ONLY field that gets read by hydrateStore() on startup.
   *
   * What is saved:  GroupNode definitions + TabNode metadata (leafId, viewType, title).
   * What is NOT saved: live WorkspaceLeaf objects (stripped at serialization time).
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
  savedTreeState: {
    nodes: {},
    rootIds: [],
  },
} as const;
