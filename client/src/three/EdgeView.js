import * as THREE from 'three';

// Unit cylinder along +Y spanning y ∈ [0, 1], so scaling y gives the length.
const EDGE_GEOMETRY = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
EDGE_GEOMETRY.translate(0, 0.5, 0);

const UP = new THREE.Vector3(0, 1, 0);

const VERTEX_SHADER = /* glsl */ `
  varying float vT;
  void main() {
    vT = position.y;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// The gradient runs along the tube, so an edge can fade from one person's
// colour into the other's.
const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uOpacity;
  uniform float uHighlight;
  varying float vT;

  void main() {
    vec3 color = mix(uColorA, uColorB, clamp(vT, 0.0, 1.0));
    color = mix(color, vec3(1.0), uHighlight * 0.5);
    gl_FragColor = vec4(color, uOpacity);
    #include <colorspace_fragment>
  }
`;

const _dir = new THREE.Vector3();
const _start = new THREE.Vector3();
const _quat = new THREE.Quaternion();

/** A relationship, drawn as a tube through 3D space between two vertices. */
export class EdgeView {
  constructor(edge) {
    this.id = edge.id;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColorA: { value: new THREE.Color('#ffffff') },
        uColorB: { value: new THREE.Color('#ffffff') },
        uOpacity: { value: 0.92 },
        uHighlight: { value: 0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      transparent: true,
    });

    this.mesh = new THREE.Mesh(EDGE_GEOMETRY, this.material);
    this.mesh.userData.edgeId = edge.id;
    this.mesh.userData.pickable = 'edge';
    this.mesh.frustumCulled = false;

    this.width = 1;
    this._selected = false;
  }

  /**
   * @param edge        the edge document
   * @param sourceColor colour of the source vertex (for gradient mode)
   * @param targetColor colour of the target vertex
   */
  updateStyle(edge, sourceColor, targetColor) {
    this.width = edge.width ?? 1;
    if (edge.colorMode === 'solid') {
      this.material.uniforms.uColorA.value.set(edge.color || '#ffffff');
      this.material.uniforms.uColorB.value.set(edge.color || '#ffffff');
    } else {
      this.material.uniforms.uColorA.value.set(sourceColor || '#ffffff');
      this.material.uniforms.uColorB.value.set(targetColor || '#ffffff');
    }
    this.material.uniforms.uOpacity.value = edge.opacity ?? 0.92;
  }

  /** Place the tube between two vertex centres, stopping at their rims. */
  updateGeometry(sourcePos, targetPos, sourceRadius, targetRadius) {
    _dir.subVectors(targetPos, sourcePos);
    const distance = _dir.length();

    const span = distance - sourceRadius - targetRadius;
    if (distance < 0.0001 || span <= 0.01) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;

    _dir.divideScalar(distance);
    _start.copy(sourcePos).addScaledVector(_dir, sourceRadius);

    _quat.setFromUnitVectors(UP, _dir);
    this.mesh.position.copy(_start);
    this.mesh.quaternion.copy(_quat);

    const thickness = 0.075 * this.width * (this._selected ? 1.7 : 1);
    this.mesh.scale.set(thickness, span, thickness);
  }

  setSelected(value) {
    if (this._selected === value) return;
    this._selected = value;
    this.material.uniforms.uHighlight.value = value ? 1 : 0;
  }

  setHovered(value) {
    if (this._selected) return;
    this.material.uniforms.uHighlight.value = value ? 0.45 : 0;
  }

  dispose() {
    this.material.dispose();
  }
}
