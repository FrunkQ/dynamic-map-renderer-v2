import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SessionState, StoredMap, StoredSession, AudioAsset } from '../types.ts';

export type StoredAsset = { id: string; name: string; type: string; blob: Blob; addedAt: number };

interface DMRSchema extends DBSchema {
  maps: {
    key: string; // StoredMap.id
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
}

const DB_NAME = 'dynamic-map-renderer';
const DB_VERSION = 2;

let _db: IDBPDatabase<DMRSchema> | null = null;

async function getDB(): Promise<IDBPDatabase<DMRSchema>> {
  if (_db) return _db;
  _db = await openDB<DMRSchema>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const mapStore = db.createObjectStore('maps', { keyPath: 'id' });
        mapStore.createIndex('by_name', 'name', { unique: false });
        db.createObjectStore('configs', { keyPath: 'mapId' });
        db.createObjectStore('session', { keyPath: 'key' });
        db.createObjectStore('assets', { keyPath: 'id' });
      }
      if (oldVersion < 2) {
        db.createObjectStore('audioAssets', { keyPath: 'id' });
      }
    },
  });
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

/** Wipe every asset-library store. Used by bundle import to replace the workspace. */
export async function clearAssetLibraries(): Promise<void> {
  const db = await getDB();
  await Promise.all([
    db.clear('audioAssets'),
    db.clear('assets'),
  ]);
}
