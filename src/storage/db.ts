import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { SessionState, StoredMap, StoredSession } from '../types.ts';

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
    // Reserved for audio files and other future binary assets
    key: string;
    value: { id: string; name: string; type: string; blob: Blob; addedAt: number };
  };
}

const DB_NAME = 'dynamic-map-renderer';
const DB_VERSION = 1;

let _db: IDBPDatabase<DMRSchema> | null = null;

async function getDB(): Promise<IDBPDatabase<DMRSchema>> {
  if (_db) return _db;
  _db = await openDB<DMRSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const mapStore = db.createObjectStore('maps', { keyPath: 'id' });
      mapStore.createIndex('by_name', 'name', { unique: false });

      db.createObjectStore('configs', { keyPath: 'mapId' });
      db.createObjectStore('session', { keyPath: 'key' });
      db.createObjectStore('assets', { keyPath: 'id' });
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

// ─── Session (peer ID persistence for resumption) ────────────────────────────

export async function saveSession(session: StoredSession): Promise<void> {
  const db = await getDB();
  await db.put('session', session);
}

export async function loadSession(): Promise<StoredSession | undefined> {
  const db = await getDB();
  return db.get('session', 'current');
}
