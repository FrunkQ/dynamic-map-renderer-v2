/**
 * Extract the first frame of a video blob as a PNG.
 *
 * Used by the two-phase animated-map delivery (v2.12.x): instead of
 * blasting the full 57 MB+ video over WebRTC up front, the GM sends a
 * lightweight snapshot in the map_change message — the player can
 * render something within a second or two — and the full video
 * follows as a separate MsgVideoBundle. Receivers swap to the
 * VideoTexture only once the bytes have arrived.
 *
 * Pure utility — no dependencies on the renderer or any module that
 * imports Three.js.
 */
export async function extractFirstFrameSnapshot(videoBlob: Blob): Promise<Blob> {
  if (!videoBlob.type.startsWith('video/')) {
    // Caller should have sniffed already — defensive return so a
    // mis-typed image just round-trips.
    return videoBlob;
  }

  const url = URL.createObjectURL(videoBlob);
  const v   = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;

  try {
    await new Promise<void>((resolve, reject) => {
      // We need a paintable first frame, not just metadata. Different
      // browsers settle on different events for "decoded frame ready"
      // — listen to both and resolve on whichever fires first.
      const ok = () => resolve();
      v.addEventListener('loadeddata', ok, { once: true });
      v.addEventListener('canplay',    ok, { once: true });
      v.addEventListener('error', () => reject(new Error('video decode failed')), { once: true });
    });

    const w = v.videoWidth  || 1;
    const h = v.videoHeight || 1;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d unavailable');
    ctx.drawImage(v, 0, 0, w, h);

    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob returned null'))),
        'image/png',
      );
    });
  } finally {
    URL.revokeObjectURL(url);
    v.removeAttribute('src');
    try { v.load(); } catch { /* benign teardown error */ }
  }
}
