import { WorkspaceLeaf, ViewState } from "obsidian";

// ─── Base ─────────────────────────────────────────────────────────────────────

export interface BaseNode {
  id: string;
  title: string;
  parentId: string | null;
  icon?: string;   // Lucide icon name override (e.g. "layers", "star")
  color?: string;  // CSS accent color override (e.g. "#ff6600")
}

// ─── Discriminated Union Members ──────────────────────────────────────────────

/**
 * Represents a single open Obsidian WorkspaceLeaf.
 *
 * `leaf` is intentionally optional: it is undefined from deserialization until
 * syncLeaves() binds the live WorkspaceLeaf by matching `leafId`.
 * NEVER persist `leaf` to data.json — it is an ephemeral runtime reference.
 */
export interface TabNode extends BaseNode {
  type: "tab";
  /** Live leaf reference — ephemeral, populated at runtime by syncLeaves(). */
  leaf?: WorkspaceLeaf;
  /** Obsidian's internal leaf ID — stable within a session; used for re-binding. */
  leafId: string;
  /** The view type string emitted by the leaf's view (e.g. "markdown", "canvas", "pdf"). */
  viewType: string;
  /**
   * True when this tab was deliberately hidden by a group's Eye toggle
   * (GroupSplitService.close()) rather than genuinely closed by the user.
   * A detached node is kept — never removed — so toggling the group back
   * on can restore it. Only ever set/cleared by GroupSplitService; an
   * ordinary tab close (the tab's native ×) still removes the node as
   * before and never sets this.
   */
  detached?: boolean;
  /**
   * File path captured at the moment of detaching. Doubles as the
   * reconciliation key: if the user reopens this file externally (file
   * explorer, a link) while this node is detached, syncLeaves() re-binds
   * the new leaf here instead of creating a second, unrelated root node.
   * Only set for file-backed views — views with no stable file identity
   * (graph, search, etc.) are not eligible for detached-survival and are
   * removed on close exactly as before.
   */
  filePath?: string;
  /**
   * Full view state snapshot (leaf.getViewState()) captured at the moment
   * of detaching, so restoring can reproduce scroll position, mode, and
   * other view-specific state, not just "reopen the file".
   */
  viewState?: ViewState;
}

/**
 * Represents a manually-created container group.
 * Groups can contain both TabNodes and nested GroupNodes.
 * childrenIds is the authoritative ordered list of children — never derive order elsewhere.
 */
export interface GroupNode extends BaseNode {
  type: "group";
  /** Ordered child node IDs (tabs or nested groups). Maintained by store mutations. */
  childrenIds: string[];
  isCollapsed: boolean;
}

/** The central discriminated union — the only tree node type used at runtime. */
export type CustomTreeNode = TabNode | GroupNode;

// ─── Serialization Schema (data.json safe) ────────────────────────────────────

/**
 * The exact shape saved to and loaded from data.json.
 *
 * `Omit<TabNode, "leaf">` statically enforces that live WorkspaceLeaf
 * references can never be included in the serialized payload.
 */
export interface SerializedTreeState {
  nodes: Record<string, Omit<TabNode, "leaf"> | GroupNode>;
  rootIds: string[];
}

// ─── Type Guards (Rule 5: strict discriminants, no loose property checks) ─────

/**
 * Narrows CustomTreeNode → TabNode.
 * Always use this instead of checking `node.hasOwnProperty("leaf")` or similar.
 */
export function isTabNode(node: CustomTreeNode): node is TabNode {
  return node.type === "tab";
}

/**
 * Narrows CustomTreeNode → GroupNode.
 * Always use this instead of checking `node.hasOwnProperty("childrenIds")` or similar.
 */
export function isGroupNode(node: CustomTreeNode): node is GroupNode {
  return node.type === "group";
}
