# Mekanism Visualizer

Interactive local editor for block-based layouts inspired by Minecraft/Mekanism workflows.

This project is a React + TypeScript + Three.js application with a modular dock/floating UI, scene tree editing, inspector-driven transforms, block type management (including JAR texture import), and JSON project I/O.

---

### 1. What This Project Is

Mekanism Visualizer is a browser-based editor for building and organizing block structures in 3D.

It focuses on:
- visual layout design on a grid
- scene hierarchy and grouping
- block type customization (textures, render mode, conduit behavior)
- project import/export as JSON
- local workflow without backend services

---

### 2. Core Features

- 3D viewport with:
  - orbit camera controls
  - selection and hover outlines
  - grid helper
  - move/rotate gizmos
- Scene Tree:
  - group/object hierarchy
  - right-click context actions
  - inline rename
  - drag-and-drop node reordering
- Inspector:
  - position editing
  - rotation read-only view
  - block name/group assignment
  - conduit connection mode (`auto` / `manual`) and face mask editing
- Assets / Block Type Manager:
  - explorer-style folder navigation
  - folder CRUD and drag-drop moves
  - block type editing modal
  - conduit texture profile editor
  - grouped JAR/ZIP texture import flow
  - JSON pack import/export
  - single PNG import -> type creation
  - custom object type creation
- App shell:
  - docked/floating/minimized panels
  - bottom utility tabs (`Console` / `Assets`)
  - layout presets manager (save/load/overwrite/rename/delete)
  - persistent workspace state in local storage
- File workflows:
  - new/open/save/save as/export project
  - embedded block types in project files
- Undo/Redo:
  - snapshot-based history over scene + blocks + embedded types
- Console logging:
  - structured runtime logs (`info` / `warn` / `error`)

---

### 3. Tech Stack

- React 19
- TypeScript 5
- Vite 7
- Zustand (state management)
- Three.js (rendering)
- fflate (JAR/ZIP extraction in browser)
- ESLint 9
- React Compiler Babel plugin (enabled in Vite config)

---

### 4. Quick Start

#### Requirements
- Node.js 20+ recommended
- npm 10+ recommended

#### Install

```bash
npm install
```

#### Run dev server

```bash
npm run dev
```

#### Build production bundle

```bash
npm run build
```

#### Preview production build

```bash
npm run preview
```

#### Lint

```bash
npm run lint
```

---

### 5. Keyboard Shortcuts

- `Ctrl/Cmd + S` -> Save
- `Ctrl/Cmd + Shift + S` -> Save As
- `Ctrl/Cmd + O` -> Open Project
- `Ctrl/Cmd + N` -> New Project
- `Ctrl/Cmd + Z` -> Undo
- `Ctrl/Cmd + Shift + Z` -> Redo
- `Ctrl/Cmd + Y` -> Redo
- `Ctrl/Cmd + D` -> Duplicate selected block
- `Delete` / `Backspace` -> Delete selected block

---

### 6. Project Structure (Top-Down)

```text
src/
  App.tsx                          # Main app shell, menus, panel system, history, file workflows
  main.tsx                         # React entry point
  styles/global.css                # Main UI styling

  assets/
    assetsCommands.ts              # Cross-component asset command event bus

  components/
    BlockTypeManager.tsx           # Assets explorer + block type import/edit/export
    ConsolePanel.tsx               # Runtime console
    Inspector/Inspector.tsx        # Selected block inspector
    SceneTree/
      SceneTreeView.tsx            # Scene tree root and interactions
      SceneTreeNode.tsx            # Recursive tree node component
      sceneTreeUtils.ts            # Tree insert/remove/find helpers

  config/
    layout.ts                      # Legacy/aux layout limits

  data/
    defaultProject.json            # Initial scene template
    blockTypes/*.json              # Built-in block type definitions

  models/
    blocks.ts                      # Block/domain types
    sceneTree.ts                   # Scene tree node types
    project.ts                     # Project file model

  project/
    projectUtils.ts                # Project schema normalization + payload building

  state/
    useBlocksStore.ts              # Blocks + scene tree state/actions
    useBlockTypesStore.ts          # Block type registry + assets folders + import/export
    useProjectStore.ts             # Project meta/file/dirty state
    useConsoleStore.ts             # Log store and log helpers

  three/
    initScene.ts                   # Three.js scene setup + render/update logic
    gizmos/
      MoveGizmo.ts                 # Move manipulator
      RotateGizmo.ts               # Rotate manipulator

  utils/
    conduitConnections.ts          # Auto conduit mask computation
    usePanelLayout.ts              # Legacy/experimental panel layout helper
    useResize.ts                   # Legacy resize helper
```

---

### 7. Data Model and File Formats

#### 7.1 BlockDefinition (type registry)

Core fields:
- `id: string`
- `displayName: string`
- `color: number` (0xRRGGBB)
- `textures?: { all/right/left/top/bottom/front/back }`
- `renderMode?: "cube" | "conduit"`
- `connectTag?: string`
- `scale?: { x, y, z }`
- `textureProfile?: conduit-specific texture slots`
- `group?: string` (assets folder path)
- `internal?: boolean`

