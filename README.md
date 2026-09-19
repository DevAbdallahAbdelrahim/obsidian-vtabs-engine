# VTabs Engine for Obsidian🚀

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Obsidian API](https://img.shields.io/badge/Obsidian-v1.0.0%2B-purple.svg)](https://obsidian.md)
[![Build](https://img.shields.io/badge/Build-Passing-brightgreen.svg)](<>)

**VTabs Engine** is a high-performance, tree-structured vertical tab manager for Obsidian. Designed for power users, it replaces standard horizontal tab strips with a clean, responsive vertical sidebar hierarchy featuring group management, custom styling, instant search, and zero-overhead performance.

#### VTabs Engine Main Sidebar Interface

<img width="850" height="769" alt="main-sidebar-view" src="https://github.com/user-attachments/assets/8d76dcfe-5b91-44a9-9c30-9886d2d78edc" />

---

## ✨ Key Features

### 🌲 Tree Hierarchy & Tab Grouping

Organize open tabs and custom groups in a collapsible vertical tree structure with item counter badges.

#### Grouped Vertical Tabs View

<img width="847" height="910" alt="grouped-tabs-view" src="https://github.com/user-attachments/assets/ab785d39-02e7-4453-b349-4bfa841d9a66" />

-----

### 🎨 Custom Accent Colors & Icons

Assign distinct colors and Lucide icons to individual tab groups for fast visual identification.

#### Color Picker Modal

<img width="1917" height="890" alt="color-picker-modal" src="https://github.com/user-attachments/assets/9f7d655d-3014-4146-85ed-0ce83f0bfea8" />

-----

### 🛠️ Inline Management Modals

Rename groups and manage workspace organization effortlessly via built-in modals.

#### Rename Group Modal

<img width="1916" height="756" alt="rename-modal" src="https://github.com/user-attachments/assets/fd565463-a0b9-48d4-a72b-a9227b0fa26e" />

----

## ⚙️ Configuration & Settings

Fine-tune the sidebar interface directly from Obsidian's Plugin Settings tab. Customize ribbon icon style, toggle tab icons, adjust nesting indent size, or enable compact view.

#### VTabs Engine Settings Page

<img width="1047" height="819" alt="settings-page" src="https://github.com/user-attachments/assets/9067f87a-db60-43a0-b507-a08af97dc5b1" />

-----

### ⚡ Additional Core Capabilities

- **Flat-Map Zustand Store**: Reactive state management decoupled from heavy render loops for smooth handling of dozens of tabs.
- **Instant Search**: Real-time filtering across active tabs, groups, and paths using optimized tree algorithms.
- **Native Obsidian Sync**: Seamless handling of workspace active leaf changes, leaf closures, pinned tabs, and vault file rename events.

---

## 📂 Project Structure

```
tab-engine-obsidian/
├── docs/
│   └── ARCHITECTURE.md
├── src/
│   ├── adapter/
│   │   └── obsidian-events.ts        # Workspace event listeners → store.syncLeaves()
│   ├── engine/
│   │   └── icon-engine.ts            # Lucide icon auto-detection & overrides
│   ├── features/
│   │   └── group-workspace-split/    # Self-contained "Focus View" feature module
│   │       ├── group-split.types.ts
│   │       ├── group-split.service.ts
│   │       ├── GroupSplitButton.tsx
│   │       └── index.ts
│   ├── modals/
│   │   ├── rename-modal.ts
│   │   ├── icon-picker-modal.ts
│   │   ├── color-picker-modal.ts
│   │   └── group-picker-modal.ts
│   ├── settings/
│   │   └── setting-tab.ts
│   ├── store/
│   │   └── tab-store.ts              # Central Zustand store
│   ├── types/
│   │   ├── plugin-settings.ts
│   │   └── tree.ts                   # Discriminated union node types
│   ├── ui/
│   │   ├── components/
│   │   │   ├── ObsidianIcon.tsx
│   │   │   ├── TabGroupNode.tsx
│   │   │   ├── TabItemNode.tsx
│   │   │   └── VirtualTabList.tsx
│   │   ├── context/
│   │   │   └── plugin-context.tsx
│   │   └── types/
│   │       └── view-container.ts     # ItemView ↔ React root bridge
│   ├── utils/
│   │   ├── persistence.ts            # Serialize/deserialize/validate the tree
│   │   └── tree-utils.ts             # Sibling lookup + search filter
│   └── main.ts
├── esbuild.config.mjs
├── manifest.json
├── package.json
├── styles.css
└── tsconfig.json
```

---

## 🛠️ Building & Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- `npm` package manager

### Build Steps

1. **Clone the repository:**

   ```bash
   git clone [https://github.com/username/obsidian-vtabs-engine.git](https://github.com/username/obsidian-vtabs-engine.git)
   cd obsidian-vtabs-engine
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Build production bundle:**

   ```bash
   npm run build
   ```

   This performs strict TypeScript type checking (`tsc --noEmit`) and bundles `main.js` via `esbuild`.

4. **Watch mode for development:**
   ```bash
   npm run dev
   ```

---

## 📦 Manual Installation

1. Create a directory named `vtabs-engine` in your Obsidian vault's plugin directory:
   `<vault>/.obsidian/plugins/vtabs-engine/`
2. Copy `main.js`, `manifest.json`, and `styles.css` into that directory.
3. Reload Obsidian and enable **VTabs Engine** under **Community Plugins**.

---

## 📄 License: AGPLv3 & Cloud/SaaS Freedom

VTab Engine is licensed under the **GNU Affero General Public License v3.0 (AGPLv3)**.

AGPLv3 is GPLv3 plus one addition: GPLv3's copyleft obligation is triggered by *distributing* a copy of the software. That leaves a well-known gap — a company can take GPL code, modify it, run it only on their own servers, and offer it as a hosted service, and because they never hand anyone a literal copy of the binary, they're never obligated to share their modifications. AGPLv3 closes that gap: if you run a modified version of this code and let others interact with it over a network, you must also make that modified source available to those users (AGPLv3 §13).

For an Obsidian plugin specifically, which runs locally on each user's own machine, that clause mostly sits dormant in ordinary use — installing and using TabEngine doesn't involve "interacting with someone else's server" in the sense the clause targets. Where it matters is the scenario it's there to prevent: if this code (or a fork of it) ever gets embedded into a hosted product — a cloud note-taking service, a managed Obsidian-as-a-service offering, anything users reach over a network — AGPLv3 guarantees those users get the same right to the source that a locally-installed copy already gives you. It's forward-looking protection against exactly one thing: someone else's SaaS wrapper closing off what was open.

Practically, for contributors and users of the plugin itself, this changes very little day to day — you can install it, modify your own copy, and use it exactly as freely as any permissively-licensed plugin. The obligation only activates for someone who takes the code into a network-served product.
