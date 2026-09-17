import { Plugin, Events } from "obsidian";
import { PluginSettings, DEFAULT_SETTINGS } from "./types/plugin-settings";
import { useTabStore } from "./store/tab-store";
import { registerWorkspaceEvents, syncAllLeaves } from "./adapter/obsidian-events";
import { TabEngineSettingTab } from "./settings/setting-tab";
import { TabEngineView, TAB_ENGINE_VIEW_TYPE } from "./ui/types/view-container";

/** Debounce delay (ms) between a tree mutation and the actual disk write. */
const SAVE_DEBOUNCE_MS = 400;

export default class TabEnginePlugin extends Plugin {
  settings!: PluginSettings;

  /**
   * Lightweight pub/sub so React components (via useSettings()) can react to
   * settings changes made from the Settings tab, without coupling display
   * settings (indentSize, showTabIcons, etc.) into the Zustand tree store,
   * which stays scoped to structural tab/group data per the spec.
   */
  settingsEvents: Events = new Events();

  private saveTimeoutId: number | null = null;
  private ribbonIconEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    await this.loadSettings();

    // Hydrate the Zustand tree from data.json BEFORE any leaves exist.
    // registerWorkspaceEvents() below binds live WorkspaceLeaf instances
    // onto this structure once Obsidian's layout is ready.
    useTabStore.getState().hydrateStore(this.settings.savedTreeState);

    // Rule 1's persistence guarantee: every structural mutation in the store
    // calls _triggerSave() internally, which invokes this callback.
    useTabStore.getState().setSaveCallback(() => this.queueSave());

    // Wires layout-change / active-leaf-change / rename / onLayoutReady to
    // the store's syncLeaves() reconciler.
    registerWorkspaceEvents(this);

    // Register the React-backed panel view.
    this.registerView(TAB_ENGINE_VIEW_TYPE, (leaf) => new TabEngineView(leaf, this));

    this.refreshRibbonIcon();
    this.addSettingTab(new TabEngineSettingTab(this.app, this));

    this.addCommand({
      id: "open-tab-engine-view",
      name: "Open TabEngine panel",
      callback: () => {
        void this.activateView();
      },
    });
  }

  onunload(): void {
    // Flush any pending debounced save immediately so no mutation between
    // the last tree change and plugin teardown is ever lost.
    if (this.saveTimeoutId !== null) {
      window.clearTimeout(this.saveTimeoutId);
      this.saveTimeoutId = null;
      void this.persistTreeState();
    }
  }

  // ── Settings Persistence ─────────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<PluginSettings> | null;
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loaded,
      // Deep-merge the nested tree state so a partial/corrupt data.json
      // (e.g. from an older plugin version) never silently drops the
      // whole saved layout.
      savedTreeState: {
        ...DEFAULT_SETTINGS.savedTreeState,
        ...(loaded?.savedTreeState ?? {}),
      },
    };
  }

  /**
   * Persists the full settings object, including the current tree state, to
   * data.json, then notifies React via settingsEvents. Called by the
   * Settings tab after every field change.
   *
   * Note: mutating `this.settings` directly (rather than via spread) is the
   * standard Obsidian plugin convention — this is a plain lifecycle object,
   * not Zustand state, so Rule 3's immutability requirement (which governs
   * the tab-store's `nodes`/`rootIds`) doesn't apply to it.
   */
  async saveSettings(): Promise<void> {
    this.settings.savedTreeState = useTabStore.getState().getSerializedState();
    await this.saveData(this.settings);
    this.settingsEvents.trigger("change");
  }

  /** Persists only the tree portion — used by the store's debounced save callback. */
  private async persistTreeState(): Promise<void> {
    this.settings.savedTreeState = useTabStore.getState().getSerializedState();
    await this.saveData(this.settings);
  }

  /**
   * Debounces disk writes so rapid successive mutations (e.g. dragging
   * through several reorders in a row) collapse into a single saveData()
   * call, rather than one write per mutation.
   */
  private queueSave(): void {
    if (this.saveTimeoutId !== null) {
      window.clearTimeout(this.saveTimeoutId);
    }
    this.saveTimeoutId = window.setTimeout(() => {
      this.saveTimeoutId = null;
      void this.persistTreeState();
    }, SAVE_DEBOUNCE_MS);
  }

  // ── View Lifecycle ───────────────────────────────────────────────────────

  async activateView(): Promise<void> {
    const { workspace } = this.app;

    const existing = workspace.getLeavesOfType(TAB_ENGINE_VIEW_TYPE);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }

    const leaf = workspace.getLeftLeaf(false);
    if (!leaf) return;

    await leaf.setViewState({ type: TAB_ENGINE_VIEW_TYPE, active: true });
    workspace.revealLeaf(leaf);
  }

  // ── Ribbon ───────────────────────────────────────────────────────────────

  refreshRibbonIcon(): void {
    this.ribbonIconEl?.remove();
    this.ribbonIconEl = null;

    if (this.settings.ribbonIconStyle === "none") return;

    const iconId = this.settings.ribbonIconStyle === "native" ? "layers" : "layout-panel-left";
    this.ribbonIconEl = this.addRibbonIcon(iconId, "Open TabEngine", () => {
      void this.activateView();
    });
  }

  // ── Manual Sync (used by the Settings tab's "Reset layout" action) ──────

  syncNow(): void {
    syncAllLeaves(this);
  }
}
