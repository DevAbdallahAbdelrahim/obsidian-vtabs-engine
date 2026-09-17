import * as React from "react";
import { createContext, useContext, useEffect, useState } from "react";
import type TabEnginePlugin from "../../main";
import { PluginSettings } from "../../types/plugin-settings";

const PluginContext = createContext<TabEnginePlugin | null>(null);

interface PluginContextProviderProps {
  plugin: TabEnginePlugin;
  children: React.ReactNode;
}

/**
 * Makes the plugin instance available to every component in the tree, so
 * components can reach `plugin.app` (to construct Menu/Modal instances) and
 * live settings (via useSettings()) without prop-drilling either through
 * VirtualTabList's recursive DFS render chain.
 */
export function PluginContextProvider({
  plugin,
  children,
}: PluginContextProviderProps): React.ReactElement {
  return <PluginContext.Provider value={plugin}>{children}</PluginContext.Provider>;
}

/** Returns the live plugin instance. Throws if called outside the provider. */
export function usePlugin(): TabEnginePlugin {
  const plugin = useContext(PluginContext);
  if (!plugin) {
    throw new Error("usePlugin() must be called within a PluginContextProvider");
  }
  return plugin;
}

/**
 * Returns a live snapshot of `plugin.settings`, re-rendering the calling
 * component whenever the Settings tab saves a change.
 *
 * Settings (ribbonIconStyle, showTabIcons, indentSize, defaultGroupIcon,
 * compactView) intentionally live on the plugin instance rather than in the
 * Zustand tree store — that store stays scoped to structural tab/group
 * data (Rule set 1–5 in the spec). This hook is the bridge: it subscribes to
 * the plugin's lightweight Events emitter and mirrors the settings object
 * into local React state on every "change" event.
 */
export function useSettings(): PluginSettings {
  const plugin = usePlugin();
  const [settings, setSettings] = useState<PluginSettings>(plugin.settings);

  useEffect(() => {
    const handler = () => setSettings({ ...plugin.settings });
    plugin.settingsEvents.on("change", handler);
    return () => {
      plugin.settingsEvents.off("change", handler);
    };
  }, [plugin]);

  return settings;
}
