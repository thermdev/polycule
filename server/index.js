import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statements } from './db.js';

const here = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8787;
const MAX_BODY = '32mb';

const app = express();
app.use(cors());
app.use(express.json({ limit: MAX_BODY }));

/* ------------------------------------------------------------------ *
 * Validation
 * ------------------------------------------------------------------ */

const ALLOWED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
]);

function badRequest(res, message) {
  return res.status(400).json({ error: message });
}

/**
 * A graph document is intentionally permissive about styling fields (the
 * client owns those) but strict about identity: nodes need unique ids and
 * every edge must reference nodes that exist.
 */
function validateGraph(data) {
  if (!data || typeof data !== 'object') return 'graph must be an object';
  if (!Array.isArray(data.nodes)) return 'graph.nodes must be an array';
  if (!Array.isArray(data.edges)) return 'graph.edges must be an array';
  if (data.nodes.length > 2000) return 'graph.nodes exceeds 2000 entries';
  if (data.edges.length > 8000) return 'graph.edges exceeds 8000 entries';

  const ids = new Set();
  for (const node of data.nodes) {
    if (!node || typeof node.id !== 'string' || !node.id) return 'every node needs a string id';
    if (ids.has(node.id)) return `duplicate node id: ${node.id}`;
    ids.add(node.id);
  }
  for (const edge of data.edges) {
    if (!edge || typeof edge.source !== 'string' || typeof edge.target !== 'string') {
      return 'every edge needs string source and target';
    }
    if (!ids.has(edge.source)) return `edge references unknown node: ${edge.source}`;
    if (!ids.has(edge.target)) return `edge references unknown node: ${edge.target}`;
  }
  return null;
}

function rowToPolycule(row) {
  return {
    id: row.id,
    name: row.name,
    data: JSON.parse(row.data),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/* ------------------------------------------------------------------ *
 * Polycule CRUD
 * ------------------------------------------------------------------ */

app.get('/api/polycules', (_req, res) => {
  const rows = statements.listPolycules.all();
  res.json(
    rows.map((row) => {
      const data = JSON.parse(row.data);
      return {
        id: row.id,
        name: row.name,
        nodeCount: data.nodes?.length ?? 0,
        edgeCount: data.edges?.length ?? 0,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    })
  );
});

app.get('/api/polycules/:id', (req, res) => {
  const row = statements.getPolycule.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.json(rowToPolycule(row));
});

app.post('/api/polycules', (req, res) => {
  const { name, data } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) return badRequest(res, 'name is required');
  const problem = validateGraph(data);
  if (problem) return badRequest(res, problem);

  const id = randomUUID();
  const now = Date.now();
  statements.insertPolycule.run(id, name.trim(), JSON.stringify(data), now, now);
  res.status(201).json(rowToPolycule(statements.getPolycule.get(id)));
});

app.put('/api/polycules/:id', (req, res) => {
  const existing = statements.getPolycule.get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not found' });

  const { name, data } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim()) return badRequest(res, 'name is required');
  const problem = validateGraph(data);
  if (problem) return badRequest(res, problem);

  statements.updatePolycule.run(name.trim(), JSON.stringify(data), Date.now(), req.params.id);
  res.json(rowToPolycule(statements.getPolycule.get(req.params.id)));
});

app.delete('/api/polycules/:id', (req, res) => {
  const info = statements.deletePolycule.run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.status(204).end();
});

/* ------------------------------------------------------------------ *
 * Image assets (vertex textures, background maps)
 * ------------------------------------------------------------------ */

app.post('/api/assets', (req, res) => {
  const { dataUrl } = req.body ?? {};
  if (typeof dataUrl !== 'string') return badRequest(res, 'dataUrl is required');

  const match = /^data:([\w/+.-]+);base64,(.+)$/s.exec(dataUrl);
  if (!match) return badRequest(res, 'dataUrl must be a base64 data URL');

  const [, mime, base64] = match;
  if (!ALLOWED_IMAGE_MIME.has(mime)) return badRequest(res, `unsupported image type: ${mime}`);

  const bytes = Buffer.from(base64, 'base64');
  if (bytes.length === 0) return badRequest(res, 'image is empty');
  if (bytes.length > 12 * 1024 * 1024) return badRequest(res, 'image exceeds 12MB');

  const id = randomUUID();
  statements.insertAsset.run(id, mime, bytes, Date.now());
  res.status(201).json({ id, url: `/api/assets/${id}` });
});

app.get('/api/assets/:id', (req, res) => {
  const row = statements.getAsset.get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  res.set('Content-Type', row.mime);
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  res.send(row.bytes);
});

/* ------------------------------------------------------------------ *
 * Static client (production build)
 * ------------------------------------------------------------------ */

const clientDist = join(here, '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(join(clientDist, 'index.html')));
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

app.listen(PORT, () => {
  console.log(`polycule server listening on http://localhost:${PORT}`);
});
