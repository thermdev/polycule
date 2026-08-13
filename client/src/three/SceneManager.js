import * as THREE from 'three';
import { BackgroundManager } from './background.js';
import { EdgeView } from './EdgeView.js';
import { NodeView } from './NodeView.js';
import { PolyculeControls } from './PolyculeControls.js';
import { layoutEnergy, stepLayout } from './layout.js';

const CLICK_SLOP = 4; // px of movement still counted as a click

/**
 * Owns the WebGL scene and reconciles it against the graph document.
 *
 * The store is the source of truth for structure and styling; live vertex
 * positions live here, because the layout moves them every frame and pushing
 * that through React would be pointless churn. Positions flow back to the
 * store on drag-end, on settle, and whenever the document is saved.
 */
export class SceneManager {
  constructor(container, callbacks = {}) {
    this.container = container;
    this.callbacks = callbacks;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 8000);
    this.camera.position.set(0, 12, 52);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    this.controls = new PolyculeControls(this.camera, this.renderer.domElement);
    this.background = new BackgroundManager(this.scene);

    this.nodeGroup = new THREE.Group();
    this.edgeGroup = new THREE.Group();
    this.scene.add(this.edgeGroup, this.nodeGroup);

    /** @type {Map<string, NodeView>} */
    this.nodeViews = new Map();
    /** @type {Map<string, EdgeView>} */
    this.edgeViews = new Map();
    /** @type {Map<string, {position:THREE.Vector3, velocity:THREE.Vector3, force:THREE.Vector3, locked:boolean}>} */
    this.bodies = new Map();

    this.graph = null;
    this.selection = { nodeId: null, edgeId: null };
    this.linkSourceId = null;
    this.alpha = 1;
    this._settledCommitted = false;

    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.hovered = { nodeId: null, edgeId: null };

    this.drag = null;
    this._dragPlane = new THREE.Plane();
    this._dragPoint = new THREE.Vector3();
    this._dragOffset = new THREE.Vector3();

    this._timer = new THREE.Timer();
    // Page Visibility handling keeps a backgrounded tab from returning with a
    // huge delta that would fling the layout apart.
    this._timer.connect(document);
    this._running = true;

    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
    this.renderer.domElement.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(container);
    this._resize();

