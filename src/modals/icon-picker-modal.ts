import { App, FuzzySuggestModal } from "obsidian";
import { ICON_PICKER_OPTIONS } from "../engine/icon-engine";

/**
 * FuzzySuggestModal for picking a Lucide icon name, used by both the group
 * context menu's "Change Icon" action and the Settings tab's default group
 * icon picker.
 */
export class IconPickerModal extends FuzzySuggestModal<string> {
  private readonly onChoose: (icon: string) => void;

  constructor(app: App, onChoose: (icon: string) => void) {
    super(app);
    this.onChoose = onChoose;
    this.setPlaceholder("Search icon names…");
  }

  getItems(): string[] {
    return [...ICON_PICKER_OPTIONS];
  }

  getItemText(item: string): string {
    return item;
  }

  onChooseItem(item: string): void {
    this.onChoose(item);
  }
}
