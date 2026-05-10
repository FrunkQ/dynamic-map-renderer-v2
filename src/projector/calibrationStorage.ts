/**
 * Projector calibration storage.
 *
 * A "setup" is a named calibration record describing how many CSS pixels the
 * device must render per 1"/25 mm physical square on the projection surface.
 * Stored per-device in localStorage so calibration survives page reloads but
 * doesn't follow the user across machines (since the same browser on a
 * different display would have different physics).
 *
 * The Projector view multiplies its own `pixelsPerSquare` against the active
 * map's `pixelsPerSquare` to compute the projector-viewport rectangle on the
 * map: viewport_w_in_map_px = projector_canvas_w_in_css_px * (map_pps / proj_pps)
 */

export type ProjectorSetupType = 'lfd' | 'projector';

export interface ProjectorSetup {
  id: string;
  name: string;
  /** CSS pixels per 1"/25 mm square. */
  pixelsPerSquare: number;
  setupType: ProjectorSetupType;
  /** LFD-path metadata, retained so the user can re-derive the LFD result. */
  diagonalInches?: number;
  resolutionWidth?: number;
  resolutionHeight?: number;
  createdAt: number;
}

const SETUPS_KEY = 'dmr_projector_setups';
const ACTIVE_KEY = 'dmr_projector_active';

export function getAllSetups(): ProjectorSetup[] {
  try {
    const raw = localStorage.getItem(SETUPS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed as ProjectorSetup[] : [];
  } catch {
    return [];
  }
}

export function saveSetup(setup: ProjectorSetup): void {
  const all = getAllSetups();
  const idx = all.findIndex((s) => s.id === setup.id);
  if (idx >= 0) all[idx] = setup;
  else            all.push(setup);
  localStorage.setItem(SETUPS_KEY, JSON.stringify(all));
}

export function deleteSetup(id: string): void {
  const all = getAllSetups().filter((s) => s.id !== id);
  localStorage.setItem(SETUPS_KEY, JSON.stringify(all));
  if (getActiveSetupId() === id) setActiveSetupId(null);
}

export function getActiveSetupId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveSetupId(id: string | null): void {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else    localStorage.removeItem(ACTIVE_KEY);
}

export function getActiveSetup(): ProjectorSetup | null {
  const id = getActiveSetupId();
  if (!id) return null;
  return getAllSetups().find((s) => s.id === id) ?? null;
}

/**
 * Compute pixels-per-1"-square for a Large Format Display from its physical
 * diagonal and pixel resolution. Naïve assumption: at 100 % browser zoom
 * 1 CSS px ≈ 1 device px on the addressable rendering surface. Good enough
 * for sane LFD setups; users with non-standard OS scaling can fine-tune via
 * the projector-grid path afterward.
 */
export function pixelsPerInchFromLfd(
  diagonalInches: number,
  widthPx: number,
  heightPx: number,
): number {
  if (diagonalInches <= 0) return 0;
  const diagPx = Math.sqrt(widthPx * widthPx + heightPx * heightPx);
  return diagPx / diagonalInches;
}
