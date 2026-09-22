import { WorkspaceLeaf, SplitDirection, ViewState } from "obsidian";

// ─── Public Configuration ──────────────────────────────────────────────────

/** Configuration for how a group's tabs should be opened in the new split. */
export interface SplitOptions {
  /** Which direction to split relative to the reference leaf. @default "vertical" */
  direction?: SplitDirection;
  /** Insert the new split before (left of / above) the reference leaf instead of after. @default false */
  before?: boolean;
  /** Focus the first successfully-populated leaf once population finishes. @default true */
  focusFirstLeaf?: boolean;
}

// ─── Internal Collection & Result Shapes ────────────────────────────────────
// None of these ever cross into the Zustand store — they exist entirely
// within this feature, built once per call from a read-only snapshot of the
// store's already-public state (nodes/rootIds + the isTabNode/isGroupNode
// guards already exported from types/tree.ts).

/**
 * A group's direct child tab that is currently LIVE — a candidate for
 * closing. `leaf` is the tab's own real, permanent leaf (never a copy).
 */
export interface AttachedTabEntry {
  nodeId: string;
  title: string;
  leaf: WorkspaceLeaf;
}

/**
 * A group's direct child tab that is currently DETACHED (hidden) — a
 * candidate for restoring. filePath/viewState are what a prior close()
 * captured; both are required here because only file-backed tabs are ever
 * marked detached in the first place (see TabNode.filePath's docs).
 */
export interface DetachedTabEntry {
  nodeId: string;
  title: string;
  filePath: string;
  viewState: ViewState;
}

/** Outcome of attempting to open or close one tab. Shared shape for both
 *  directions since the reporting need is identical either way. */
export interface TabActionOutcome {
  nodeId: string;
  title: string;
  success: boolean;
  /** Present only when success is false. */
  error?: string;
}

/**
 * Full internal result of a toggle attempt.
 */
export type ToggleGroupSplitOutcome =
  "opened" | "closed" | "busy" | "empty" | "not-found";
