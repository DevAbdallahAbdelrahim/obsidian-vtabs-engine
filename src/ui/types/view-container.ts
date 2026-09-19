import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import type TabEnginePlugin from "../../main";
import { PluginContextProvider } from "../context/plugin-context";
import { VirtualTabList } from "../components/VirtualTabList";

export const TAB_ENGINE_VIEW_TYPE = "tab-engine-view";

/**
 * The Obsidian ItemView that hosts TabEngine's React tree.
 *
 * Written in React.createElement form (no JSX) so this file can keep the
 * ".ts" extension specified in the project's directory structure, rather
 * than requiring ".tsx".
 */
export class TabEngineView extends ItemView {
  private root: Root | null = null;
  private readonly plugin: TabEnginePlugin;

  constructor(leaf: WorkspaceLeaf, plugin: TabEnginePlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return TAB_ENGINE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "TabEngine";
  }

  getIcon(): string {
    return this.plugin.settings.ribbonIconStyle === "native" ? "layers" : "layout-panel-left";
  }

  async onOpen(): Promise<void> {
    // Obsidian's ItemView convention: children[0] is the view header,
    // children[1] is the actual content container.
    const container = this.containerEl.children[1] ?? this.containerEl;
    container.empty();
    container.addClass("tab-engine-view-container");

    this.root = createRoot(container);
    this.root.render(
      React.createElement(PluginContextProvider, {
        plugin: this.plugin,
        children: React.createElement(VirtualTabList),
      })
    );
  }

  async onClose(): Promise<void> {
    this.root?.unmount();
    this.root = null;
  }
}
