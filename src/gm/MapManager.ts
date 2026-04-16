import type { StoredMap } from '../types.ts';
import { saveMap, getAllMaps, deleteMap, getMap } from '../storage/db.ts';

function generateId(): string {
  return crypto.randomUUID();
}

const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_BYTES = 50 * 1024 * 1024; // 50 MB

export class MapManager {
  /**
   * Import a File object from a file input or drag-and-drop.
   * Validates type and size, stores in IndexedDB, returns the StoredMap.
   */
  async importFile(file: File): Promise<StoredMap> {
    if (!ALLOWED_TYPES.has(file.type)) {
      throw new Error(`Unsupported file type: ${file.type}. Use PNG, JPG, or WebP.`);
    }
    if (file.size > MAX_BYTES) {
      throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 50 MB.`);
    }

    const blob = new Blob([await file.arrayBuffer()], { type: file.type });
    const map: StoredMap = {
      id:      generateId(),
      name:    file.name,
      blob,
      addedAt: Date.now(),
    };

    await saveMap(map);
    return map;
  }

  async getAll(): Promise<StoredMap[]> {
    return getAllMaps();
  }

  async getBlob(id: string): Promise<ArrayBuffer | null> {
    const map = await getMap(id);
    if (!map) return null;
    return map.blob.arrayBuffer();
  }

  async delete(id: string): Promise<void> {
    await deleteMap(id);
  }
}
