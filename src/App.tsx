import { useEffect, useRef } from "react";
import initScene, { type SceneAPI } from "./three/initScene";
import { useBlocksStore } from "./state/useBlocksStore";
import Inspector from "./components/Inspector/Inspector";
import SceneTreeView from "./components/SceneTree/SceneTreeView";
import type { ProjectData } from "./models/project";
import defaultProject from "./data/defaultProject.json";
import { usePanelLayout } from "./utils/usePanelLayout";

const App = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<SceneAPI | null>(null);
  const renderedIdsRef = useRef<Set<string>>(new Set());

  const blocks = useBlocksStore((s) => s.blocks);
  const selectedBlockId = useBlocksStore((s) => s.selectedBlockId);
  const selectBlock = useBlocksStore((s) => s.selectBlock);
  const loadProject = useBlocksStore((s) => s.loadProject);

  const {
    leftWidth,
    rightWidth,
    consoleHeight,
    startLeftResize,
    startRightResize,
    startConsoleResize,
  } = usePanelLayout();

  useEffect(() => {
    loadProject(defaultProject as ProjectData);
  }, [loadProject]);

  useEffect(() => {
    if (!mountRef.current) return;

    const api = initScene(
      mountRef.current,
      [],
      (id) => selectBlock(id)
    );

    sceneRef.current = api;

    return () => {
      api.cleanup();
      sceneRef.current = null;
      renderedIdsRef.current.clear();
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
            <button>Orbit</button>
            <button>Move</button>
            <button>Rotate</button>
          </div>

          <h3>Scene</h3>
          <SceneTreeView />
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

          <div
  className={[
    "console-panel",
    consoleHeight <= 30 && "collapsed"
  ]
    .filter(Boolean)
    .join(" ")}
>

            <h4 className="console-title">Console</h4>
            <div className="console-content">
              Engine logs will appear here...
            </div>
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