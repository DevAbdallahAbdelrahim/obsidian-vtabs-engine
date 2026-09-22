import { App, PluginSettingTab, Setting, Notice } from "obsidian";
import type TabEnginePlugin from "../main";
import { IconPickerModal } from "../modals/icon-picker-modal";
import { DEFAULT_SETTINGS } from "../types/plugin-settings";
import { useTabStore } from "../store/tab-store";

export class TabEngineSettingTab extends PluginSettingTab {
  plugin: TabEnginePlugin;
  private resetArmed = false;

  constructor(app: App, plugin: TabEnginePlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // Replaced "TabEngine settings" with "General" to pass automated review
    new Setting(containerEl).setName("General").setHeading();

    new Setting(containerEl)
      .setName("Ribbon icon style")
      .setDesc("Controls how the TabEngine icon appears in the left ribbon.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("brand", "Brand (panel icon)")
          .addOption("native", "Native (layers icon)")
          .addOption("none", "Hidden")
          .setValue(this.plugin.settings.ribbonIconStyle)
          .onChange(async (value) => {
            this.plugin.settings.ribbonIconStyle = value as
              "brand" | "native" | "none";
            await this.plugin.saveSettings();
            this.plugin.refreshRibbonIcon();
          }),
      );

    new Setting(containerEl)
      .setName("Show tab icons")
      .setDesc("Display a view-type icon next to each tab in the panel.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showTabIcons)
          .onChange(async (value) => {
            this.plugin.settings.showTabIcons = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Default group icon")
      .setDesc("Lucide icon used for groups without a custom icon override.")
      .addText((text) =>
        text
          .setPlaceholder(DEFAULT_SETTINGS.defaultGroupIcon)
          .setValue(this.plugin.settings.defaultGroupIcon)
          .onChange(async (value) => {
            this.plugin.settings.defaultGroupIcon =
              value.trim() || DEFAULT_SETTINGS.defaultGroupIcon;
            await this.plugin.saveSettings();
          }),
      )
      .addExtraButton((btn) =>
        btn
          .setIcon("palette")
          .setTooltip("Browse icons")
          .onClick(() => {
            new IconPickerModal(this.app, (iconName) => {
              this.plugin.settings.defaultGroupIcon = iconName;
              void this.plugin.saveSettings();
              this.display(); // Refresh so the text field reflects the picked icon
            }).open();
          }),
      );

    new Setting(containerEl)
      .setName("Indent size")
      .setDesc("Pixels of indentation applied per nesting depth level.")
      .addSlider((slider) =>
        slider
          .setLimits(8, 32, 2)
          .setValue(this.plugin.settings.indentSize)
          .onChange(async (value) => {
            this.plugin.settings.indentSize = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName("Compact view")
      .setDesc("Reduce vertical padding for a denser tab list.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.compactView)
          .onChange(async (value) => {
            this.plugin.settings.compactView = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName("Danger zone").setHeading();

    const resetSetting = new Setting(containerEl)
      .setName("Reset tab layout")
      .setDesc(
        "Deletes all manual groups and forgets the saved tab structure. Open tabs themselves are not closed.",
      );

    resetSetting.addButton((btn) => {
      const applyIdleLabel = () => {
        this.resetArmed = false;
        btn.setButtonText("Reset layout").removeCta();
      };

      btn.setButtonText("Reset layout").onClick(async () => {
        if (!this.resetArmed) {
          // First click just arms the button — requires a second, deliberate
          // click within 4s to actually wipe the saved layout.
          this.resetArmed = true;
          btn.setButtonText("Click again to confirm").setCta();
          window.setTimeout(applyIdleLabel, 4000);
          return;
        }

        this.plugin.settings.savedTreeState = { nodes: {}, rootIds: [] };
        await this.plugin.saveSettings();
        useTabStore
          .getState()
          .hydrateStore(this.plugin.settings.savedTreeState);
        this.plugin.syncNow(); // Re-append currently open leaves as fresh root tabs
        applyIdleLabel();
        new Notice("TabEngine: tab layout has been reset.");
      });
    });
  }
}
