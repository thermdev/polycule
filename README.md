# Polycule

A full-stack web app for visualizing polyamorous relationship networks in 3D.

People are flat, camera-facing discs — a solid colour or their photo. Relationships
are tubes drawn through 3D space, coloured either solid or as a gradient running
between the two people's colours. A force-directed layout arranges everything, and
you can grab any vertex and drag it wherever you want.

## Running it

```bash
npm install
npm run dev
```

Then open <http://localhost:5173>. That runs the API on port 8787 and the Vite dev
server on 5173, which proxies `/api` across.

For a production build:

```bash
npm start        # builds the client, serves everything from :8787
```

## Getting people in

**Adjacency list** (the *List* tab) — one relationship per line:

```
A-B
A-C
A-D
B-A        # same as A-B, collapsed into one edge
C-D
Solo       # a lone name adds someone unattached
X-Y-Z      # chains into X-Y and Y-Z
```

Separators are flexible: `-`, `->`, `,`, `:`, `|`, tabs, or the word `to`. Text after
`#` or `;` is a comment. Re-applying the list keeps the colours, images and positions
of anyone whose name did not change.

**Or build it by hand** (the *People* tab) — type a name and hit Add. Whoever is
selected becomes the new person's first connection automatically, so you can grow a
network without touching the list. To connect two existing people, either pick from
the *Connect to…* dropdown in the inspector, hit **Pick in 3D view…** and click the
other person, or just shift-click them in the viewport.

## Navigating the 3D view

| Input | Action |
| --- | --- |
| Right drag | Orbit around the focus point |
| Middle drag | Pan |
| Wheel | Zoom |
| `W` `A` `S` `D` | Fly relative to where you're looking |
| `Q` / `E` (or `Ctrl` / `Space`) | Fly down / up |
| `Shift` | 3× movement boost |
| Left drag on a vertex | Move that person through space |
| Left click | Select a vertex or an edge |
| Shift + click | Connect the clicked person to the selected one |
| `F` | Frame the selection, or the whole graph |
| `Esc` | Clear the selection |

Dragging a vertex moves it on the plane facing the camera; orbit first if you want to
move someone along a different axis. Neighbours react as you drag. Anyone you want to
stay put can be **pinned**, which excludes them from the layout entirely.

## Styling

**Vertices** — solid colour (freeform or from the palette), or an uploaded image
rendered flat on the disc, centre-cropped to a circle. The person's colour stays on as
a ring, so images don't cost you their identity. Size is adjustable per person.

**Edges** — *gradient* blends between the two people's colours along the tube;
*solid* uses one colour for the whole edge. Thickness and opacity are per-edge.

**Background** — three modes:
- *Solid* — a flat colour.
- *Space* — a real 3D starfield, with adjustable count and tint. The stars sit in
  world space, so flying with `WASD` gives you genuine parallax.
- *Sky map* — upload an equirectangular (2:1) image to wrap the whole sky.

## Layout

The *Scene* tab exposes the force simulation: repulsion, edge length, edge stiffness
and centre pull. **Re-solve** reheats it, **Scatter** randomizes positions and starts
over, **Frame all** fits everything on screen. Turning the layout off freezes
positions so you can arrange the graph entirely by hand.

New and imported graphs are solved to convergence before the first frame is drawn, so
you never watch a knot untangle itself or find the camera stranded inside the graph.

## Saving

Documents live in SQLite on the server, along with uploaded images. **Save** updates
the current document, **Save as new** forks it. The *Saved* tab lists everything;
positions are stored, so reopening restores the exact arrangement. `⌘S` saves, `⌘Z` /
`⇧⌘Z` undo and redo. **PNG** downloads the current view, **JSON** downloads the whole
document.

## Layout of the code

```
server/
  index.js        REST API — polycule CRUD, image assets, static client
  db.js           SQLite schema and prepared statements
client/src/
  state/graph.js  graph model, adjacency parsing, serialization
  state/store.js  external store + all document mutations
  three/
    SceneManager.js    scene ownership, reconciliation, picking, dragging
    PolyculeControls.js orbit / pan / fly camera
    NodeView.js         billboarded vertex disc, ring, label
    EdgeView.js         gradient tube between two vertices
    layout.js           3D force-directed simulation
    background.js       solid / starfield / equirect sky
    textures.js         texture cache and canvas label sprites
  components/     React UI panels
```

The store is the source of truth for structure and styling. Live vertex positions are
owned by the scene instead, because the layout moves them every frame; they flow back
into the store on drag-end, on settle, and whenever you save.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/polycules` | List saved documents |
| `GET` | `/api/polycules/:id` | Fetch one |
| `POST` | `/api/polycules` | Create |
| `PUT` | `/api/polycules/:id` | Update |
| `DELETE` | `/api/polycules/:id` | Delete |
| `POST` | `/api/assets` | Upload an image as a base64 data URL |
| `GET` | `/api/assets/:id` | Serve an uploaded image |

Graphs are validated on write: node ids must be unique and every edge must reference
nodes that exist.
