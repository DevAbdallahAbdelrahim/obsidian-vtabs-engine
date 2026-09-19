# VTabs Engine 🚀

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Obsidian API](https://img.shields.io/badge/Obsidian-v1.0.0%2B-purple.svg)](https://obsidian.md)
[![Build](https://img.shields.io/badge/Build-Passing-brightgreen.svg)]()

**VTabs Engine** is a high-performance, tree-structured vertical tab manager for Obsidian. Designed for power users, it replaces standard horizontal tab strips with a clean, responsive vertical sidebar hierarchy featuring group management, custom styling, instant search, and zero-overhead performance.

#### VTabs Engine Main Sidebar Interface

<img width="850" height="769" alt="main-sidebar-view" src="https://github.com/user-attachments/assets/971f22d6-5fcf-45aa-89e8-5d2ddb386494" />


---

## ✨ Key Features

### 🌲 Tree Hierarchy & Tab Grouping
Organize open tabs and custom groups in a collapsible vertical tree structure with item counter badges.

Grouped Vertical Tabs View
<img width="847" height="910" alt="grouped-tabs-view" src="https://github.com/user-attachments/assets/21e475bd-cf87-4f92-88f0-0a57b0512d84" />

---

### 🎨 Custom Accent Colors & Icons
Assign distinct colors and Lucide icons to individual tab groups for fast visual identification.

#### Color Picker Modal
<img width="1917" height="890" alt="color-picker-modal" src="https://github.com/user-attachments/assets/76ac5e87-cded-4b76-b57a-1f8451776377" />

---

### 🛠️ Inline Management Modals
Rename groups and manage workspace organization effortlessly via built-in modals.

#### Rename Group Modal
<img width="1916" height="756" alt="rename-modal" src="https://github.com/user-attachments/assets/a7c264d2-849c-42c0-85b6-4adea6705463" />


### ⚡ Additional Core Capabilities
- **Flat-Map Zustand Store**: Reactive state management decoupled from heavy render loops for smooth handling of dozens of tabs.
- **Instant Search**: Real-time filtering across active tabs, groups, and paths using optimized tree algorithms.
- **Native Obsidian Sync**: Seamless handling of workspace active leaf changes, leaf closures, pinned tabs, and vault file rename events.

---

## ⚙️ Configuration & Settings

Fine-tune the sidebar interface directly from Obsidian's Plugin Settings tab. Customize ribbon icon style, toggle tab icons, adjust nesting indent size, or enable compact view.

#### VTabs Engine Settings Page
<img width="1047" height="819" alt="settings-page" src="https://github.com/user-attachments/assets/3910d4e1-2d75-45e7-8b22-ee5a97b6538e" />

---

## 📂 Project Structure

```text
src/
├── main.ts                    # Plugin entry point & lifecycle hooks
├── obsidian-events.ts         # Native event listeners (Workspace & Vault)
├── modals/                    # Modals (Rename, Group, Icon, Color)
├── settings/                  # Plugin configuration tab
├── store/                     # Zustand state management engine
├── ui/                        # React UI view components & context
└── utils/                     # Tree traversal algorithms, search & persistence
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

## 📄 License & Software Freedom

Distributed under the **GNU Affero General Public License v3.0 (AGPLv3)**.

### Why AGPLv3?
`VTabs Engine` is proudly Free and Open-Source Software (FOSS). The AGPLv3 guarantees that:
- You are free to run, study, modify, and share this software.
- Any modified versions or network/cloud services utilizing this engine **must publish their complete source code under the same AGPLv3 license**.

See the `LICENSE` file for full terms.
