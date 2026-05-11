import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SessionState, StoredMap, StoredSession, AudioAsset, MapAsset, ImageAsset, ImageCategory } from '../types.ts';

export type StoredAsset = { id: string; name: string; type: string; blob: Blob; addedAt: number };

interface DMRSchema extends DBSchema {
  maps: {
    key: string; // StoredMap.id (post-v3 schema points at mapAssetId; pre-v3 had blob inline)
    value: StoredMap;
    indexes: { by_name: string };
  };
  configs: {
    key: string; // mapId
    value: { mapId: string; state: SessionState };
  };
  session: {
    key: 'current';
    value: StoredSession;
  };
  assets: {
    // Binary blobs: icons (type='icon') and audio (type='audio')
    key: string;
    value: { id: string; name: string; type: string; blob: Blob; addedAt: number };
  };
  audioAssets: {
    // Metadata for audio library — blobs live in 'assets' store under the same id
    key: string; // AudioAsset.id
    value: AudioAsset;
  };
  mapAssets: {
    // Map asset library — blob lives inline on the record when locallyStored=true.
    key: string; // MapAsset.id
    value: MapAsset;
  };
  imageAssets: {
    // Image asset library — Unicode glyphs (no blob), SVG markup, and raster
    // PNG/SVG blobs all in one store. Each row references a category id.
    key: string; // ImageAsset.id
    value: ImageAsset;
  };
  imageCategories: {
    // Categories shown in the library sidebar. System rows are seeded on
    // first run; user-defined rows are added at runtime.
    key: string; // ImageCategory.id
    value: ImageCategory;
  };
}

const DB_NAME = 'dynamic-map-renderer';
const DB_VERSION = 5;

let _db: IDBPDatabase<DMRSchema> | null = null;

