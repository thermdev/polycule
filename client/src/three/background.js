import * as THREE from 'three';

/** Soft round sprite so stars read as points of light rather than squares. */
function makeStarSprite() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.25)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Owns everything behind the graph. Three modes:
 *
 *   solid    a flat clear colour
 *   stars    a real 3D starfield you can fly through (parallax included)
 *   texture  an equirectangular photo/render mapped onto the sky sphere
 */
export class BackgroundManager {
  constructor(scene) {
    this.scene = scene;
    this.starSprite = makeStarSprite();
    this.stars = null;
    this.starCount = 0;
    this.skyTexture = null;
    this.textureUrl = null;
    this._loadToken = 0;
    this._loader = new THREE.TextureLoader();
    this._config = null;
  }

  apply(config) {
    const previous = this._config;
    this._config = config;

    if (config.mode === 'stars') {
      this.scene.background = new THREE.Color(config.color || '#07070f');
      this._disposeSky();
      if (
        !this.stars ||
        this.starCount !== config.starCount ||
        previous?.starColor !== config.starColor
      ) {
        this._buildStars(config.starCount, config.starColor);
      }
      return;
    }

    this._disposeStars();

    if (config.mode === 'texture' && config.textureUrl) {
      this._loadSky(config.textureUrl);
      return;
    }

    this._disposeSky();
    this.scene.background = new THREE.Color(config.color || '#07070f');
  }

  _buildStars(count = 4000, color = '#ffffff') {
    this._disposeStars();
    const total = Math.max(0, Math.min(40000, Math.floor(count)));
    if (total === 0) return;

    const positions = new Float32Array(total * 3);
    const colors = new Float32Array(total * 3);
    const sizes = new Float32Array(total);
    const base = new THREE.Color(color);
    const tint = new THREE.Color();

    for (let i = 0; i < total; i += 1) {
      // Cube-rejection would clump the corners; sample the shell directly.
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const radius = 220 + Math.pow(Math.random(), 0.5) * 1400;

      positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = radius * Math.cos(phi);
      positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

      // A little hue drift keeps the field from looking printed on.
      tint.copy(base);
      const hsl = { h: 0, s: 0, l: 0 };
      tint.getHSL(hsl);
      tint.setHSL(
        (hsl.h + (Math.random() - 0.5) * 0.12 + 1) % 1,
        Math.min(1, hsl.s + Math.random() * 0.35),
        Math.min(1, hsl.l * (0.55 + Math.random() * 0.65))
      );
      colors[i * 3] = tint.r;
      colors[i * 3 + 1] = tint.g;
      colors[i * 3 + 2] = tint.b;
      sizes[i] = 1.2 + Math.pow(Math.random(), 3) * 6;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.PointsMaterial({
      map: this.starSprite,
      vertexColors: true,
      size: 4,
      sizeAttenuation: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    // Per-star size without a full custom shader.
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aSize;')
        .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
    };

    this.stars = new THREE.Points(geometry, material);
    this.stars.frustumCulled = false;
    this.stars.renderOrder = -1;
    this.scene.add(this.stars);
    this.starCount = total;
  }

  _loadSky(url) {
    if (this.textureUrl === url && this.skyTexture) {
      this.scene.background = this.skyTexture;
      return;
    }
    const token = ++this._loadToken;
    this._loader.load(
      url,
      (texture) => {
        if (token !== this._loadToken) {
          texture.dispose();
          return; // a newer request already won
        }
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.colorSpace = THREE.SRGBColorSpace;
        this._disposeSky();
        this.skyTexture = texture;
        this.textureUrl = url;
        this.scene.background = texture;
      },
      undefined,
      () => {
        if (token !== this._loadToken) return;
        this.scene.background = new THREE.Color(this._config?.color || '#07070f');
      }
    );
  }

  /** Slow drift so the starfield feels alive when the camera is still. */
  update(dt) {
    if (this.stars) this.stars.rotation.y += dt * 0.004;
  }

  _disposeStars() {
    if (!this.stars) return;
    this.scene.remove(this.stars);
    this.stars.geometry.dispose();
    this.stars.material.dispose();
    this.stars = null;
    this.starCount = 0;
  }

  _disposeSky() {
    if (!this.skyTexture) return;
    if (this.scene.background === this.skyTexture) this.scene.background = null;
    this.skyTexture.dispose();
    this.skyTexture = null;
    this.textureUrl = null;
  }

  dispose() {
    this._disposeStars();
    this._disposeSky();
    this.starSprite.dispose();
  }
}
