import {
  CustomTreeNode,
  TabNode,
  GroupNode,
  SerializedTreeState,
} from "../types/tree";

// ─── ID Generation ────────────────────────────────────────────────────────────

/**
 * Generates a short, collision-resistant unique ID.
 * Combines a base-36 timestamp with a 5-char random suffix.
 * Produces IDs like "m5z3ke2abc" — short, URL-safe, and human-readable.
 */
export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 7);
}

// ─── Serialization ────────────────────────────────────────────────────────────

/**
 * Serializes the live in-memory tree into a data.json-safe payload.
 *
 * CRITICAL CONTRACT (Rule: never persist live Obsidian objects):
 * - For every TabNode, the `leaf` property is destructured out and discarded.
 * - The resulting serialized node only contains plain, JSON-serializable fields.
 * - GroupNodes contain no live references and are spread directly.
 */
export function serializeTreeState(
  nodes: Record<string, CustomTreeNode>,
  rootIds: string[]
): SerializedTreeState {
  const serializedNodes: SerializedTreeState["nodes"] = {};

  for (const [id, node] of Object.entries(nodes)) {
    if (node.type === "tab") {
      // Destructure `leaf` out — the rest operator captures everything else.
      // TypeScript's `Omit<TabNode, "leaf">` return type enforces this statically.
      const { leaf: _leaf, ...rest } = node;
      serializedNodes[id] = rest;
    } else {
      // GroupNode: no live references, safe to spread directly.
      serializedNodes[id] = { ...node };
    }
  }

  return {
    nodes: serializedNodes,
    // Spread to ensure the rootIds array is a fresh copy, not a reference.
    rootIds: [...rootIds],
  };
}

// ─── Deserialization ──────────────────────────────────────────────────────────

/**
 * Reconstructs the in-memory tree from a saved data.json payload.
 *
 * TabNodes are loaded with `leaf: undefined` — syncLeaves() will bind
 * live WorkspaceLeaf instances once Obsidian's layout is ready.
 *
 * Defensively handles missing or malformed saved data (e.g. first install,
 * or a manually edited / corrupted data.json).
 */
export function deserializeTreeState(saved: SerializedTreeState | null | undefined): {
  nodes: Record<string, CustomTreeNode>;
  rootIds: string[];
} {
  // Guard: if saved state is absent or malformed, return an empty tree.
  if (!saved || typeof saved !== "object") {
    return { nodes: {}, rootIds: [] };
  }

  const rawNodes = saved.nodes && typeof saved.nodes === "object" ? saved.nodes : {};
  const rootIds = Array.isArray(saved.rootIds) ? [...saved.rootIds] : [];

  const nodes: Record<string, CustomTreeNode> = {};

  for (const [id, rawNode] of Object.entries(rawNodes)) {
    if (!rawNode || typeof rawNode !== "object") continue;

    if (rawNode.type === "tab") {
      // Rehydrate as TabNode — leaf is intentionally undefined until syncLeaves().
      const node = rawNode as Omit<TabNode, "leaf">;
      nodes[id] = {
        id: node.id ?? id,
        type: "tab",
        title: node.title ?? "Untitled",
        leafId: node.leafId ?? "",
        viewType: node.viewType ?? "unknown",
        parentId: node.parentId ?? null,
        leaf: undefined, // Populated by syncLeaves()
        ...(node.icon ? { icon: node.icon } : {}),
        ...(node.color ? { color: node.color } : {}),
      } satisfies TabNode;
    } else if (rawNode.type === "group") {
      const node = rawNode as GroupNode;
      // Defensively guard childrenIds (Rule 2: never map without Array.isArray check)
      nodes[id] = {
        id: node.id ?? id,
        type: "group",
        title: node.title ?? "Group",
        parentId: node.parentId ?? null,
        childrenIds: Array.isArray(node.childrenIds) ? [...node.childrenIds] : [],
        isCollapsed: node.isCollapsed === true,
        ...(node.icon ? { icon: node.icon } : {}),
        ...(node.color ? { color: node.color } : {}),
      } satisfies GroupNode;
    }
    // Unknown type: skip silently (forward-compatibility).
  }

  return { nodes, rootIds };
}

// ─── Integrity Validation ─────────────────────────────────────────────────────

/**
 * Validates referential integrity of a deserialized tree.
 * Returns an array of human-readable warning strings (empty = valid).
 *
 * Checks:
 * 1. Every ID in rootIds exists in nodes.
 * 2. Every ID in a group's childrenIds exists in nodes.
 * 3. Every node's parentId, if set, points to an existing GroupNode.
 *
 * This is a diagnostic tool — it does NOT mutate the tree.
 * Callers should log warnings and continue; do not throw on corrupt data.
 */
export function validateTreeIntegrity(
  nodes: Record<string, CustomTreeNode>,
  rootIds: string[]
): string[] {
  const warnings: string[] = [];

  // 1. rootIds referential check
  for (const rootId of rootIds) {
    if (!nodes[rootId]) {
      warnings.push(`rootIds: references missing node "${rootId}"`);
    }
  }

  for (const [id, node] of Object.entries(nodes)) {
    // 2. childrenIds referential check (groups only)
    if (node.type === "group") {
      const childrenIds = Array.isArray(node.childrenIds) ? node.childrenIds : [];
      for (const childId of childrenIds) {
        if (!nodes[childId]) {
          warnings.push(`Group "${id}" ("${node.title}"): childrenIds references missing node "${childId}"`);
        }
      }
    }

    // 3. parentId referential check
    if (node.parentId !== null) {
      const parent = nodes[node.parentId];
      if (!parent) {
        warnings.push(
          `Node "${id}" ("${node.title}"): parentId "${node.parentId}" not found in nodes`
        );
      } else if (parent.type !== "group") {
        warnings.push(
          `Node "${id}" ("${node.title}"): parentId "${node.parentId}" resolves to a tab, not a group`
        );
      }
    }
  }

  return warnings;
}
