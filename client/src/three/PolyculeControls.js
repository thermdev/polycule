import * as THREE from 'three';

const EPS = 0.000001;

/**
 * Camera controls tuned for graph inspection:
 *
 *   right drag    orbit around the focus point
 *   middle drag   pan the focus point
 *   wheel         dolly in / out
 *   W A S D       fly relative to where you are looking
 *   Q / E         fly down / up   (also Space / Ctrl)
 *   Shift         3x boost
 *
 * The left mouse button is deliberately untouched — the scene uses it to
 * pick and drag vertices.
 */
export class PolyculeControls {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;
    this.enabled = true;

    this.target = new THREE.Vector3(0, 0, 0);

    this.rotateSpeed = 0.9;
    this.panSpeed = 1;
    this.zoomSpeed = 1;
    this.moveSpeed = 26; // world units / second
    this.minDistance = 1.5;
    this.maxDistance = 4000;
    this.damping = 0.16;

    this._spherical = new THREE.Spherical();
    this._sphericalDelta = new THREE.Spherical(0, 0, 0);
    this._panOffset = new THREE.Vector3();
    this._scale = 1;

    this._pointer = new THREE.Vector2();
    this._pointerLast = new THREE.Vector2();
    this._activeButton = null;
    this._activePointerId = null;

    this._keys = new Set();
    this._vec = new THREE.Vector3();
    this._quat = new THREE.Quaternion();

    this._onContextMenu = (event) => event.preventDefault();
    this._onPointerDown = this._handlePointerDown.bind(this);
    this._onPointerMove = this._handlePointerMove.bind(this);
    this._onPointerUp = this._handlePointerUp.bind(this);
    this._onWheel = this._handleWheel.bind(this);
    this._onKeyDown = this._handleKeyDown.bind(this);
    this._onKeyUp = this._handleKeyUp.bind(this);
    this._onBlur = () => this._keys.clear();

