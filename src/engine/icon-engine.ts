import { setIcon } from "obsidian";
import { CustomTreeNode } from "../types/tree";

/**
 * Maps Obsidian view-type strings to Lucide icon names. Obsidian bundles the
 * full Lucide icon set internally and renders icons by name via setIcon() —
 * no separate icon package import is needed inside the plugin itself.
 *
 * Covers the view types named in the spec (Markdown, Canvas, Graph, Bases,
 * PDFs) plus common built-in Obsidian view types, so auto-detection degrades
 * gracefully for anything not explicitly listed.
 */
const VIEW_TYPE_ICON_MAP: Record<string, string> = {
  markdown: "file-text",
  canvas: "layout-dashboard",
  graph: "network",
  localgraph: "network",
  bases: "table",
  pdf: "book-open",
  image: "image",
  video: "film",
  audio: "music",
  kanban: "layout-grid",
  excalidraw: "shapes",
  outline: "list-tree",
  "file-explorer": "folder-tree",
  search: "search",
  tag: "tags",
  backlink: "link",
  bookmarks: "bookmark",
  empty: "file-plus",
};

/** Fallback icon for tab view types not present in VIEW_TYPE_ICON_MAP. */
const FALLBACK_TAB_ICON = "file";

/** Fallback icon for groups with no defaultGroupIcon configured. */
const FALLBACK_GROUP_ICON = "folder";

/**
 * A curated set of Lucide icon names offered in the icon picker modal. Kept
 * deliberately small and broadly useful rather than exhaustive — this is a
 * picker convenience, not a restriction (any valid Lucide name still works
 * as a manually-typed custom override via data.json).
 *
 * Object.freeze() gives a reference-stable module-scoped constant, per the
 * project's "Reference Stability" principle for anything handed to React.
 */
export const ICON_PICKER_OPTIONS: readonly string[] = Object.freeze([
  "folder", "folder-open", "star", "heart", "bookmark", "flag",
  "layers", "layout-dashboard", "layout-grid", "table", "network",
  "file-text", "file-code", "book-open", "notebook", "sticky-note",
  "image", "film", "music", "mic", "camera",
  "briefcase", "graduation-cap", "flask-conical", "microscope", "dna",
  "code", "terminal", "database", "server", "cloud",
  "calendar", "clock", "target", "check-circle", "alert-circle",
  "rocket", "lightbulb", "compass", "map", "globe",
  "archive", "inbox", "tag", "link", "pin",
]);

/**
 * Resolves the icon to render for a given tree node.
 *
 * Precedence: (1) node-level custom override, (2) for groups — the plugin's
 * configured defaultGroupIcon, (3) for tabs — auto-detected from viewType,
 * (4) absolute fallback ("folder" / "file").
 *
 * Rule 5: strict `node.type` discriminant, never a loose property check.
 */
export function resolveNodeIcon(node: CustomTreeNode, defaultGroupIcon: string): string {
  if (node.icon && node.icon.trim().length > 0) {
    return node.icon;
  }

  if (node.type === "group") {
    return defaultGroupIcon?.trim() ? defaultGroupIcon : FALLBACK_GROUP_ICON;
  }

  // node.type === "tab"
  return VIEW_TYPE_ICON_MAP[node.viewType] ?? FALLBACK_TAB_ICON;
}

/**
 * Applies a Lucide icon to a DOM element via Obsidian's built-in renderer.
 * Wrapped defensively: a bad or unknown icon name should never crash the
 * tab panel — setIcon() already no-ops gracefully, but we also guard
 * against a null/detached element during fast list re-renders.
 */
export function applyIcon(el: HTMLElement | null, iconName: string): void {
  if (!el) return;
  try {
    setIcon(el, iconName);
  } catch {
    // Swallow — a missing icon should never break tab rendering.
  }
}
