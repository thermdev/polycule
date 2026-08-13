import { useMemo, useState } from 'react';
import { NODE_PALETTE, neighborsOf } from '../state/graph.js';
import {
  clearSelection,
  removeEdge,
  removeNode,
  selectNode,
  setLinkSource,
  setStatus,
  toggleEdge,
  updateEdge,
  updateNode,
  useStore,
} from '../state/store.js';
import { uploadImageFile } from '../api.js';
import { Button, ColorField, DebouncedInput, Field, ImagePicker, Segmented, Slider } from './ui.jsx';

export function Inspector({ sceneRef }) {
  const graph = useStore((s) => s.graph);
  const selection = useStore((s) => s.selection);

  const node = graph.nodes.find((n) => n.id === selection.nodeId);
  const edge = graph.edges.find((e) => e.id === selection.edgeId);

  if (node) return <NodeInspector graph={graph} node={node} sceneRef={sceneRef} />;
  if (edge) return <EdgeInspector graph={graph} edge={edge} />;
  return (
    <aside className="inspector empty">
      <p>Click a vertex or an edge in the 3D view to style it.</p>
    </aside>
  );
}

/* ------------------------------------------------------------------ */

function NodeInspector({ graph, node, sceneRef }) {
  const [connectTo, setConnectTo] = useState('');

  const neighbors = useMemo(() => {
    const ids = new Set(neighborsOf(graph, node.id));
    return graph.nodes.filter((n) => ids.has(n.id));
  }, [graph, node.id]);

  const unconnected = useMemo(() => {
    const ids = new Set(neighborsOf(graph, node.id));
    return graph.nodes.filter((n) => n.id !== node.id && !ids.has(n.id));
  }, [graph, node.id]);

  async function handleImage(file) {
    const url = await uploadImageFile(file, { maxSize: 512 });
    updateNode(node.id, { imageUrl: url });
  }

  return (
    <aside className="inspector">
      <header className="inspector-head">
        <span className="inspector-kind">Vertex</span>
        <h2>{node.label}</h2>
      </header>

      <Field label="Name">
        <DebouncedInput
          value={node.label}
          onCommit={(value) => {
            const trimmed = value.trim();
            if (!trimmed) return;
            updateNode(node.id, { label: trimmed });
          }}
        />
      </Field>

      <ColorField
        label="Colour"
        value={node.color}
        onChange={(value) => updateNode(node.id, { color: value })}
      />
      <div className="swatches">
        {NODE_PALETTE.map((color) => (
          <button
            key={color}
            type="button"
            className={`swatch${node.color === color ? ' active' : ''}`}
            style={{ background: color }}
            title={color}
            onClick={() => updateNode(node.id, { color })}
          />
        ))}
      </div>

      <Field label="Image" hint="rendered flat on the vertex">
        <div className="image-row">
          {node.imageUrl ? (
            <img className="image-preview" src={node.imageUrl} alt="" />
          ) : (
            <span className="image-preview placeholder" style={{ background: node.color }} />
          )}
          <div className="image-actions">
            <ImagePicker label={node.imageUrl ? 'Replace' : 'Upload'} onPick={handleImage} />
            {node.imageUrl ? (
              <Button onClick={() => updateNode(node.id, { imageUrl: null })}>Remove</Button>
            ) : null}
          </div>
        </div>
      </Field>

      <Slider
        label="Size"
        min={0.4}
        max={3}
        step={0.05}
        value={node.size ?? 1}
        onChange={(value) => updateNode(node.id, { size: value }, { history: false })}
        format={(value) => `${value.toFixed(2)}×`}
      />

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={!!node.pinned}
          onChange={(event) => updateNode(node.id, { pinned: event.target.checked })}
        />
        <span>Pin in place (ignore the layout)</span>
      </label>

      <section className="sub-section">
        <h3>Connections ({neighbors.length})</h3>
        <ul className="chip-list">
          {neighbors.map((other) => (
            <li key={other.id}>
              <button
                type="button"
                className="chip"
                onClick={() => selectNode(other.id)}
                style={{ borderColor: other.color }}
              >
                {other.label}
              </button>
              <button
                type="button"
                className="chip-x"
                title={`Disconnect ${other.label}`}
                onClick={() => toggleEdge(node.id, other.id)}
              >
                ×
              </button>
            </li>
          ))}
          {neighbors.length === 0 ? <li className="empty-note">No connections yet.</li> : null}
        </ul>

        {unconnected.length ? (
          <div className="add-row">
            <select value={connectTo} onChange={(event) => setConnectTo(event.target.value)}>
              <option value="">Connect to…</option>
              {unconnected.map((other) => (
                <option key={other.id} value={other.id}>
                  {other.label}
                </option>
              ))}
            </select>
            <Button
              variant="primary"
              disabled={!connectTo}
              onClick={() => {
                toggleEdge(node.id, connectTo);
                setConnectTo('');
              }}
            >
              Link
            </Button>
          </div>
        ) : null}

        <Button onClick={() => setLinkSource(node.id)}>Pick in 3D view…</Button>
      </section>

      <div className="button-row spaced">
        <Button onClick={() => sceneRef.current?.focusNode(node.id)}>Focus</Button>
        <Button
          variant="danger"
          onClick={() => {
            removeNode(node.id);
            setStatus({ kind: 'info', message: `Removed ${node.label}` });
          }}
        >
          Delete
        </Button>
      </div>
    </aside>
  );
}

