import { ProjectorCalibrationModal } from './gm/ProjectorCalibrationModal.ts';

/**
 * Standalone calibration entry. Launched by the GM as `window.open` so the
 * user can drag the calibration window onto their projector / under-table
 * display and toggle fullscreen — calibration depends on the grid being
 * physically projected at scale before they ruler it. After save (or
 * cancel) the window closes itself; the GM picks up the new setup via
 * a `storage` event.
 */
// v2.14.2 — self-close if the main GM window broadcasts its closing
// signal (otherwise an in-flight calibration window would linger after
// the GM shuts down).
try {
  const lifecycle = new BroadcastChannel('mappadux:lifecycle');
  lifecycle.onmessage = (e) => {
    if (e?.data?.kind === 'gm-closing') {
      try { window.close(); } catch { /* no-op */ }
    }
  };
} catch { /* BroadcastChannel unavailable — window stays open */ }

const modal = new ProjectorCalibrationModal();
modal.open({ standalone: true }).then(() => window.close());
