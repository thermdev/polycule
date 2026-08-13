import { useMemo, useState } from 'react';
import { degreeMap } from '../state/graph.js';
import {
  addNode,
  removeNode,
  selectNode,
  setLinkSource,
  setStatus,
  useStore,
} from '../state/store.js';
import { Button } from './ui.jsx';

export function PeoplePanel({ sceneRef }) {
  const graph = useStore((s) => s.graph);
  const selection = useStore((s) => s.selection);
  const linkSourceId = useStore((s) => s.ui.linkSourceId);
  const [name, setName] = useState('');
  const [filter, setFilter] = useState('');

  const degrees = useMemo(() => degreeMap(graph), [graph]);
  const selected = graph.nodes.find((n) => n.id === selection.nodeId) ?? null;

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = needle
      ? graph.nodes.filter((n) => n.label.toLowerCase().includes(needle))
      : graph.nodes;
    return [...list].sort((a, b) => a.label.localeCompare(b.label));
  }, [graph.nodes, filter]);

  function handleAdd(event) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    const duplicate = graph.nodes.find(
      (n) => n.label.toLowerCase() === trimmed.toLowerCase()
    );
    if (duplicate) {
      setStatus({ kind: 'error', message: `${duplicate.label} is already here` });
      return;
    }

    // A new person joins next to whoever is selected, so they land in context
    // instead of across the scene.
    const anchor = selected ? { x: selected.x + 6, y: selected.y + 3, z: selected.z } : null;
    const created = addNode(trimmed, {
      connectTo: selected ? [selected.id] : [],
      position: anchor,
    });
    setName('');
    if (created) selectNode(created.id);
  }

  return (
    <div className="panel-body">
      <form className="add-row" onSubmit={handleAdd}>
        <input
          type="text"
          placeholder="Add a person…"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button variant="primary" onClick={handleAdd}>
          Add
        </Button>
      </form>
      {selected ? (
        <p className="panel-note">
          New people are connected to <strong>{selected.label}</strong> automatically.
        </p>
      ) : (
        <p className="panel-note">Select someone first to auto-connect new additions.</p>
      )}

      {graph.nodes.length > 8 ? (
        <input
          type="search"
          className="filter-input"
          placeholder="Filter…"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      ) : null}

      <ul className="people-list">
        {visible.map((node) => {
          const isSelected = node.id === selection.nodeId;
          const isLinkSource = node.id === linkSourceId;
          return (
            <li
              key={node.id}
              className={`person${isSelected ? ' selected' : ''}${isLinkSource ? ' linking' : ''}`}
            >
              <button
                type="button"
                className="person-main"
                onClick={() => {
                  if (linkSourceId && linkSourceId !== node.id) return;
                  selectNode(node.id);
                  sceneRef.current?.focusNode(node.id);
                }}
              >
                <span
                  className="person-swatch"
                  style={{
                    background: node.imageUrl ? `url(${node.imageUrl}) center/cover` : node.color,
                    borderColor: node.color,
                  }}
                />
                <span className="person-name">{node.label}</span>
                <span className="person-degree">{degrees.get(node.id) ?? 0}</span>
              </button>
              <div className="person-actions">
                <button
                  type="button"
                  title={isLinkSource ? 'Cancel connecting' : 'Connect to…'}
                  className={isLinkSource ? 'icon-btn active' : 'icon-btn'}
                  onClick={() => setLinkSource(isLinkSource ? null : node.id)}
                >
                  ⇄
                </button>
                <button
                  type="button"
                  title="Remove"
                  className="icon-btn danger"
                  onClick={() => removeNode(node.id)}
                >
                  ×
                </button>
              </div>
            </li>
          );
        })}
        {visible.length === 0 ? (
          <li className="empty-note">Nobody here yet.</li>
        ) : null}
      </ul>
    </div>
  );
}
