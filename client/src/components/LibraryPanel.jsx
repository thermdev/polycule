import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { demoGraph, emptyGraph } from '../state/graph.js';
import {
  getState,
  loadDocument,
  newDocument,
  setStatus,
  useStore,
} from '../state/store.js';
import { Button } from './ui.jsx';

export function LibraryPanel({ sceneRef, onSaved }) {
  const doc = useStore((s) => s.doc);
  const dirty = useStore((s) => s.dirty);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.listPolycules());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh, doc.id, onSaved]);

  async function open(id) {
    if (dirty && !confirm('Discard unsaved changes and open this polycule?')) return;
    try {
      const record = await api.getPolycule(id);
      loadDocument(record);
      // Saved documents carry their positions, so frame them as-is.
      requestAnimationFrame(() => sceneRef.current?.settleAndFrame({ solve: false }));
      setStatus({ kind: 'info', message: `Opened “${record.name}”` });
    } catch (err) {
      setStatus({ kind: 'error', message: err.message });
    }
  }

  async function remove(id, name) {
    if (!confirm(`Delete “${name}”? This cannot be undone.`)) return;
    try {
      await api.deletePolycule(id);
      if (getState().doc.id === id) newDocument(emptyGraph());
      await refresh();
      setStatus({ kind: 'info', message: `Deleted “${name}”` });
    } catch (err) {
      setStatus({ kind: 'error', message: err.message });
    }
  }

  function start(graph, label) {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    newDocument(graph);
    requestAnimationFrame(() => sceneRef.current?.settleAndFrame());
    setStatus({ kind: 'info', message: label });
  }

  return (
    <div className="panel-body">
      <div className="button-row">
        <Button onClick={() => start(emptyGraph(), 'Started an empty polycule')}>
          New empty
        </Button>
        <Button onClick={() => start(demoGraph(), 'Loaded the example')}>Example</Button>
        <Button onClick={refresh}>Refresh</Button>
      </div>

      {error ? <p className="inline-error">Could not reach the server: {error}</p> : null}
      {loading ? <p className="panel-note dim">Loading…</p> : null}

      <ul className="library-list">
        {items.map((item) => (
          <li key={item.id} className={item.id === doc.id ? 'library-item current' : 'library-item'}>
            <button type="button" className="library-main" onClick={() => open(item.id)}>
              <span className="library-name">{item.name}</span>
              <span className="library-meta">
                {item.nodeCount} people · {item.edgeCount} connections ·{' '}
                {new Date(item.updatedAt).toLocaleString()}
              </span>
            </button>
            <button
              type="button"
              className="icon-btn danger"
              title="Delete"
              onClick={() => remove(item.id, item.name)}
            >
              ×
            </button>
          </li>
        ))}
        {!loading && items.length === 0 && !error ? (
          <li className="empty-note">Nothing saved yet.</li>
        ) : null}
      </ul>
    </div>
  );
}
