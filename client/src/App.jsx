import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { AdjacencyPanel } from './components/AdjacencyPanel.jsx';
import { Inspector } from './components/Inspector.jsx';
import { LibraryPanel } from './components/LibraryPanel.jsx';
import { PeoplePanel } from './components/PeoplePanel.jsx';
import { ScenePanel } from './components/ScenePanel.jsx';
import { Viewport } from './components/Viewport.jsx';
import { Button, DebouncedInput } from './components/ui.jsx';
import {
  canRedo,
  canUndo,
  commitPositions,
  getState,
  markSaved,
  redo,
  setDocMeta,
  setStatus,
  undo,
  useStore,
} from './state/store.js';

const TABS = [
  { id: 'people', label: 'People' },
  { id: 'adjacency', label: 'List' },
  { id: 'scene', label: 'Scene' },
  { id: 'library', label: 'Saved' },
];

export default function App() {
  const sceneRef = useRef(null);
  const [tab, setTab] = useState('people');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(0);

  const doc = useStore((s) => s.doc);
  const dirty = useStore((s) => s.dirty);
  const status = useStore((s) => s.status);
  const graph = useStore((s) => s.graph);

  /** Positions live in the scene, so pull them in before writing to the API. */
  const save = useCallback(
    async ({ asNew = false } = {}) => {
      const scene = sceneRef.current;
      if (scene) commitPositions(scene.getPositions());

      const current = getState();
      const name = current.doc.name?.trim() || 'Untitled polycule';

      setSaving(true);
      try {
        const record =
          current.doc.id && !asNew
            ? await api.updatePolycule(current.doc.id, name, current.graph)
            : await api.createPolycule(name, current.graph);
        markSaved({ id: record.id, name: record.name });
        setSavedAt(Date.now());
        setStatus({ kind: 'info', message: `Saved “${record.name}”` });
      } catch (err) {
        setStatus({ kind: 'error', message: `Save failed: ${err.message}` });
      } finally {
        setSaving(false);
      }
    },
    []
  );

  useEffect(() => {
    function onKeyDown(event) {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;

      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
      } else if (event.key.toLowerCase() === 'z') {
        const tag = event.target?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || event.target?.isContentEditable) return;
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [save]);

  // Warn before losing unsaved work.
  useEffect(() => {
    function onBeforeUnload(event) {
      if (!getState().dirty) return;
      event.preventDefault();
      event.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  function exportJson() {
    const scene = sceneRef.current;
    if (scene) commitPositions(scene.getPositions());
    const current = getState();
    downloadBlob(
      new Blob([JSON.stringify({ name: current.doc.name, data: current.graph }, null, 2)], {
        type: 'application/json',
      }),
      `${slug(current.doc.name)}.json`
    );
  }

  function exportPng() {
    const dataUrl = sceneRef.current?.screenshot();
    if (!dataUrl) return;
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = `${slug(doc.name)}.png`;
    link.click();
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">◈</span>
          <span className="brand-name">Polycule</span>
        </div>

        <DebouncedInput
          className="doc-name"
          value={doc.name}
          onCommit={(value) => setDocMeta({ name: value.trim() || 'Untitled polycule' })}
          aria-label="Polycule name"
        />
        {dirty ? <span className="dirty-dot" title="Unsaved changes" /> : null}

        <div className="topbar-spacer" />

        <span className="counts">
          {graph.nodes.length} people · {graph.edges.length} connections
        </span>

        <Button onClick={undo} disabled={!canUndo()} title="Undo (⌘Z)">
          ↶
        </Button>
        <Button onClick={redo} disabled={!canRedo()} title="Redo (⇧⌘Z)">
          ↷
        </Button>
        <Button onClick={exportPng} title="Download a PNG of the current view">
          PNG
        </Button>
        <Button onClick={exportJson} title="Download the document as JSON">
          JSON
        </Button>
        <Button onClick={() => save({ asNew: true })} disabled={saving}>
          Save as new
        </Button>
        <Button variant="primary" onClick={() => save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </header>

      <div className="workspace">
        <nav className="sidebar">
          <div className="tabs">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={tab === item.id ? 'tab active' : 'tab'}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          {tab === 'people' ? <PeoplePanel sceneRef={sceneRef} /> : null}
          {tab === 'adjacency' ? <AdjacencyPanel sceneRef={sceneRef} /> : null}
          {tab === 'scene' ? <ScenePanel sceneRef={sceneRef} /> : null}
          {tab === 'library' ? <LibraryPanel sceneRef={sceneRef} onSaved={savedAt} /> : null}
        </nav>

        <main className="stage">
          <Viewport sceneRef={sceneRef} />
        </main>

        <Inspector sceneRef={sceneRef} />
      </div>

      {status ? <div className={`toast toast-${status.kind}`}>{status.message}</div> : null}
    </div>
  );
}

function slug(name) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'polycule'
  );
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
