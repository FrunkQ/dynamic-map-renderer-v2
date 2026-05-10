/**
 * Optional password encryption for saved Mappadux bundles.
 *
 * Wrapper format (serialised as JSON inside the .mappadux file):
 *   {
 *     "__mappadux_format__": "enc:v1",
 *     "kdf":    { "name": "PBKDF2", "iterations": 200_000, "hash": "SHA-256" },
 *     "salt":   "<base64, 16 bytes random>",
 *     "iv":     "<base64, 12 bytes random — AES-GCM nonce>",
 *     "cipher": "<base64 — AES-GCM ciphertext of the plain bundle JSON>"
 *   }
 *
 * AES-GCM authenticates the cipher itself, so a wrong password is detected by
 * a decrypt failure and surfaced as a generic "wrong password / corrupt file"
 * error — we deliberately do not distinguish between bad password and tampered
 * bytes.
 *
 * Salt + IV are random per-save, never reused, embedded alongside the cipher.
 * PBKDF2 iterations are deliberately high so a deliberate cost is paid on
 * unlock; tuned to be a noticeable but not painful pause on first open.
 */

const PBKDF2_ITERATIONS = 200_000;
const SALT_BYTES = 16;
const IV_BYTES   = 12;

export interface EncryptedBundleEnvelope {
  __mappadux_format__: 'enc:v1';
  kdf:    { name: 'PBKDF2'; iterations: number; hash: 'SHA-256' };
  salt:   string;
  iv:     string;
  cipher: string;
  /** True when the plaintext (before encryption) was gzipped. Decoders must
   *  gunzip after decrypting. Older envelopes lacking this field hold raw
   *  UTF-8 JSON. */
  compressed?: boolean;
}

/** Thrown by importBundle when the file is encrypted; the caller is expected
 *  to prompt for a password and call `importBundleText(decrypted)` instead. */
export class EncryptedBundleError extends Error {
  constructor(public readonly envelope: EncryptedBundleEnvelope) {
    super('Encrypted bundle — password required');
  }
}

// ── base64 helpers (chunked for large ciphertexts) ──────────────────────────

function ab2b64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (let i = 0; i < bytes.length; i += 65536) {
    str += String.fromCharCode(...bytes.subarray(i, Math.min(i + 65536, bytes.length)));
  }
  return btoa(str);
}

function b64ToAb(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ── crypto core ─────────────────────────────────────────────────────────────

async function deriveKey(password: string, salt: ArrayBuffer): Promise<CryptoKey> {
  const passKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    passKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Encrypt arbitrary bytes (typically gzipped bundle JSON) into an envelope.
 *  Set `compressed: true` so the decoder knows to gunzip after decrypting. */
export async function encryptBundleBytes(
  plainBytes: Uint8Array,
  password: string,
  opts?: { compressed?: boolean },
): Promise<EncryptedBundleEnvelope> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv   = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key  = await deriveKey(password, salt.buffer as ArrayBuffer);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plainBytes as BufferSource,
  );
  return {
    __mappadux_format__: 'enc:v1',
    kdf:    { name: 'PBKDF2', iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    salt:   ab2b64(salt.buffer as ArrayBuffer),
    iv:     ab2b64(iv.buffer   as ArrayBuffer),
    cipher: ab2b64(cipher),
    ...(opts?.compressed ? { compressed: true } : {}),
  };
}

/** Decrypt an envelope to raw bytes (the plaintext from before encryption —
 *  may be gzipped JSON or raw UTF-8 JSON depending on `envelope.compressed`).
 *  Throws the generic "Wrong password or corrupt file." on any failure. */
export async function decryptBundleEnvelopeToBytes(
  envelope: EncryptedBundleEnvelope,
  password: string,
): Promise<Uint8Array> {
  const salt   = b64ToAb(envelope.salt);
  const iv     = b64ToAb(envelope.iv);
  const cipher = b64ToAb(envelope.cipher);
  const key    = await deriveKey(password, salt);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
  } catch {
    throw new Error('Wrong password or corrupt file.');
  }
  return new Uint8Array(plain);
}

/** Tag-test a parsed JSON value to see whether it's an encrypted envelope. */
export function isEncryptedBundleEnvelope(value: unknown): value is EncryptedBundleEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const o = value as Record<string, unknown>;
  return (
    o['__mappadux_format__'] === 'enc:v1' &&
    typeof o['salt']   === 'string' &&
    typeof o['iv']     === 'string' &&
    typeof o['cipher'] === 'string'
  );
}
