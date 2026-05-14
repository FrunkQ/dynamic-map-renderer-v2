/**
 * Per-kind shader registry (v2.12). Each `OverlayKindEntry.shader` that's
 * set must have a matching entry here with the GLSL source + optional
 * texture assets. Auto-discovers via import.meta.glob just like the
 * filter system.
 *
 * Shape: src/mapfx/shaders/<id>/vertex.glsl, fragment.glsl, plus any
 * texture assets (noise.png, etc.) referenced by the shader.
 */

import * as THREE from 'three';

const vertexGlobs   = import.meta.glob<string>('./*/vertex.glsl',   { eager: true, query: '?raw', import: 'default' });
const fragmentGlobs = import.meta.glob<string>('./*/fragment.glsl', { eager: true, query: '?raw', import: 'default' });
const textureGlobs  = import.meta.glob<string>('./*/*.{png,webp,jpg,jpeg}', { eager: true, query: '?url', import: 'default' });

export interface KindShader {
  vertex:   string;
  fragment: string;
  /** Pre-resolved textures keyed by uniform name. Hardcoded to one
   *  texture per kind for now (`uNoise`) — generalises easily later. */
  textures: Record<string, THREE.Texture>;
}

/** Lazy texture cache so each shader's noise / etc. loads once. */
const textureCache = new Map<string, THREE.Texture>();

function _loadTexture(url: string): THREE.Texture {
  const cached = textureCache.get(url);
  if (cached) return cached;
  const tex = new THREE.TextureLoader().load(url);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  textureCache.set(url, tex);
  return tex;
}

export function loadKindShader(shaderId: string): KindShader | null {
  const vKey = `./${shaderId}/vertex.glsl`;
  const fKey = `./${shaderId}/fragment.glsl`;
  const vertex   = vertexGlobs[vKey];
  const fragment = fragmentGlobs[fKey];
  if (!vertex || !fragment) return null;

  // Find any image assets in the same folder and bind them by uniform
  // name. For now we map a `noise.*` file to `uNoise`.
  const textures: Record<string, THREE.Texture> = {};
  for (const [key, url] of Object.entries(textureGlobs)) {
    if (!key.startsWith(`./${shaderId}/`)) continue;
    const file = key.slice(`./${shaderId}/`.length).toLowerCase();
    if (file.startsWith('noise')) textures['uNoise'] = _loadTexture(url);
  }
  return { vertex, fragment, textures };
}
