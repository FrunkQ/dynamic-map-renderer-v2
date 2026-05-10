import { ProjectorCalibrationModal } from './gm/ProjectorCalibrationModal.ts';

/**
 * Standalone calibration entry. Launched by the GM as `window.open` so the
 * user can drag the calibration window onto their projector / under-table
 * display and toggle fullscreen — calibration depends on the grid being
 * physically projected at scale before they ruler it. After save (or
 * cancel) the window closes itself; the GM picks up the new setup via
 * a `storage` event.
 */
const modal = new ProjectorCalibrationModal();
modal.open({ standalone: true }).then(() => window.close());
