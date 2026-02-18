import { useEffect, useRef } from "react";
import initScene, { type SceneAPI } from "./three/initScene";
import { useBlocksStore } from "./state/useBlocksStore";
import { useBlockTypesStore } from "./state/useBlockTypesStore";
import { logInfo } from "./state/useConsoleStore";
import Inspector from "./components/Inspector/Inspector";
import SceneTreeView from "./components/SceneTree/SceneTreeView";
import BlockTypeManager from "./components/BlockTypeManager";
import ConsolePanel from "./components/ConsolePanel";
import type { ProjectData } from "./models/project";
import defaultProject from "./data/defaultProject.json";
import { usePanelLayout } from "./utils/usePanelLayout";

const App = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneAPI | null>(null);
  const renderedIdsRef = useRef<Set<string>>(new Set());
  const didLogProjectLoadRef = useRef(false);

  const blocks = useBlocksStore((s) => s.blocks);
  const selectedBlockId = useBlocksStore((s) => s.selectedBlockId);
  const selectBlock = useBlocksStore((s) => s.selectBlock);
  const loadProject = useBlocksStore((s) => s.loadProject);
  const initializeBuiltInTypes = useBlockTypesStore((s) => s.initializeBuiltInTypes);

  const mode = useBlocksStore((s) => s.mode);
  const transformMode = useBlocksStore((s) => s.transformMode);
  const setMode = useBlocksStore((s) => s.setMode);
  const setTransformMode = useBlocksStore((s) => s.setTransformMode);

  const {
    leftWidth,
    rightWidth,
    consoleHeight,
    sceneHeight,
    startLeftResize,
    startRightResize,
    startConsoleResize,
    startSceneResize,
  } = usePanelLayout();

  useEffect(() => {
    initializeBuiltInTypes();
  }, [initializeBuiltInTypes]);

  useEffect(() => {
    loadProject(defaultProject as ProjectData);
    if (!didLogProjectLoadRef.current) {
      didLogProjectLoadRef.current = true;
      logInfo("Project", "Loaded default project.");
    }
  }, [loadProject]);

  useEffect(() => {
    if (!mountRef.current) return;
    const renderedIds = renderedIdsRef.current;

    const api = initScene(
      mountRef.current,
      [],
      (id) => selectBlock(id)
    );

    sceneRef.current = api;

    return () => {
      api.cleanup();
      sceneRef.current = null;
      renderedIds.clear();
    };
  }, [selectBlock]);

  useEffect(() => {
    if (!sceneRef.current) return;

    const api = sceneRef.current;
    const renderedIds = renderedIdsRef.current;
    const currentIds = new Set(blocks.map((b) => b.id));

    renderedIds.forEach((id) => {
      if (!currentIds.has(id)) {
        api.removeBlock(id);
        renderedIds.delete(id);
      }
    });

    blocks.forEach((b) => {
      if (!renderedIds.has(b.id)) {
        api.addBlock(b);
        renderedIds.add(b.id);
      } else {
        api.updateBlock(b);
      }
    });
  }, [blocks]);

  useEffect(() => {
    sceneRef.current?.setSelectedBlock(selectedBlockId);
  }, [selectedBlockId]);

  return (
    <div className="layout-root">
      <div className="topbar">
        <div className="menu">
          <div className="menu-item">
            File
            <div className="dropdown">
              <div>New</div>
              <div>Open</div>
              <div>Save</div>
              <div>Export</div>
            </div>
          </div>
          <div className="menu-item">
            Edit
            <div className="dropdown">
              <div>Undo</div>
              <div>Redo</div>
            </div>
          </div>
        </div>
      </div>

      <div className="layout-main" style={{gridTemplateColumns: `${leftWidth}px 5px 1fr 5px ${rightWidth}px`,}}>
        <div className="panel-left">
          <div className="mode-toolbar">
            <button
              className={mode === "view" ? "active" : ""}
              onClick={() => {
                setMode("view");
                setTransformMode("none");
              }}
            >
              Orbit
            </button>

            <button
              className={
                mode === "edit" && transformMode === "move"
                  ? "active"
                  : ""
              }
              onClick={() => {
                setMode("edit");
                setTransformMode("move");
              }}
            >
              Move
            </button>

            <button
              className={
                mode === "edit" && transformMode === "rotate"
                  ? "active"
                  : ""
              }
              onClick={() => {
                setMode("edit");
                setTransformMode("rotate");
              }}
            >
              Rotate
            </button>
          </div>


          <div
            className="panel-section"
            style={{ height: `${sceneHeight}px` }}
          >
            <div className="panel-section-header">Scene</div>
            <div className="scene-tree-container">
              <SceneTreeView />
            </div>
          </div>

          <div
            className="resize-horizontal"
            onMouseDown={startSceneResize}
          />

          <div className="panel-section" style={{ flex: 1 }}>
            <div className="panel-section-header">Assets</div>
            <div className="assets-container">
              <BlockTypeManager />
            </div>
          </div>
        </div>
        <div
          className="resize-vertical"
          onMouseDown={startLeftResize}
        />

        <div
          className="center-area"
          style={{
            gridTemplateRows: `32px 1fr 5px ${consoleHeight}px`,
          }}
        >
          <div className="canvas-header">
            <span className="tab active">Scene</span>
            <span className="tab">Preview</span>
          </div>

          <div className="canvas-wrapper" ref={mountRef} />

          <div
            className="resize-horizontal"
            onMouseDown={startConsoleResize}
          />

          <div className={["console-panel", consoleHeight <= 30 && "collapsed"].filter(Boolean).join(" ")}>
            <h4 className="console-title">Console</h4>
            <ConsolePanel />
          </div>
        </div>
        <div
          className="resize-vertical"
          onMouseDown={startRightResize}
        />

        <div className="panel-right">
          <Inspector />
        </div>
      </div>
    </div>
  );
};

export default App;