#### 7.2 BlockInstance (scene object)

Core fields:
- `id`
- `type` (BlockDefinition id)
- `position`
- `rotation`
- `parentGroupId`
- optional `name`
- optional `connections`:
  - `mode: "auto" | "manual"`
  - `mask: { right,left,top,bottom,front,back }`

#### 7.3 Scene tree

Two node types:
- `group` with recursive `children`
- `block` node linking to `blockId`

#### 7.4 Project file schema

Project schema is normalized in `src/project/projectUtils.ts`.

Current metadata version:
- `PROJECT_SCHEMA_VERSION = 2`

Project root shape:

```json
{
  "meta": {
    "name": "My Project",
    "version": 2,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  },
  "sceneTree": { "...": "SceneGroupNode" },
  "blocks": [{ "...": "BlockInstance" }],
  "embeddedBlockTypes": [{ "...": "BlockDefinition" }]
}
```

#### 7.5 Block type pack format

Used in import/export from Assets manager.

```json
{
  "version": 1,
  "generatedAt": "2026-01-01T00:00:00.000Z",
  "blockTypes": [{ "...": "BlockDefinition" }],
  "assetFolders": ["assets/textures", "assets/colors"]
}
```

---

### 8. Architecture Overview

#### 8.1 App shell (`src/App.tsx`)

Responsibilities:
- top menu actions (`File`, `Edit`, `App`, `Window`)
- workspace panel state (docked/floating/minimized/closed)
- utility tab switching (`console` / `assets`)
- center tabs (`Scene` / `Preview`)
- project file workflows and dirty-state prompts
- layout preset management and persistence (`localStorage`)
- history snapshots for undo/redo

#### 8.2 State layer (Zustand)

- `useBlocksStore`
  - scene objects + scene tree
  - object transforms
  - group/object tree operations
  - selection and transform mode
  - auto-connection mask recomputation for conduits
- `useBlockTypesStore`
  - built-in + imported definitions
  - folder registry for assets explorer
  - import/export of type packs
  - custom object creation
  - definition patching and conduit profile updates
- `useProjectStore`
  - project metadata, file name, dirty tracking
- `useConsoleStore`
  - log entries and log API

#### 8.3 Rendering layer (`src/three/initScene.ts`)

Responsibilities:
- scene/camera/renderer bootstrapping
- orbit controls
- move and rotate gizmos
- material and texture caching
- block mesh creation (cube and conduit)
- connection-aware conduit geometry and material selection
- outline helpers for selected/hover/group bounds
- runtime block updates from app state

#### 8.4 Scene editing UI

- SceneTree controls hierarchy and context actions.
- Inspector edits selected block properties.
- BlockTypeManager controls assets and type definitions.
- Console displays runtime operation logs.

---

### 9. Import and Asset Pipeline

`BlockTypeManager` supports:
- JSON pack import (`blockTypes` array)
- PNG import:
  - generates one new block type with that texture
- JAR/ZIP import:
  - archive is extracted in browser (fflate)
  - Mekanism-like texture candidates are grouped
  - user filters and selects groups in modal
  - selected groups are converted into block types
  - conduit-like types can receive inferred render mode/profile
- Export pack to JSON

Safety/limits:
- archive size guard exists (`JAR_FILE_SIZE_LIMIT`)
- schema parsing/validation with warnings in console

---

### 10. Layout System

Panel model:
- `PanelKind`: `sceneTree | assets | inspector | console`
- `PanelMode`: `docked | floating | minimized | closed`
- `DockArea`: `left | right | bottom`

Includes:
- resizable docks
- floating panel drag/resize
- top snap docking for floating windows
- taskbar restore for minimized panels
- preset lifecycle:
  - save new
  - load
  - overwrite
  - rename
  - delete

Stored under:
- `localStorage["mekanism-visualizer.layout.v1"]`

---

### 11. Logging and Diagnostics

All major runtime actions log into console store:
- source channel examples:
  - `FileMenu`
  - `EditMenu`
  - `WindowMenu`
  - `BlockTypes`
- levels:
  - `info`, `warn`, `error`

Console keeps last 200 entries.

---

### 12. Known Limitations

- No backend persistence; save/export uses file download.
- No automated test suite yet.
- Bundle size warning is expected in production build.
- Some helper files are legacy/experimental and not core runtime paths (`usePanelLayout`, `useResize`, `config/layout.ts`).
- JAR model inference is heuristic-based and cannot perfectly reconstruct all mod-specific rendering behavior.

---

### 13. Suggested Next Steps

- add automated tests for stores and project normalization
- split large components (`App.tsx`, `BlockTypeManager.tsx`) into smaller modules
- introduce architecture docs for panel subsystem and Three rendering pipeline
- add CI checks (`lint + typecheck + build`)
- formalize coding conventions and contribution guide

---

## Notes