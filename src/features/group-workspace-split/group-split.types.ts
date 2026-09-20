import { WorkspaceLeaf, SplitDirection } from "obsidian";

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

/** One tab collected from a group (recursively), paired with its live leaf. */
export interface CollectedLeafEntry {
  /** The tab's node id in the store — used only for logging/Notice text. */
  nodeId: string;
  /** Display title, used only for user-facing messages, never for view identity. */
  title: string;
  /** The live WorkspaceLeaf this tab currently corresponds to. */
  sourceLeaf: WorkspaceLeaf;
}

/** Outcome of attempting to populate one collected entry into a new leaf. */
export interface PopulateOutcome {
  nodeId: string;
  title: string;
  success: boolean;
  /** Present only when success is false. */
  error?: string;
}

/**
 * Full internal result of a split-open attempt.
 *
 * The public `GroupSplitService.openGroupInSplit()` returns `Promise<void>`
 * per spec and surfaces this via a single summary Notice — this richer
 * shape exists so that summary logic (and any future UI/telemetry hook)
 * has real structured data to work with, without changing the public
 * method's return type.
 */
export interface OpenGroupInSplitOutcome {
  groupId: string;
  outcomes: PopulateOutcome[];
  /**
   * The first tab that was successfully populated — already focused unless
   * focusFirstLeaf was false. Null if every tab in the group failed to open.
   */
  firstLeaf: WorkspaceLeaf | null;
}