    domElement.addEventListener('contextmenu', this._onContextMenu);
    domElement.addEventListener('pointerdown', this._onPointerDown);
    domElement.addEventListener('wheel', this._onWheel, { passive: false });
    window.addEventListener('pointermove', this._onPointerMove);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
  }

  /** True while the camera is being orbited or panned. */
  get isDriving() {
    return this._activeButton !== null;
  }

  dispose() {
    this.domElement.removeEventListener('contextmenu', this._onContextMenu);
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    this.domElement.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('pointermove', this._onPointerMove);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
  }

  /* ---------------------------------------------------------------- */

  _handlePointerDown(event) {
    if (!this.enabled) return;
    // 2 = right (orbit), 1 = middle (pan). Left belongs to the scene.
    if (event.button !== 1 && event.button !== 2) return;
    event.preventDefault();

    this._activeButton = event.button;
    this._activePointerId = event.pointerId;
    this._pointerLast.set(event.clientX, event.clientY);
    this.domElement.setPointerCapture?.(event.pointerId);
  }

  _handlePointerMove(event) {
    if (!this.enabled || this._activeButton === null) return;
    if (this._activePointerId !== null && event.pointerId !== this._activePointerId) return;

    this._pointer.set(event.clientX, event.clientY);
    const dx = this._pointer.x - this._pointerLast.x;
    const dy = this._pointer.y - this._pointerLast.y;
    this._pointerLast.copy(this._pointer);

    const height = this.domElement.clientHeight || 1;

    if (this._activeButton === 2) {
      this._sphericalDelta.theta -= (2 * Math.PI * dx * this.rotateSpeed) / height;
      this._sphericalDelta.phi -= (2 * Math.PI * dy * this.rotateSpeed) / height;
    } else if (this._activeButton === 1) {
      this._pan(dx, dy);
    }
  }

  _handlePointerUp(event) {
    if (this._activePointerId !== null && event.pointerId !== this._activePointerId) return;
    if (this._activePointerId !== null) {
      this.domElement.releasePointerCapture?.(this._activePointerId);
    }
    this._activeButton = null;
    this._activePointerId = null;
  }

  _handleWheel(event) {
    if (!this.enabled) return;
    event.preventDefault();
    const factor = Math.pow(0.95, this.zoomSpeed);
    if (event.deltaY < 0) this._scale /= factor;
    else if (event.deltaY > 0) this._scale *= factor;
  }

  _handleKeyDown(event) {
    if (!this.enabled) return;
    if (isTypingTarget(event.target)) return;
    const code = event.code;
    if (MOVEMENT_KEYS.has(code)) {
      this._keys.add(code);
      // Space would otherwise scroll the page behind the canvas.
      if (code === 'Space') event.preventDefault();
    }
  }

  _handleKeyUp(event) {
    this._keys.delete(event.code);
  }

  /** Pan in screen space, scaled so a drag tracks the cursor at focus depth. */
  _pan(deltaX, deltaY) {
    const element = this.domElement;
    const offset = this._vec.copy(this.camera.position).sub(this.target);
    let targetDistance = offset.length();
    targetDistance *= Math.tan(((this.camera.fov / 2) * Math.PI) / 180);

    const panLeft = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    panLeft.multiplyScalar((-2 * deltaX * targetDistance) / (element.clientHeight || 1) * this.panSpeed);

    const panUp = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    panUp.multiplyScalar((2 * deltaY * targetDistance) / (element.clientHeight || 1) * this.panSpeed);

    this._panOffset.add(panLeft).add(panUp);
  }

  /** Fly the camera and its focus point together, WASD-style. */
  _applyKeyboard(dt) {
    if (this._keys.size === 0) return;

    const forward = this._vec.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0);

    const move = new THREE.Vector3();
    if (this._keys.has('KeyW')) move.add(forward);
    if (this._keys.has('KeyS')) move.sub(forward);
    if (this._keys.has('KeyD')) move.add(right);
    if (this._keys.has('KeyA')) move.sub(right);
    if (this._keys.has('KeyE') || this._keys.has('Space')) move.add(up);
    if (this._keys.has('KeyQ') || this._keys.has('ControlLeft')) move.sub(up);

    if (move.lengthSq() === 0) return;

    const boost = this._keys.has('ShiftLeft') || this._keys.has('ShiftRight') ? 3 : 1;
    move.normalize().multiplyScalar(this.moveSpeed * boost * dt);

    this.camera.position.add(move);
    this.target.add(move);
  }

  /** Recentre on a point without changing viewing angle or distance. */
  focusOn(point, distance) {
    const offset = new THREE.Vector3().copy(this.camera.position).sub(this.target);
    if (distance) offset.setLength(distance);
    this.target.copy(point);
    this.camera.position.copy(point).add(offset);
  }

  update(dt) {
    this._applyKeyboard(dt);

    const offset = this._vec.copy(this.camera.position).sub(this.target);

    // Work in a frame where the camera's up axis is +Y.
    this._quat.setFromUnitVectors(this.camera.up, new THREE.Vector3(0, 1, 0));
    offset.applyQuaternion(this._quat);
    this._spherical.setFromVector3(offset);

    const ease = this.damping;
    this._spherical.theta += this._sphericalDelta.theta * ease;
    this._spherical.phi += this._sphericalDelta.phi * ease;
    this._sphericalDelta.theta *= 1 - ease;
    this._sphericalDelta.phi *= 1 - ease;

    this._spherical.phi = Math.max(EPS, Math.min(Math.PI - EPS, this._spherical.phi));
    this._spherical.radius = Math.max(
      this.minDistance,
      Math.min(this.maxDistance, this._spherical.radius * (1 + (this._scale - 1) * ease))
    );
    this._scale = 1 + (this._scale - 1) * (1 - ease);
    this._spherical.makeSafe();

    this.target.addScaledVector(this._panOffset, ease);
    this._panOffset.multiplyScalar(1 - ease);

    offset.setFromSpherical(this._spherical);
    offset.applyQuaternion(this._quat.clone().invert());

    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
  }
}

const MOVEMENT_KEYS = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE',
  'Space', 'ShiftLeft', 'ShiftRight', 'ControlLeft',
]);

function isTypingTarget(element) {
  if (!element) return false;
  const tag = element.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    element.isContentEditable === true
  );
}
