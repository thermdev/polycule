const BASE = '/api';

async function request(path, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json();
      if (body?.error) message = body.error;
    } catch {
      /* response had no JSON body */
    }
    throw new Error(message);
  }
  if (response.status === 204) return null;
  return response.json();
}

export const api = {
  listPolycules: () => request('/polycules'),
  getPolycule: (id) => request(`/polycules/${id}`),
  createPolycule: (name, data) =>
    request('/polycules', { method: 'POST', body: JSON.stringify({ name, data }) }),
  updatePolycule: (id, name, data) =>
    request(`/polycules/${id}`, { method: 'PUT', body: JSON.stringify({ name, data }) }),
  deletePolycule: (id) => request(`/polycules/${id}`, { method: 'DELETE' }),
  uploadAsset: (dataUrl) =>
    request('/assets', { method: 'POST', body: JSON.stringify({ dataUrl }) }),
};

/* ------------------------------------------------------------------ *
 * Image helpers
 * ------------------------------------------------------------------ */

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('could not read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Shrink oversized images before upload. Vertex faces are small on screen, so
 * a 512px square is plenty and keeps saved documents light.
 */
export async function downscaleImage(dataUrl, maxSize) {
  const image = await loadImage(dataUrl);
  if (image.width <= maxSize && image.height <= maxSize) return dataUrl;

  const scale = maxSize / Math.max(image.width, image.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/webp', 0.92);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('could not decode image'));
    image.src = src;
  });
}

/** Read a file, shrink it, upload it, and hand back a servable URL. */
export async function uploadImageFile(file, { maxSize = 512 } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('that file is not an image');
  const dataUrl = await fileToDataUrl(file);
  const prepared = await downscaleImage(dataUrl, maxSize);
  const asset = await api.uploadAsset(prepared);
  return asset.url;
}
