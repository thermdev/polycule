import { useEffect, useRef } from 'react';
import { SceneManager } from '../three/SceneManager.js';
import {
  commitPositions,
  clearSelection,
  getState,
  selectEdge,
  selectNode,
  setLinkSource,
  toggleEdge,
  useStore,
} from '../state/store.js';

/**
 * Hosts the WebGL canvas. React owns the document; the SceneManager owns the
 * pixels. Everything crosses that boundary through two narrow paths: `sync`
 * going down, and the handler ref going back up.
 */
export function Viewport({ sceneRef }) {
  const containerRef = useRef(null);
  const graph = useStore((s) => s.graph);
  const selection = useStore((s) => s.selection);
  const linkSourceId = useStore((s) => s.ui.linkSourceId);

  // Scene callbacks are wired once, so they read live state through the store
  // rather than closing over stale props.
  const handlers = useRef({
    onNodeClick(nodeId, { shiftKey }) {
      const pending = getState().ui.linkSourceId;

      if (pending && pending !== nodeId) {
        toggleEdge(pending, nodeId);
        setLinkSource(null);
        selectNode(nodeId);
        return;
      }
      if (shiftKey) {
        const anchor = getState().selection.nodeId;
        if (anchor && anchor !== nodeId) {
          toggleEdge(anchor, nodeId);
          return;
        }
      }
      selectNode(nodeId);
    },
    onEdgeClick(edgeId) {
      setLinkSource(null);
      selectEdge(edgeId);
    },
    onEmptyClick() {
      setLinkSource(null);
      clearSelection();
    },
    onPositionsChanged(positions) {
      commitPositions(positions);
    },
  });

  useEffect(() => {
    const scene = new SceneManager(containerRef.current, {
      onNodeClick: (...args) => handlers.current.onNodeClick(...args),
      onEdgeClick: (...args) => handlers.current.onEdgeClick(...args),
      onEmptyClick: (...args) => handlers.current.onEmptyClick(...args),
      onPositionsChanged: (...args) => handlers.current.onPositionsChanged(...args),
    });
    sceneRef.current = scene;
    scene.sync(getState().graph);
    scene.settleAndFrame();

    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, [sceneRef]);

  useEffect(() => {
    sceneRef.current?.sync(graph);
  }, [graph, sceneRef]);

  useEffect(() => {
    sceneRef.current?.setSelection(selection);
  }, [selection, sceneRef]);

  useEffect(() => {
    sceneRef.current?.setLinkSource(linkSourceId);
  }, [linkSourceId, sceneRef]);

  // Escape cancels a pending connection; Delete removes the selection.
  useEffect(() => {
    function onKeyDown(event) {
      const tag = event.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;

      if (event.key === 'Escape') {
        setLinkSource(null);
        clearSelection();
      }
      if (event.key === 'f' || event.key === 'F') {
        const { nodeId } = getState().selection;
        if (nodeId) sceneRef.current?.focusNode(nodeId);
        else sceneRef.current?.frameAll();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [sceneRef]);

  return (
    <div className="viewport" ref={containerRef}>
      {linkSourceId ? (
        <div className="viewport-banner">
          Pick the other person to connect · <kbd>Esc</kbd> to cancel
        </div>
      ) : null}
      <ControlsHint />
    </div>
  );
}

function ControlsHint() {
  return (
    <div className="viewport-hint">
      <span><kbd>RMB</kbd> orbit</span>
      <span><kbd>MMB</kbd> pan</span>
      <span><kbd>Wheel</kbd> zoom</span>
      <span><kbd>WASD</kbd> fly · <kbd>Q</kbd>/<kbd>E</kbd> down/up</span>
      <span><kbd>LMB</kbd> drag a vertex</span>
      <span><kbd>Shift</kbd>+click links two people</span>
      <span><kbd>F</kbd> frame</span>
    </div>
  );
}