    this._animate = this._animate.bind(this);
    this.renderer.setAnimationLoop(this._animate);
  }

  /* ---------------------------------------------------------------- *
   * Reconciliation
   * ---------------------------------------------------------------- */

  sync(graph) {
    const firstSync = !this.graph;
    this.graph = graph;

    // Set when a vertex or edge is actually added or removed, so restyling
    // (colours, sliders) never disturbs a settled layout.
    let structureChanged = firstSync;

    // --- vertices ---
    const seenNodes = new Set();
    for (const node of graph.nodes) {
      seenNodes.add(node.id);

      let body = this.bodies.get(node.id);
      if (!body) {
        body = {
          position: new THREE.Vector3(node.x ?? 0, node.y ?? 0, node.z ?? 0),
          velocity: new THREE.Vector3(),
          force: new THREE.Vector3(),
          locked: !!node.pinned,
        };
        this.bodies.set(node.id, body);
        structureChanged = true;
      } else if (this.drag?.nodeId !== node.id) {
        body.locked = !!node.pinned;
      }

      let view = this.nodeViews.get(node.id);
      if (!view) {
        view = new NodeView(node);
        this.nodeViews.set(node.id, view);
        this.nodeGroup.add(view.group);
      } else {
        view.update(node);
      }
      view.setSelected(this.selection.nodeId === node.id);
      view.setLinkSource(this.linkSourceId === node.id);
    }

    for (const [id, view] of this.nodeViews) {
      if (seenNodes.has(id)) continue;
      this.nodeGroup.remove(view.group);
      view.dispose();
      this.nodeViews.delete(id);
      this.bodies.delete(id);
      structureChanged = true;
    }

    // --- edges ---
    const colorOf = new Map(graph.nodes.map((n) => [n.id, n.color]));
    const seenEdges = new Set();
    for (const edge of graph.edges) {
      seenEdges.add(edge.id);
      let view = this.edgeViews.get(edge.id);
      if (!view) {
        view = new EdgeView(edge);
        this.edgeViews.set(edge.id, view);
        this.edgeGroup.add(view.mesh);
        structureChanged = true;
      }
      view.updateStyle(edge, colorOf.get(edge.source), colorOf.get(edge.target));
      view.setSelected(this.selection.edgeId === edge.id);
    }

    for (const [id, view] of this.edgeViews) {
      if (seenEdges.has(id)) continue;
      this.edgeGroup.remove(view.mesh);
      view.dispose();
      this.edgeViews.delete(id);
      structureChanged = true;
    }

    this.background.apply(graph.background);

    if (structureChanged) this.reheat();
  }

  setSelection(selection) {
    this.selection = selection;
    for (const [id, view] of this.nodeViews) view.setSelected(selection.nodeId === id);
    for (const [id, view] of this.edgeViews) view.setSelected(selection.edgeId === id);
  }

  setLinkSource(nodeId) {
    this.linkSourceId = nodeId;
    for (const [id, view] of this.nodeViews) view.setLinkSource(nodeId === id);
  }

  reheat(value = 1) {
    this.alpha = Math.max(this.alpha, value);
    this._settledCommitted = false;
  }

  /* ---------------------------------------------------------------- *
   * Picking
   * ---------------------------------------------------------------- */

  _updatePointerNdc(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  _pick() {
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);

    const nodeHits = this.raycaster.intersectObjects(
      [...this.nodeViews.values()].map((view) => view.disc),
      false
    );
    if (nodeHits.length) return { type: 'node', id: nodeHits[0].object.userData.nodeId };

    const edgeHits = this.raycaster.intersectObjects(
      [...this.edgeViews.values()].map((view) => view.mesh),
      false
    );
    if (edgeHits.length) return { type: 'edge', id: edgeHits[0].object.userData.edgeId };

    return null;
  }

  _handlePointerDown(event) {
    if (event.button !== 0) return; // left button only; controls own the rest
    this._updatePointerNdc(event);
    const hit = this._pick();

    if (hit?.type === 'node') {
      const body = this.bodies.get(hit.id);
      if (!body) return;

      // Drag along the plane facing the camera through the vertex.
      const normal = this.camera.getWorldDirection(new THREE.Vector3());
      this._dragPlane.setFromNormalAndCoplanarPoint(normal, body.position);
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      if (this.raycaster.ray.intersectPlane(this._dragPlane, this._dragPoint)) {
        this._dragOffset.subVectors(body.position, this._dragPoint);
      } else {
        this._dragOffset.set(0, 0, 0);
      }

      this.drag = {
        nodeId: hit.id,
        moved: 0,
        startX: event.clientX,
        startY: event.clientY,
        shiftKey: event.shiftKey,
        wasLocked: body.locked,
      };
      body.locked = true;
      body.velocity.set(0, 0, 0);
      this.renderer.domElement.setPointerCapture?.(event.pointerId);
      this.drag.pointerId = event.pointerId;
      return;
    }

    this.drag = {
      nodeId: null,
      edgeId: hit?.type === 'edge' ? hit.id : null,
      moved: 0,
      startX: event.clientX,
      startY: event.clientY,
      shiftKey: event.shiftKey,
    };
  }

  _handlePointerMove(event) {
    this._updatePointerNdc(event);

    if (this.drag) {
      this.drag.moved = Math.max(
        this.drag.moved,
        Math.hypot(event.clientX - this.drag.startX, event.clientY - this.drag.startY)
      );

      if (this.drag.nodeId) {
        const body = this.bodies.get(this.drag.nodeId);
        if (body) {
          this.raycaster.setFromCamera(this.pointerNdc, this.camera);
          if (this.raycaster.ray.intersectPlane(this._dragPlane, this._dragPoint)) {
            body.position.copy(this._dragPoint).add(this._dragOffset);
            body.velocity.set(0, 0, 0);
            // Keep neighbours reacting while you move someone around.
            this.reheat(0.5);
          }
        }
      }
      return;
    }

    // Hover feedback (skip while the camera is being driven).
    if (this.controls.isDriving) return;
    const hit = this._pick();
    const nodeId = hit?.type === 'node' ? hit.id : null;
    const edgeId = hit?.type === 'edge' ? hit.id : null;

    if (nodeId !== this.hovered.nodeId) {
      if (this.hovered.nodeId) this.nodeViews.get(this.hovered.nodeId)?.setHovered(false);
      if (nodeId) this.nodeViews.get(nodeId)?.setHovered(true);
      this.hovered.nodeId = nodeId;
    }
    if (edgeId !== this.hovered.edgeId) {
      if (this.hovered.edgeId) this.edgeViews.get(this.hovered.edgeId)?.setHovered(false);
      if (edgeId) this.edgeViews.get(edgeId)?.setHovered(true);
      this.hovered.edgeId = edgeId;
    }
    this.renderer.domElement.style.cursor = nodeId ? 'grab' : edgeId ? 'pointer' : 'default';
  }

  _handlePointerUp(event) {
    const drag = this.drag;
    if (!drag) return;
    this.drag = null;

    if (drag.pointerId !== undefined) {
      this.renderer.domElement.releasePointerCapture?.(drag.pointerId);
    }

    if (drag.nodeId) {
      const body = this.bodies.get(drag.nodeId);
      const node = this.graph?.nodes.find((n) => n.id === drag.nodeId);
      if (body) body.locked = !!node?.pinned;

      if (drag.moved > CLICK_SLOP) {
        this.callbacks.onPositionsChanged?.(this.getPositions());
        return;
      }
    }

    if (drag.moved > CLICK_SLOP) return; // camera/box drag, not a click

    if (drag.nodeId) this.callbacks.onNodeClick?.(drag.nodeId, { shiftKey: drag.shiftKey });
    else if (drag.edgeId) this.callbacks.onEdgeClick?.(drag.edgeId);
    else this.callbacks.onEmptyClick?.();
  }

  /* ---------------------------------------------------------------- *
   * Camera helpers
   * ---------------------------------------------------------------- */

  getPositions() {
    const positions = new Map();
    for (const [id, body] of this.bodies) {
      positions.set(id, { x: body.position.x, y: body.position.y, z: body.position.z });
    }
    return positions;
  }

  /**
   * Run the layout to convergence without drawing anything.
   *
   * The animated layout looks good once it has expanded, but framing the
   * camera before that happens puts the camera inside the graph. Solving up
   * front means a new or freshly imported graph is already laid out on the
   * first frame the user sees.
   */
  solve(iterations = 300) {
    if (!this.graph || this.bodies.size === 0) return;

    let alpha = 1;
    for (let i = 0; i < iterations; i += 1) {
      stepLayout(this.bodies, this.graph.edges, this.graph.layout, alpha, 1 / 60);
      alpha *= 0.985;
      if (alpha < 0.02 && layoutEnergy(this.bodies) < 0.001) break;
    }
    // Leave a little heat so the live loop keeps refining, not re-exploding.
    this.alpha = 0.12;
    this._settledCommitted = false;
  }

  /**
   * Bring the graph to a presentable state and frame it.
   * @param options.solve  false for documents that already carry saved positions
   */
  settleAndFrame({ solve = true } = {}) {
    if (solve && this.graph?.layout?.running) this.solve();
    this.frameAll();
    this.callbacks.onPositionsChanged?.(this.getPositions());
  }

  focusNode(nodeId) {
    const body = this.bodies.get(nodeId);
    if (!body) return;
    this.controls.focusOn(body.position, 22);
  }

  frameAll() {
    if (this.bodies.size === 0) {
      this.controls.target.set(0, 0, 0);
      this.camera.position.set(0, 12, 52);
      return;
    }
    const box = new THREE.Box3();
    for (const body of this.bodies.values()) box.expandByPoint(body.position);

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const extent = Math.max(size.x, size.y, size.z, 8);
    const distance = (extent / 2 / Math.tan((this.camera.fov * Math.PI) / 360)) * 1.9;

    this.controls.focusOn(center, Math.max(distance, 18));
  }

  /** Scatter every vertex again and let the layout re-solve from scratch. */
  shuffle() {
    for (const body of this.bodies.values()) {
      if (body.locked) continue;
      body.position.set(
        (Math.random() - 0.5) * 30,
        (Math.random() - 0.5) * 30,
        (Math.random() - 0.5) * 30
      );
      body.velocity.set(0, 0, 0);
    }
    this.reheat();
  }

  screenshot() {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  /* ---------------------------------------------------------------- *
   * Frame loop
   * ---------------------------------------------------------------- */

  _resize() {
    const width = this.container.clientWidth || 1;
    const height = this.container.clientHeight || 1;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  _animate() {
    if (!this._running) return;
    this._timer.update();
    const dt = Math.min(this._timer.getDelta(), 0.1);

    this.controls.update(dt);
    this.background.update(dt);

    if (this.graph) {
      if (this.graph.layout?.running && this.alpha > 0.005) {
        stepLayout(this.bodies, this.graph.edges, this.graph.layout, this.alpha, dt);
        this.alpha *= 0.985;

        if (this.alpha <= 0.05 && layoutEnergy(this.bodies) < 0.001 && !this._settledCommitted) {
          this._settledCommitted = true;
          this.callbacks.onPositionsChanged?.(this.getPositions());
        }
      }

      // Push simulated positions into the visuals.
      for (const [id, view] of this.nodeViews) {
        const body = this.bodies.get(id);
        if (body) view.setPosition(body.position);
        view.faceCamera(this.camera.quaternion);
      }

      for (const edge of this.graph.edges) {
        const view = this.edgeViews.get(edge.id);
        const a = this.bodies.get(edge.source);
        const b = this.bodies.get(edge.target);
        if (!view || !a || !b) continue;
        view.updateGeometry(
          a.position,
          b.position,
          this.nodeViews.get(edge.source)?.radius ?? 1.6,
          this.nodeViews.get(edge.target)?.radius ?? 1.6
        );
      }
    }

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this._running = false;
    this.renderer.setAnimationLoop(null);
    this._timer.disconnect();
    this._resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);

    this.controls.dispose();
    this.background.dispose();
    for (const view of this.nodeViews.values()) view.dispose();
    for (const view of this.edgeViews.values()) view.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
