import { App, Modal, Setting } from "obsidian";

/**
 * A minimal text-input modal used for tab renaming, group renaming, and the
 * VirtualTabList "new group" flow. Submits on Enter or via the button;
 * Escape (Obsidian's default Modal behavior) cancels without effect.
 */
export class RenameModal extends Modal {
  private value: string;
  private readonly onSubmit: (newTitle: string) => void;

  constructor(app: App, currentTitle: string, onSubmit: (newTitle: string) => void) {
    super(app);
    this.value = currentTitle;
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Rename" });

    let inputEl!: HTMLInputElement;

    new Setting(contentEl).setClass("tab-engine-rename-setting").addText((text) => {
      inputEl = text.inputEl;
      text.setValue(this.value).onChange((v) => (this.value = v));
      text.inputEl.focus();
      text.inputEl.select();
    });

    const submit = () => {
      const trimmed = this.value.trim();
      if (trimmed.length > 0) {
        this.onSubmit(trimmed);
      }
      this.close();
    };

    inputEl.addEventListener("keydown", (evt: KeyboardEvent) => {
      if (evt.key === "Enter") {
        evt.preventDefault();
        submit();
      }
    });

    new Setting(contentEl).addButton((btn) =>
      btn.setButtonText("Rename").setCta().onClick(submit)
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
