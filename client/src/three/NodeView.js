import * as THREE from 'three';
import { drawLabel, loadNodeTexture, makeLabelSprite } from './textures.js';

// Shared across every vertex — one allocation, many nodes.
const DISC_GEOMETRY = new THREE.CircleGeometry(1, 64);
const BORDER_GEOMETRY = new THREE.RingGeometry(1, 1.09, 64);
const HALO_GEOMETRY = new THREE.RingGeometry(1.16, 1.3, 64);

export const BASE_RADIUS = 1.6;

/**
 * One person in the polycule: a flat disc that always faces the camera,
 * showing either a solid colour or their picture, ringed in their colour,
 * with their name floating underneath.
 */
export class NodeView {
  constructor(node) {
    this.id = node.id;
    this.radius = BASE_RADIUS;

    this.group = new THREE.Group();
    this.group.userData.nodeId = node.id;

    this.discMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(node.color),
      side: THREE.DoubleSide,
      transparent: true,
    });
    this.disc = new THREE.Mesh(DISC_GEOMETRY, this.discMaterial);
    this.disc.userData.nodeId = node.id;
    this.disc.userData.pickable = 'node';

    this.borderMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(node.color),
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
    });
    this.border = new THREE.Mesh(BORDER_GEOMETRY, this.borderMaterial);
    this.border.position.z = 0.01;

    this.haloMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color('#ffffff'),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      depthTest: false,
    });
    this.halo = new THREE.Mesh(HALO_GEOMETRY, this.haloMaterial);
    this.halo.position.z = 0.02;
    this.halo.renderOrder = 5;
    this.halo.visible = false;

    this.label = makeLabelSprite();

    this.group.add(this.disc, this.border, this.halo, this.label);

    this._imageUrl = undefined;
    this._selected = false;
    this._hovered = false;
    this._linkSource = false;
    this.update(node);
  }

  update(node) {
    this.radius = BASE_RADIUS * (node.size ?? 1);

    this.disc.scale.setScalar(this.radius);
    this.border.scale.setScalar(this.radius);
    this.halo.scale.setScalar(this.radius);
    this.label.position.set(0, -(this.radius + 0.85), 0.02);

    const color = new THREE.Color(node.color);
    this.borderMaterial.color.copy(color);

    if (node.imageUrl !== this._imageUrl) {
      this._imageUrl = node.imageUrl;
      if (node.imageUrl) {
        this.discMaterial.map = loadNodeTexture(node.imageUrl);
        // White base so the photo keeps its own colours.
        this.discMaterial.color.set('#ffffff');
      } else {
        this.discMaterial.map = null;
        this.discMaterial.color.copy(color);
      }
      this.discMaterial.needsUpdate = true;
    } else if (!node.imageUrl) {
      this.discMaterial.color.copy(color);
    }

    drawLabel(this.label, node.label, '#f4f4ff');
    this._refreshHighlight();
  }

  setPosition(vector) {
    this.group.position.copy(vector);
  }

  setSelected(value) {
    if (this._selected === value) return;
    this._selected = value;
    this._refreshHighlight();
  }

  setHovered(value) {
    if (this._hovered === value) return;
    this._hovered = value;
    this._refreshHighlight();
  }

  /** Marks the vertex you are currently drawing a connection from. */
  setLinkSource(value) {
    if (this._linkSource === value) return;
    this._linkSource = value;
    this._refreshHighlight();
  }

  _refreshHighlight() {
    const active = this._selected || this._hovered || this._linkSource;
    this.halo.visible = active;
    if (this._linkSource) this.haloMaterial.color.set('#7ce38b');
    else if (this._selected) this.haloMaterial.color.set('#ffffff');
    else this.haloMaterial.color.set('#9ba7ff');
    this.haloMaterial.opacity = this._selected || this._linkSource ? 0.95 : 0.5;
  }

  /** Face the camera — this is what keeps images reading as flat. */
  faceCamera(cameraQuaternion) {
    this.group.quaternion.copy(cameraQuaternion);
  }

  dispose() {
    this.discMaterial.dispose();
    this.borderMaterial.dispose();
    this.haloMaterial.dispose();
    this.label.material.map?.dispose();
    this.label.material.dispose();
  }
}
