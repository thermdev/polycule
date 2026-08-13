import * as THREE from 'three';

const loader = new THREE.TextureLoader();
const cache = new Map();

/**
 * Load (and cache) an image texture, centre-cropped to a square so it fills
 * the circular vertex face without stretching.
 */
export function loadNodeTexture(url) {
  const cached = cache.get(url);
  if (cached) return cached;

  const texture = loader.load(url, (loaded) => {
    const image = loaded.image;
    if (!image?.width || !image?.height) return;

    const aspect = image.width / image.height;
    if (aspect > 1) {
      loaded.repeat.set(1 / aspect, 1);
      loaded.offset.set((1 - 1 / aspect) / 2, 0);
    } else {
      loaded.repeat.set(1, aspect);
      loaded.offset.set(0, (1 - aspect) / 2);
    }
    loaded.needsUpdate = true;
  });

  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  cache.set(url, texture);
  return texture;
}

export function disposeTextureCache() {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
}

/* ------------------------------------------------------------------ *
 * Name labels
 * ------------------------------------------------------------------ */

const FONT_STACK = '600 64px "Inter", "Segoe UI", system-ui, sans-serif';

/** A canvas-backed sprite so names stay readable at any angle. */
export function makeLabelSprite() {
  const canvas = document.createElement('canvas');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.renderOrder = 10;
  sprite.userData.canvas = canvas;
  sprite.userData.text = null;
  return sprite;
}

export function drawLabel(sprite, text, color = '#ffffff') {
  const key = `${text}|${color}`;
  if (sprite.userData.text === key) return;
  sprite.userData.text = key;

  const canvas = sprite.userData.canvas;
  const ctx = canvas.getContext('2d');
  ctx.font = FONT_STACK;

  const padding = 28;
  const metrics = ctx.measureText(text);
  const width = Math.max(64, Math.ceil(metrics.width + padding * 2));
  const height = 128;

  canvas.width = width;
  canvas.height = height;

  // Resizing the canvas resets its state, so restyle after.
  ctx.font = FONT_STACK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = 'rgba(8, 8, 16, 0.55)';
  roundRect(ctx, 2, 26, width - 4, 76, 22);
  ctx.fill();

  ctx.shadowColor = 'rgba(0,0,0,0.9)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = color;
  ctx.fillText(text, width / 2, height / 2);

  sprite.material.map.dispose();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  sprite.material.map = texture;
  sprite.material.needsUpdate = true;

  // Keep world height fixed; width follows the text.
  const scale = 1.6;
  sprite.scale.set((width / height) * scale, scale, 1);
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}
