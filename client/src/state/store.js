import { useSyncExternalStore } from 'react';
import {
  createEdge,
  createNode,
  demoGraph,
  edgeKey,
  normalizeGraph,
  parseAdjacency,
} from './graph.js';

/* ------------------------------------------------------------------ *
 * A tiny external store: the 3D scene reads it imperatively, React
 * reads it through useSyncExternalStore.
 * ------------------------------------------------------------------ */

const listeners = new Set();

let state = {
  graph: demoGraph(),
  selection: { nodeId: null, edgeId: null },
  doc: { id: null, name: 'Untitled polycule' },
  // linkSourceId: the vertex a new connection is being drawn from, if any.
  ui: { linkSourceId: null },
  dirty: false,
  status: null, // { kind: 'info' | 'error', message }
};

const history = { past: [], future: [] };
const HISTORY_LIMIT = 60;

export function getState() {
  return state;
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  for (const listener of listeners) listener();
}

function setState(patch) {
  state = { ...state, ...patch };
  emit();
}

export function useStore(selector = (s) => s) {
  return useSyncExternalStore(
    subscribe,
    () => selector(getState()),
    () => selector(getState())
  );
}

/* ------------------------------------------------------------------ *
 * Graph mutation
 * ------------------------------------------------------------------ */

/**
 * @param updater  (graph) => nextGraph
 * @param options.history  push the previous graph onto the undo stack
 * @param options.dirty    mark the document as having unsaved changes
 */
export function updateGraph(updater, options = {}) {
  const { history: track = true, dirty = true } = options;
  const previous = state.graph;
  const next = updater(previous);
  if (!next || next === previous) return;

  if (track) {
    history.past.push(previous);
    if (history.past.length > HISTORY_LIMIT) history.past.shift();
    history.future.length = 0;
  }
  setState({ graph: next, dirty: dirty || state.dirty });
}

export function canUndo() {
  return history.past.length > 0;
}
export function canRedo() {
  return history.future.length > 0;
}

export function undo() {
  const previous = history.past.pop();
  if (!previous) return;
  history.future.push(state.graph);
  setState({ graph: previous, dirty: true });
}

export function redo() {
  const next = history.future.pop();
  if (!next) return;
  history.past.push(state.graph);
  setState({ graph: next, dirty: true });
}

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

export function selectNode(nodeId) {
  setState({ selection: { nodeId, edgeId: null } });
}

export function selectEdge(edgeId) {
  setState({ selection: { nodeId: null, edgeId } });
}

export function clearSelection() {
  setState({ selection: { nodeId: null, edgeId: null } });
}

/** Begin (or cancel) drawing a connection out of a vertex. */
export function setLinkSource(nodeId) {
  setState({ ui: { ...state.ui, linkSourceId: nodeId } });
}

/* ------------------------------------------------------------------ *
 * Node / edge operations
 * ------------------------------------------------------------------ */

export function addNode(label, { connectTo = [], position = null } = {}) {
  const trimmed = String(label).trim();
  if (!trimmed) return null;

  let created = null;
  updateGraph((graph) => {
    const overrides = { paletteIndex: graph.nodes.length };
    if (position) Object.assign(overrides, position);
    created = createNode(trimmed, overrides);

    const existing = new Set(graph.edges.map((e) => edgeKey(e.source, e.target)));
    const newEdges = [];
    for (const otherId of connectTo) {
      if (otherId === created.id) continue;
      if (!graph.nodes.some((n) => n.id === otherId)) continue;
      const key = edgeKey(created.id, otherId);
      if (existing.has(key)) continue;
      existing.add(key);
      newEdges.push(createEdge(created.id, otherId));
    }
    return {
      ...graph,
      nodes: [...graph.nodes, created],
      edges: [...graph.edges, ...newEdges],
    };
  });
  return created;
}

