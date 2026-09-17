import { App, FuzzySuggestModal } from "obsidian";
import { CustomTreeNode, GroupNode } from "../../types/tree";

/** Sentinel representing "move to root level, no group" in the picker list. */
const ROOT_SENTINEL: GroupNode = {
  id: "__root__",
  type: "group",
  title: "(No group — move to root)",
  parentId: null,
  childrenIds: [],
  isCollapsed: false,
};

/**
 * FuzzySuggestModal listing every existing group (flattened, regardless of
 * nesting depth) plus a pseudo "root" option, for the "Move to Group" action
 * on both tabs and groups.
 *
 * `excludeIds` lets the caller omit the node being moved and, for a group
 * being moved, its own descendant group IDs — this is what prevents a group
 * from being dropped inside itself or one of its children (a cycle).
 */
export class GroupPickerModal extends FuzzySuggestModal<GroupNode> {
  private readonly groups: GroupNode[];
  private readonly onChoose: (targetParentId: string | null) => void;

  constructor(
    app: App,
    nodes: Record<string, CustomTreeNode>,
    excludeIds: Set<string>,
    onChoose: (targetParentId: string | null) => void
  ) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Move to group…");

    // Rule 2: guard before filtering over nodes
    const allGroups = Object.values(nodes).filter(
      (n): n is GroupNode => n.type === "group" && !excludeIds.has(n.id)
    );

    this.groups = [ROOT_SENTINEL, ...allGroups];
  }

  getItems(): GroupNode[] {
    return this.groups;
  }

  getItemText(item: GroupNode): string {
    return item.title;
  }

  onChooseItem(item: GroupNode): void {
    this.onChoose(item.id === ROOT_SENTINEL.id ? null : item.id);
  }
}
