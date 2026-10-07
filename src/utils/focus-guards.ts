import { App, HoverParent, ItemView, WorkspaceLeaf, WorkspaceMobileDrawer } from "obsidian";

/**
 * Shared, purely-defensive helpers used by any feature that closes leaves
 * or moves focus programmatically (GroupSplitService, DeduplicationService).
 * Everything here is built on documented, public Obsidian API only.
 * There is deliberately no attempt to read or merge leaf navigation
 * history: Obsidian's own published WorkspaceLeaf reference lists exactly
 * four public properties (hoverPopover, isDeferred, parent, view) — no
 * back/forward history among them. That history exists, but only as a
 * private implementation detail some community plugins reverse-engineer
 * via their own unofficial type augmentations; relying on it here would
 * mean depending on something Obsidian could change or remove without
 * notice, for something the public getEphemeralState()/setEphemeralState()
 * pair already covers for the cases that matter (see DeduplicationService).
 */

/**
 * The currently focused leaf, or null.
 *
 * workspace.activeLeaf is marked obsolete in Obsidian's API docs, which
 * point to getActiveViewOfType() for "information about the current view".
 * A view knows its own leaf, so this asks for the active view of any kind
 * (ItemView is what leaf views normally extend; the API declares
 * Constructor<T> as `abstract new`, so passing the abstract class type-
 * checks) and reads .leaf off it.
 *
 * getMostRecentLeaf() is deliberately NOT the replacement: it only
 * searches the root split and pop-outs, so it can never return a sidebar
 * or mobile-drawer leaf — which would leave isMobileDrawerOpen() below
 * permanently false.
 */
export function getActiveLeaf(app: App): WorkspaceLeaf | null {
  return app.workspace.getActiveViewOfType(ItemView)?.leaf ?? null;
}

/**
 * True if this object currently has an open hover popover. HoverParent is a
 * bare interface — anything with a `hoverPopover` property can be the
 * parent of a popover — so this is a structural check rather than an
 * instanceof.
 */
function hasOpenHoverPopover(candidate: unknown): boolean {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    "hoverPopover" in candidate &&
    Boolean((candidate as HoverParent).hoverPopover)
  );
}

/**
 * True if the focused leaf (or its view) currently has an open hover
 * popover. A popover attaches to whichever object the launcher passed as
 * its hover parent, which can be a view as well as a leaf — so both are
 * checked. This is Obsidian's own documented mechanism (HoverParent), and
 * the one community hover plugins build on, rather than a check for one
 * specific plugin by ID: it also covers native hover preview, and keeps
 * working if a particular plugin is renamed or replaced.
 */
export function isHoverPreviewActive(app: App): boolean {
  const leaf = getActiveLeaf(app);
  if (leaf && (hasOpenHoverPopover(leaf) || hasOpenHoverPopover(leaf.view))) return true;

  // Best-effort secondary signal only: Hover Editor's own internals aren't
  // part of Obsidian's public API, so this can't be verified the way the
  // check above can. If it can't be determined, it contributes nothing —
  // it never throws and never overrides the primary signal.
  try {
    const registry = app as unknown as {
      plugins?: { plugins?: Record<string, { enabled?: boolean } | undefined> };
    };
    if (registry.plugins?.plugins?.["obsidian-hover-editor"]?.enabled) return true;
  } catch {
    // advisory only
  }

  return false;
}

/**
 * True if the focused leaf lives inside a WorkspaceMobileDrawer — Obsidian's
 * documented type for the collapsible mobile sidebar (the docs' own
 * WorkspaceLeaf.parent reference says to check this with instanceof).
 * Whether the drawer is currently expanded isn't part of the public API,
 * so this errs toward caution: being inside a drawer at all is treated as
 * reason enough to hold off, rather than trying to guess at its open/
 * closed animation state.
 */
export function isMobileDrawerOpen(app: App): boolean {
  return getActiveLeaf(app)?.parent instanceof WorkspaceMobileDrawer;
}

/** Either guard being true means: don't detach anything and don't move focus right now. */
export function focusGuardActive(app: App): boolean {
  return isHoverPreviewActive(app) || isMobileDrawerOpen(app);
}

/**
 * leaf.detach() wrapped so a view throwing during teardown (observed on
 * some Obsidian 1.9+ view types) can't propagate and break whatever loop
 * or caller triggered it.
 */
export function safeDetach(leaf: WorkspaceLeaf): void {
  try {
    leaf.detach();
  } catch (err) {
    console.warn("[TabEngine] safeDetach: leaf.detach() threw, ignoring.", err);
  }
}

/**
 * Focus-guarded setActiveLeaf — skips entirely (returns false) if a hover
 * preview or mobile drawer is active right now, rather than stealing focus
 * mid-interaction. Callers that don't strictly need focus to happen should
 * treat a false return as "fine, try again next time" rather than an error.
 */
export function safeSetActiveLeaf(
  app: App,
  leaf: WorkspaceLeaf,
  options?: { focus?: boolean },
): boolean {
  if (focusGuardActive(app)) return false;
  app.workspace.setActiveLeaf(leaf, options);
  return true;
}