async function getDB(): Promise<IDBPDatabase<DMRSchema>> {
  if (_db) return _db;
  _db = await openDB<DMRSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // Idempotent: each store is created only if it doesn't already exist on
      // the connection. This protects against stuck-version states where the
      // DB version was bumped but a store somehow never got created (e.g. an
      // interrupted prior upgrade). On a clean install all branches fire; on
      // an existing install only the missing stores are created.
      if (!db.objectStoreNames.contains('maps')) {
        const mapStore = db.createObjectStore('maps', { keyPath: 'id' });
        mapStore.createIndex('by_name', 'name', { unique: false });
      }
      if (!db.objectStoreNames.contains('configs')) {
        db.createObjectStore('configs', { keyPath: 'mapId' });
      }
      if (!db.objectStoreNames.contains('session')) {
        db.createObjectStore('session', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('assets')) {
        db.createObjectStore('assets', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('audioAssets')) {
        db.createObjectStore('audioAssets', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('mapAssets')) {
        db.createObjectStore('mapAssets', { keyPath: 'id' });
        // Legacy 'maps' rows still carry their blob inline; src/storage/seedMapAssets
        // splits them out of the maps store into mapAssets the next time the app loads.
      }
      if (!db.objectStoreNames.contains('imageAssets')) {
        db.createObjectStore('imageAssets', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('imageCategories')) {
        db.createObjectStore('imageCategories', { keyPath: 'id' });
      }
    },
    blocked() {
      console.warn(
        '[DB] upgrade is blocked by another open tab — close any other Dynamic Map Renderer windows ' +
        '(e.g. the player view) and reload to apply the schema upgrade.'
      );
    },
  });

  if (!_db.objectStoreNames.contains('mapAssets')) {
    console.warn(
      '[DB] mapAssets store missing — schema upgrade may have been blocked by another open tab. ' +
      'Close any other Dynamic Map Renderer windows and reload to apply the upgrade. ' +
      'In the meantime, map asset operations will be no-ops.'
    );
  }
  return _db;
}

// ─── Maps ─────────────────────────────────────────────────────────────────────

export async function saveMap(map: StoredMap): Promise<void> {
  const db = await getDB();
  await db.put('maps', map);
}

export async function getMap(id: string): Promise<StoredMap | undefined> {
  const db = await getDB();
  return db.get('maps', id);
}

export async function getAllMaps(): Promise<StoredMap[]> {
  const db = await getDB();
  return db.getAllFromIndex('maps', 'by_name');
}

export async function deleteMap(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('maps', id);
  // Also remove its saved config
  await db.delete('configs', id);
}

// ─── Configs (per-map session state) ─────────────────────────────────────────

export async function saveConfig(mapId: string, state: SessionState): Promise<void> {
  const db = await getDB();
  await db.put('configs', { mapId, state });
}

export async function loadConfig(mapId: string): Promise<SessionState | undefined> {
  const db = await getDB();
  const record = await db.get('configs', mapId);
  return record?.state;
}

/** All saved per-map configs across the library — used by trash-tracking helpers. */
export async function getAllConfigs(): Promise<SessionState[]> {
  const db = await getDB();
  const records = await db.getAll('configs');
  return records.map((r) => r.state);
}

// ─── Session (peer ID persistence for resumption) ────────────────────────────

export async function saveSession(session: StoredSession): Promise<void> {
  const db = await getDB();
  await db.put('session', session);
}

export async function loadSession(): Promise<StoredSession | undefined> {
  const db = await getDB();
  return db.get('session', 'current');
}

// ─── Assets (icons and future binary assets) ──────────────────────────────────

export async function saveAsset(asset: StoredAsset): Promise<void> {
  const db = await getDB();
  await db.put('assets', asset);
}

export async function getAsset(id: string): Promise<StoredAsset | undefined> {
  const db = await getDB();
  return db.get('assets', id);
}

export async function getAllAssets(type?: string): Promise<StoredAsset[]> {
  const db = await getDB();
  const all = await db.getAll('assets');
  if (type === undefined) return all;
  return all.filter((a) => a.type === type);
}

export async function deleteAsset(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('assets', id);
}

// ─── Audio asset metadata ─────────────────────────────────────────────────────

export async function saveAudioAsset(asset: AudioAsset): Promise<void> {
  const db = await getDB();
  await db.put('audioAssets', asset);
}

export async function getAudioAsset(id: string): Promise<AudioAsset | undefined> {
  const db = await getDB();
  return db.get('audioAssets', id);
}

export async function getAllAudioAssets(): Promise<AudioAsset[]> {
  const db = await getDB();
  return db.getAll('audioAssets');
}

export async function deleteAudioAsset(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('audioAssets', id);
  await db.delete('assets', id); // also remove the blob
}

/** True when the v3 mapAssets store is available on the open connection. */
export async function hasMapAssetsStore(): Promise<boolean> {
  const db = await getDB();
  return db.objectStoreNames.contains('mapAssets');
}

// ─── Map asset library ──────────────────────────────────────────────────────
// Each helper guards against the store being absent: when a schema upgrade was
// blocked by another tab, the connection has the older shape. Operations turn
// into no-ops / empty results so the rest of the app keeps running and the
// user sees the warning printed in getDB above.

export async function saveMapAsset(asset: MapAsset): Promise<void> {
  const db = await getDB();
  if (!db.objectStoreNames.contains('mapAssets')) return;
  await db.put('mapAssets', asset);
}

export async function getMapAsset(id: string): Promise<MapAsset | undefined> {
  const db = await getDB();
  if (!db.objectStoreNames.contains('mapAssets')) return undefined;
  return db.get('mapAssets', id);
}

export async function getAllMapAssets(): Promise<MapAsset[]> {
  const db = await getDB();
  if (!db.objectStoreNames.contains('mapAssets')) return [];
  return db.getAll('mapAssets');
}

export async function deleteMapAsset(id: string): Promise<void> {
  const db = await getDB();
  if (!db.objectStoreNames.contains('mapAssets')) return;
  await db.delete('mapAssets', id);
}

// ─── Image Assets ─────────────────────────────────────────────────────────────

export async function saveImageAsset(asset: ImageAsset): Promise<void> {
  const db = await getDB();
  if (!db.objectStoreNames.contains('imageAssets')) return;
  await db.put('imageAssets', asset);
}

export async function getImageAsset(id: string): Promise<ImageAsset | undefined> {
  const db = await getDB();
  if (!db.objectStoreNames.contains('imageAssets')) return undefined;
  return db.get('imageAssets', id);
}

export async function getAllImageAssets(): Promise<ImageAsset[]> {
  const db = await getDB();
  if (!db.objectStoreNames.contains('imageAssets')) return [];
  return db.getAll('imageAssets');
}

export async function deleteImageAsset(id: string): Promise<void> {
  const db = await getDB();
  if (!db.objectStoreNames.contains('imageAssets')) return;
  await db.delete('imageAssets', id);
}

// ─── Image Categories ─────────────────────────────────────────────────────────

export async function saveImageCategory(cat: ImageCategory): Promise<void> {
  const db = await getDB();
  if (!db.objectStoreNames.contains('imageCategories')) return;
  await db.put('imageCategories', cat);
}

export async function getAllImageCategories(): Promise<ImageCategory[]> {
  const db = await getDB();
  if (!db.objectStoreNames.contains('imageCategories')) return [];
  return db.getAll('imageCategories');
}

export async function deleteImageCategory(id: string): Promise<void> {
  const db = await getDB();
  if (!db.objectStoreNames.contains('imageCategories')) return;
  await db.delete('imageCategories', id);
}

/** Wipe every asset-library store. Used by bundle import to replace the workspace. */
export async function clearAssetLibraries(): Promise<void> {
  const db = await getDB();
  await Promise.all([
    db.clear('audioAssets'),
    db.clear('assets'),
    db.clear('mapAssets'),
    db.clear('imageAssets'),
    db.clear('imageCategories'),
  ]);
}

/** Wipe every single store — maps, configs, assets, audio metadata, map
 *  assets, image assets, session record. Used by Settings → Delete DB and
 *  the New Map Pack flow. Returns once all stores are empty. */
export async function clearEverything(): Promise<void> {
  const db = await getDB();
  await Promise.all([
    db.clear('audioAssets'),
    db.clear('assets'),
    db.clear('mapAssets'),
    db.clear('imageAssets'),
    db.clear('imageCategories'),
    db.clear('maps'),
    db.clear('configs'),
    db.clear('session'),
  ]);
}
