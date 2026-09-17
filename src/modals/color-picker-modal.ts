import { App, Modal, Setting, TextComponent } from "obsidian";

const HEX_COLOR_PATTERN = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * A color-selection modal: a native color swatch plus a synced hex text
 * field, so users can either pick visually or paste an exact hex code.
 * Used by the group context menu's "Set Accent Color" action.
 */
export class ColorPickerModal extends Modal {
  private value: string;
  private readonly onSubmit: (color: string) => void;
  private hexText: TextComponent | null = null;

  constructor(app: App, currentColor: string | undefined, onSubmit: (color: string) => void) {
    super(app);
    this.value = currentColor?.trim() || "#7c3aed";
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Set accent color" });

    new Setting(contentEl).setName("Pick a color").addColorPicker((picker) =>
      picker.setValue(this.value).onChange((v) => {
        this.value = v;
        this.hexText?.setValue(v);
      })
    );

    new Setting(contentEl).setName("Or enter a hex code").addText((text) => {
      this.hexText = text;
      text.setValue(this.value).onChange((v) => {
        const trimmed = v.trim();
        if (HEX_COLOR_PATTERN.test(trimmed)) {
          this.value = trimmed;
        }
      });
    });

    new Setting(contentEl).addButton((btn) =>
      btn
        .setButtonText("Apply")
        .setCta()
        .onClick(() => {
          this.onSubmit(this.value);
          this.close();
        })
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