export function removeNode(nodeId) {
  updateGraph((graph) => ({
    ...graph,
    nodes: graph.nodes.filter((n) => n.id !== nodeId),
    edges: graph.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
  }));
  if (state.selection.nodeId === nodeId) clearSelection();
  if (state.ui.linkSourceId === nodeId) setLinkSource(null);
}

export function updateNode(nodeId, patch, options = {}) {
  updateGraph(
    (graph) => ({
      ...graph,
      nodes: graph.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
    }),
    options
  );
}

/** Bulk position commit from the 3D scene — never tracked in undo history. */
export function commitPositions(positions) {
  updateGraph(
    (graph) => ({
      ...graph,
      nodes: graph.nodes.map((n) => {
        const p = positions.get(n.id);
        return p ? { ...n, x: p.x, y: p.y, z: p.z } : n;
      }),
    }),
    { history: false, dirty: false }
  );
}

export function toggleEdge(aId, bId) {
  if (!aId || !bId || aId === bId) return;
  updateGraph((graph) => {
    const key = edgeKey(aId, bId);
    const existing = graph.edges.find((e) => edgeKey(e.source, e.target) === key);
    if (existing) {
      return { ...graph, edges: graph.edges.filter((e) => e.id !== existing.id) };
    }
    return { ...graph, edges: [...graph.edges, createEdge(aId, bId)] };
  });
}

export function removeEdge(edgeId) {
  updateGraph((graph) => ({ ...graph, edges: graph.edges.filter((e) => e.id !== edgeId) }));
  if (state.selection.edgeId === edgeId) clearSelection();
}

export function updateEdge(edgeId, patch, options = {}) {
  updateGraph(
    (graph) => ({
      ...graph,
      edges: graph.edges.map((e) => (e.id === edgeId ? { ...e, ...patch } : e)),
    }),
    options
  );
}

export function updateBackground(patch) {
  updateGraph((graph) => ({ ...graph, background: { ...graph.background, ...patch } }));
}

export function updateLayout(patch) {
  updateGraph((graph) => ({ ...graph, layout: { ...graph.layout, ...patch } }), {
    history: false,
  });
}

/* ------------------------------------------------------------------ *
 * Adjacency-list import
 * ------------------------------------------------------------------ */

export function applyAdjacency(text) {
  const { nodes, edges, errors } = parseAdjacency(text, state.graph.nodes);
  updateGraph((graph) => ({ ...graph, nodes, edges }));
  const { nodeId } = state.selection;
  if (nodeId && !nodes.some((n) => n.id === nodeId)) clearSelection();
  setStatus(
    errors.length
      ? { kind: 'error', message: errors.slice(0, 3).join(' · ') }
      : { kind: 'info', message: `Loaded ${nodes.length} people, ${edges.length} connections` }
  );
  return errors;
}

/* ------------------------------------------------------------------ *
 * Document lifecycle
 * ------------------------------------------------------------------ */

export function loadDocument({ id, name, data }) {
  history.past.length = 0;
  history.future.length = 0;
  setState({
    graph: normalizeGraph(data),
    doc: { id, name },
    selection: { nodeId: null, edgeId: null },
    ui: { linkSourceId: null },
    dirty: false,
  });
}

export function newDocument(graph) {
  history.past.length = 0;
  history.future.length = 0;
  setState({
    graph: normalizeGraph(graph),
    doc: { id: null, name: 'Untitled polycule' },
    selection: { nodeId: null, edgeId: null },
    ui: { linkSourceId: null },
    dirty: false,
  });
}

export function setDocMeta(patch) {
  setState({ doc: { ...state.doc, ...patch } });
}

export function markSaved({ id, name }) {
  setState({ doc: { id, name }, dirty: false });
}

export function setDirty(value) {
  setState({ dirty: value });
}

let statusTimer = null;
export function setStatus(status) {
  setState({ status });
  clearTimeout(statusTimer);
  if (status) statusTimer = setTimeout(() => setState({ status: null }), 4000);
}