/* ------------------------------------------------------------------ */

function EdgeInspector({ graph, edge }) {
  const source = graph.nodes.find((n) => n.id === edge.source);
  const target = graph.nodes.find((n) => n.id === edge.target);
  const gradient = `linear-gradient(90deg, ${source?.color ?? '#fff'}, ${target?.color ?? '#fff'})`;

  return (
    <aside className="inspector">
      <header className="inspector-head">
        <span className="inspector-kind">Edge</span>
        <h2>
          <button type="button" className="link-btn" onClick={() => selectNode(edge.source)}>
            {source?.label ?? '?'}
          </button>
          <span className="edge-arrow">—</span>
          <button type="button" className="link-btn" onClick={() => selectNode(edge.target)}>
            {target?.label ?? '?'}
          </button>
        </h2>
      </header>

      <Field label="Colour mode">
        <Segmented
          value={edge.colorMode ?? 'gradient'}
          onChange={(value) => updateEdge(edge.id, { colorMode: value })}
          options={[
            { value: 'gradient', label: 'Gradient' },
            { value: 'solid', label: 'Solid' },
          ]}
        />
      </Field>

      {edge.colorMode === 'solid' ? (
        <ColorField
          label="Edge colour"
          value={edge.color}
          onChange={(value) => updateEdge(edge.id, { color: value })}
        />
      ) : (
        <Field label="Gradient" hint="follows the two vertex colours">
          <div className="gradient-preview" style={{ background: gradient }} />
        </Field>
      )}

      <Slider
        label="Thickness"
        min={0.2}
        max={4}
        step={0.05}
        value={edge.width ?? 1}
        onChange={(value) => updateEdge(edge.id, { width: value }, { history: false })}
        format={(value) => `${value.toFixed(2)}×`}
      />

      <Slider
        label="Opacity"
        min={0.1}
        max={1}
        step={0.01}
        value={edge.opacity ?? 0.92}
        onChange={(value) => updateEdge(edge.id, { opacity: value }, { history: false })}
        format={(value) => `${Math.round(value * 100)}%`}
      />

      <div className="button-row spaced">
        <Button onClick={() => clearSelection()}>Deselect</Button>
        <Button variant="danger" onClick={() => removeEdge(edge.id)}>
          Delete edge
        </Button>
      </div>
    </aside>
  );
}
