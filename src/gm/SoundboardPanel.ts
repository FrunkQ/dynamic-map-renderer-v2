import type { SoundboardSlot, AudioAsset, SoundboardAudioData } from '../types.ts';
import { SOUNDBOARD_PAGE_SIZE } from '../types.ts';
import { generateId } from '../utils/id.ts';

// ── Playback mode SVG icons (14×14, single currentColor) ─────────────────────

/** Play-once: triangle + vertical stop bar */
const ICON_ONCE = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><polygon points="1,2 10,8 1,14" fill="currentColor"/><rect x="12" y="2" width="2.5" height="12" rx="0.5" fill="currentColor"/></svg>`;

/** Loop: 🔁-style rectangular two-arrow loop */
const ICON_LOOP = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11 Q2 11 2 9 L2 7 Q2 5 4 5 L11 5"/><polyline points="9 3 11 5 9 7"/><path d="M13 5 Q14 5 14 7 L14 9 Q14 11 12 11 L5 11"/><polyline points="7 9 5 11 7 13"/></svg>`;

/** Random: shuffle icon — two crossing arrows (top-left→bottom-right, bottom-left→top-right) */
const ICON_RANDOM = `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 4 Q5 4 8 8 Q11 12 14 12"/><polyline points="11 10 14 12 11 14"/><path d="M1 12 Q5 12 8 8 Q11 4 14 4"/><polyline points="11 2 14 4 11 6"/></svg>`;
import { AudioAssetStore } from '../audio/AudioAssetStore.ts';
import { SoundboardEngine } from '../audio/SoundboardEngine.ts';
import { FreesoundModal } from './FreesoundModal.ts';

type SlotsChangedCb = (slots: SoundboardSlot[]) => void;

export type SoundboardBroadcast =
  | { type: 'play';     data: SoundboardAudioData }
  | { type: 'stop';     slotId: string }
  | { type: 'mute_all'; muted: boolean }
  | { type: 'volume';   slotId: string; volume: number };

export class SoundboardPanel {
  private slotsEl!:      HTMLElement;

  private pageLabel!:    HTMLElement;
  private prevBtn!:      HTMLButtonElement;
  private nextBtn!:      HTMLButtonElement;
  private addBtn!:       HTMLButtonElement;
  private muteAllToggle!: HTMLInputElement;

  private slots:   SoundboardSlot[] = [];
  private page     = 0;
  private pendingAssignSlotId: string | null = null;
  private rafId:   number | null = null;
  /** slotId → timeout handle for the random-play scheduler */
  private randomTimers = new Map<string, ReturnType<typeof setTimeout>>();

  private engine: SoundboardEngine;
  private modal:  FreesoundModal;
  private onSlotsChanged: SlotsChangedCb;
  private onBroadcast:    (msg: SoundboardBroadcast) => void;
  /** Fired after _loadBlobs() finishes — lets GMApp update Host with current asset list */
  onAssetsLoaded: (() => void) | null = null;
  /** Shared FreesoundModal instance — GMApp may open it with a custom callback for marker audio. */
  get audioModal(): FreesoundModal { return this.modal; }

  constructor(
    engine: SoundboardEngine,
    onSlotsChanged: SlotsChangedCb,
    onBroadcast: (msg: SoundboardBroadcast) => void,
  ) {
    this.engine         = engine;
    this.onSlotsChanged = onSlotsChanged;
    this.onBroadcast    = onBroadcast;

    this.modal = new FreesoundModal((asset) => this._handleAssign(asset));
    this._bindDOM();

    // When a one-shot finishes, reset its play button and hide progress bar
    this.engine.onSlotEnded = (slotId) => this._onSlotEnded(slotId);
  }

  update(slots: SoundboardSlot[]): void {
    const newIds = new Set(slots.map((s) => s.id));
    for (const id of this.randomTimers.keys()) {
      if (!newIds.has(id)) this._cancelRandom(id);
    }
    this.slots = slots;
    void this._loadBlobs();
    this._render();
  }

  stopAll(): void {
    this.engine.stopAll();
    this._stopRaf();
    this._render();
  }

  /** Returns all assets currently loaded in the engine for this map's slots. */
  getLoadedAssets(): { assetId: string; dataUrl: string }[] {
    const seen = new Set<string>();
    const result: { assetId: string; dataUrl: string }[] = [];
    for (const slot of this.slots) {
      if (!slot.assetId || seen.has(slot.assetId)) continue;
      seen.add(slot.assetId);
      const dataUrl = this.engine.getDataUrl(slot.assetId);
      if (dataUrl) result.push({ assetId: slot.assetId, dataUrl });
    }
    return result;
  }

  async getActiveSlots(): Promise<SoundboardAudioData[]> {
    const result: SoundboardAudioData[] = [];
    for (const slot of this.slots) {
      if (!slot.assetId || !this.engine.isPlaying(slot.id)) continue;
      const dataUrl = this.engine.getDataUrl(slot.assetId);
      if (dataUrl) {
        result.push({ slotId: slot.id, assetId: slot.assetId, loop: slot.loop, volume: slot.volume, dataUrl });
      }
    }
    return result;
  }

  // ─── DOM ──────────────────────────────────────────────────────────────────

  private _bindDOM(): void {
    const q = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
    this.slotsEl       = q('#soundboard-slots');

    this.pageLabel     = q('#sb-page-label');
    this.prevBtn       = q<HTMLButtonElement>('#sb-prev-btn');
    this.nextBtn       = q<HTMLButtonElement>('#sb-next-btn');
    this.addBtn        = q<HTMLButtonElement>('#sb-add-slot-btn');
    this.muteAllToggle = q<HTMLInputElement>('#mute-all-toggle');

    this.prevBtn.addEventListener('click', () => { this.page--; this._render(); });
    this.nextBtn.addEventListener('click', () => { this.page++; this._render(); });
    this.addBtn.addEventListener('click',  () => this._addSlot());

    this.muteAllToggle.addEventListener('change', () => {
      const muted = this.muteAllToggle.checked;
      this.engine.setMuteAll(muted);
      this.onBroadcast({ type: 'mute_all', muted });
      if (muted) this._stopRaf();
      this._render();
    });

    // Attributions handling moved to FreesoundModal (My Library footer) in v2.7.10.
  }

  private _render(): void {
    const totalPages = Math.max(1, Math.ceil(this.slots.length / SOUNDBOARD_PAGE_SIZE));
    this.page = Math.max(0, Math.min(this.page, totalPages - 1));

    const start   = this.page * SOUNDBOARD_PAGE_SIZE;
    const visible = this.slots.slice(start, start + SOUNDBOARD_PAGE_SIZE);

    this.slotsEl.innerHTML = '';
    for (const slot of visible) {
      this.slotsEl.appendChild(this._slotRow(slot));
    }

    this.pageLabel.textContent = `Page ${this.page + 1} / ${totalPages}`;
    this.prevBtn.disabled = this.page === 0;
    this.nextBtn.disabled = this.page === totalPages - 1;

    // Resume RAF if any slot is playing
    if (this.slots.some((s) => this.engine.isPlaying(s.id))) this._startRaf();
  }

  private _slotRow(slot: SoundboardSlot): HTMLElement {
    const playing     = this.engine.isPlaying(slot.id);
    const randActive  = slot.random === true && this.randomTimers.has(slot.id);
    const loaded      = slot.assetId ? this.engine.isLoaded(slot.assetId) : false;
    const row         = document.createElement('div');
    row.className     = 'sb-slot';
    row.dataset['slotId'] = slot.id;

    if (!slot.assetId) {
      row.innerHTML = `
        <div class="sb-slot-empty">
          <button class="sb-assign-btn btn btn--ghost btn--sm btn--full">+ Assign Sound</button>
          <button class="sb-remove-btn btn btn--danger btn--xs" title="Remove slot">×</button>
        </div>`;
    } else {
      const nameText  = this._esc(slot.label);
      const loadClass = loaded ? '' : ' sb-loading';
      const btnActive = playing || randActive;
      const showStop  = btnActive && (slot.loop || slot.random);
      const btnIcon   = showStop ? '⏹' : '▶';
      const btnTitle  = showStop ? 'Stop' : 'Play';
      const freq      = slot.randomFreq ?? 10;

      const modeOnce  = !slot.loop && !slot.random;
      const modeLoop  = !!slot.loop;
      const modeRand  = !!slot.random;

      row.innerHTML = `
        <div class="sb-slot-name-row">
          <button class="sb-name-btn" title="Change sound">${nameText}</button>
          <button class="sb-remove-btn btn btn--danger btn--xs" title="Remove slot">×</button>
        </div>
        <div class="sb-slot-controls">
          <button class="sb-play-btn btn btn--sm ${btnActive ? 'btn--active' : 'btn--ghost'}${loadClass}" title="${btnTitle}">${btnIcon}</button>
          <div class="sb-mode-btns" title="Playback mode">
            <button class="sb-mode-btn ${modeOnce ? 'sb-mode-btn--active' : ''}" data-mode="once"   title="Play once">${ICON_ONCE}</button>
            <button class="sb-mode-btn ${modeLoop ? 'sb-mode-btn--active' : ''}" data-mode="loop"   title="Loop">${ICON_LOOP}</button>
            <button class="sb-mode-btn ${modeRand ? 'sb-mode-btn--active' : ''}" data-mode="random" title="Random">${ICON_RANDOM}</button>
          </div>
          <input type="range" class="sb-volume" min="0" max="1" step="0.05" value="${slot.volume}" title="Volume" />
        </div>
        ${slot.random ? `
        <div class="sb-random-row">
          <input type="range" class="sb-random-freq" min="1" max="100" step="1" value="${freq}" title="Random frequency" />
          <span class="sb-random-label">~${freq} / 10 min</span>
        </div>` : ''}
        <div class="sb-progress-track" ${playing ? '' : 'hidden'}>
          <div class="sb-progress-fill"></div>
        </div>`;
    }

    row.querySelector('.sb-assign-btn, .sb-name-btn')?.addEventListener('click', () => {
      this.pendingAssignSlotId = slot.id;
      this.modal.open();
    });

    row.querySelector('.sb-play-btn')?.addEventListener('click', () => {
      const current = this.slots.find((s) => s.id === slot.id) ?? slot;

      if (current.random) {
        if (this.randomTimers.has(current.id)) {
          this._cancelRandom(current.id);
          this.engine.stop(current.id);
          this.onBroadcast({ type: 'stop', slotId: current.id });
          this._updateSlot(current.id, { playing: false });
          this._updateSlotPlayState(current.id, false);
        } else {
          this._updateSlot(current.id, { playing: true });
          this._scheduleRandom(current);
          this._updateSlotPlayState(current.id, true);
        }
      } else if (current.loop && this.engine.isPlaying(current.id)) {
        this.engine.stop(current.id);
        this.onBroadcast({ type: 'stop', slotId: current.id });
        this._updateSlot(current.id, { playing: false });
        this._updateSlotPlayState(current.id, false, true);
      } else {
        this._triggerPlay(current);
      }
    });

    row.querySelectorAll<HTMLButtonElement>('.sb-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset['mode'] as 'once' | 'loop' | 'random';
        // Stop whatever is currently running
        this._cancelRandom(slot.id);
        if (this.engine.isPlaying(slot.id)) {
          this.engine.stop(slot.id);
          this.onBroadcast({ type: 'stop', slotId: slot.id });
        }
        const newLoop   = mode === 'loop';
        const newRandom = mode === 'random';
        this.engine.setLoop(slot.id, newLoop);
        this._updateSlot(slot.id, { loop: newLoop, random: newRandom, playing: false });
        this._render();
      });
    });

    row.querySelector<HTMLInputElement>('.sb-random-freq')?.addEventListener('input', (e) => {
      const freq = parseInt((e.target as HTMLInputElement).value, 10);
      const label = row.querySelector<HTMLElement>('.sb-random-label');
      if (label) label.textContent = `~${freq} / 10 min`;
      this._updateSlot(slot.id, { randomFreq: freq });
      // Reschedule with new frequency if scheduler is running
      if (this.randomTimers.has(slot.id)) {
        this._cancelRandom(slot.id);
        const updated = this.slots.find((s) => s.id === slot.id);
        if (updated) this._scheduleRandom(updated);
      }
    });

    row.querySelector<HTMLInputElement>('.sb-volume')?.addEventListener('input', (e) => {
      const volume = parseFloat((e.target as HTMLInputElement).value);
      this.engine.setVolume(slot.id, volume);
      this._updateSlot(slot.id, { volume });
      if (this.engine.isPlaying(slot.id) || this.randomTimers.has(slot.id)) {
        this.onBroadcast({ type: 'volume', slotId: slot.id, volume });
      }
    });

    row.querySelector('.sb-remove-btn')?.addEventListener('click', () => this._removeSlot(slot.id));

    return row;
  }

  // ─── Targeted DOM updates (avoid full re-render) ──────────────────────────

  private _updateSlotPlayState(slotId: string, playing: boolean, loop?: boolean): void {
    const rowEl = this.slotsEl.querySelector<HTMLElement>(`[data-slot-id="${slotId}"]`);
    if (!rowEl) return;
    const btn   = rowEl.querySelector<HTMLButtonElement>('.sb-play-btn');
    const track = rowEl.querySelector<HTMLElement>('.sb-progress-track');
    if (btn) {
      const slot      = this.slots.find((s) => s.id === slotId);
      const isLoop    = loop ?? slot?.loop ?? false;
      const isRand    = slot?.random ?? false;
      const randActive = isRand && this.randomTimers.has(slotId);
      const btnActive  = playing || randActive;
      const showStop   = btnActive && (isLoop || isRand);
      btn.textContent = showStop ? '⏹' : '▶';
      btn.classList.toggle('btn--active', btnActive);
      btn.classList.toggle('btn--ghost',  !btnActive);
      btn.title = showStop ? 'Stop' : 'Play';
    }
    if (track) track.hidden = !playing;
  }

  private _onSlotEnded(slotId: string): void {
    // For random slots, only hide the progress bar — the scheduler is still running
    if (this.randomTimers.has(slotId)) {
      const rowEl = this.slotsEl.querySelector<HTMLElement>(`[data-slot-id="${slotId}"]`);
      rowEl?.querySelector<HTMLElement>('.sb-progress-track')?.setAttribute('hidden', '');
    } else {
      this._updateSlotPlayState(slotId, false);
    }
    if (!this.slots.some((s) => this.engine.isPlaying(s.id))) this._stopRaf();
  }

  // ─── Progress RAF ─────────────────────────────────────────────────────────

  private _startRaf(): void {
    if (this.rafId !== null) return;
    const tick = () => {
      this._tickProgress();
      if (this.slots.some((s) => this.engine.isPlaying(s.id))) {
        this.rafId = requestAnimationFrame(tick);
      } else {
        this.rafId = null;
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private _stopRaf(): void {
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }

  private _tickProgress(): void {
    const start   = this.page * SOUNDBOARD_PAGE_SIZE;
    const visible = this.slots.slice(start, start + SOUNDBOARD_PAGE_SIZE);

    for (const slot of visible) {
      const rowEl = this.slotsEl.querySelector<HTMLElement>(`[data-slot-id="${slot.id}"]`);
      if (!rowEl) continue;
      const fill = rowEl.querySelector<HTMLElement>('.sb-progress-fill');
      if (!fill) continue;
      const p = this.engine.getProgress(slot.id);
      if (p >= 0) fill.style.width = `${p * 100}%`;
    }
  }

  // ─── Slot management ──────────────────────────────────────────────────────

  private _addSlot(): void {
    const newSlot: SoundboardSlot = {
      id:      generateId(),
      assetId: null,
      label:   '',
      loop:    false,
      volume:  0.8,
    };
    this.slots = [...this.slots, newSlot];
    this.page = Math.floor((this.slots.length - 1) / SOUNDBOARD_PAGE_SIZE);
    this.onSlotsChanged(this.slots);
    this._render();
  }

  private _removeSlot(slotId: string): void {
    this._cancelRandom(slotId);
    this.engine.stop(slotId);
    this.slots = this.slots.filter((s) => s.id !== slotId);
    if (!this.slots.some((s) => this.engine.isPlaying(s.id))) this._stopRaf();
    this.onSlotsChanged(this.slots);
    this._render();
  }

  private _updateSlot(slotId: string, patch: Partial<SoundboardSlot>): void {
    this.slots = this.slots.map((s) => s.id === slotId ? { ...s, ...patch } : s);
    this.onSlotsChanged(this.slots);
  }

  private async _handleAssign(asset: AudioAsset): Promise<void> {
    const slotId = this.pendingAssignSlotId;
    if (!slotId) return;
    this.pendingAssignSlotId = null;
    await this._loadAssetIntoEngine(asset);
    this._updateSlot(slotId, { assetId: asset.id, label: asset.name });
    this._render();
  }

  private async _loadBlobs(): Promise<void> {
    const ids = new Set(this.slots.map((s) => s.assetId).filter(Boolean) as string[]);
    await Promise.all([...ids].map(async (assetId) => {
      if (this.engine.isLoaded(assetId)) return;
      const meta = await AudioAssetStore.get(assetId);
      if (!meta) return;
      await this._loadAssetIntoEngine(meta);
    }));
    // Auto-resume loops and random schedulers that were active on last map visit.
    // Await all play() promises so el.paused is false by the time _render() runs —
    // otherwise isPlaying() returns false during the async gap and the UI shows wrong state.
    const resumePromises: Promise<void>[] = [];
    for (const slot of this.slots) {
      if (!slot.playing || !slot.assetId) continue;
      if (slot.loop && !this.engine.isPlaying(slot.id)) {
        resumePromises.push(this.engine.play(slot.id, slot.assetId, true, slot.volume));
        const dataUrl = this.engine.getDataUrl(slot.assetId);
        if (dataUrl) {
          this.onBroadcast({ type: 'play', data: {
            slotId: slot.id, assetId: slot.assetId, loop: true, volume: slot.volume, dataUrl,
          }});
        }
      } else if (slot.random && !this.randomTimers.has(slot.id)) {
        this._scheduleRandom(slot);
      }
    }
    await Promise.all(resumePromises);
    this._render();
    this._startRaf(); // restart progress bar for any resumed loops
    this.onAssetsLoaded?.();
  }

  /** Fire a one-shot play for a slot (used by play button and random scheduler). */
  private _triggerPlay(slot: SoundboardSlot): void {
    if (!slot.assetId) return;
    this.engine.play(slot.id, slot.assetId, slot.loop, slot.volume);
    const dataUrl = this.engine.getDataUrl(slot.assetId);
    if (dataUrl) {
      this.onBroadcast({ type: 'play', data: {
        slotId: slot.id, assetId: slot.assetId, loop: slot.loop, volume: slot.volume, dataUrl,
      }});
    }
    if (slot.loop) this._updateSlot(slot.id, { playing: true });
    this._updateSlotPlayState(slot.id, true, slot.loop);
    this._startRaf();
  }

  /**
   * Schedule the next auto-play for a random slot.
   * Interval = (600 / freq) seconds, randomised with exponential jitter so plays
   * feel organic rather than metronomic. Typical spread is ~0.4× – 2.5× base.
   */
  private _scheduleRandom(slot: SoundboardSlot): void {
    const freq     = slot.randomFreq ?? 10;
    const baseMs   = (600 / freq) * 1000;
    // Exponential distribution: -ln(U) gives the right spread for a Poisson process.
    const jitter   = -Math.log(Math.random() || 1e-9);
    const delay    = Math.min(baseMs * jitter, baseMs * 4); // cap at 4× base
    this.randomTimers.set(slot.id, setTimeout(() => {
      this.randomTimers.delete(slot.id);
      const current = this.slots.find((s) => s.id === slot.id);
      if (!current?.random || !current.assetId) return;
      // Fire as a one-shot (loop: false) — scheduler controls repetition
      this.engine.play(current.id, current.assetId, false, current.volume);
      const dataUrl = this.engine.getDataUrl(current.assetId);
      if (dataUrl) {
        this.onBroadcast({ type: 'play', data: {
          slotId: current.id, assetId: current.assetId, loop: false, volume: current.volume, dataUrl,
        }});
      }
      this._updateSlotPlayState(current.id, true, false);
      this._startRaf();
      // Schedule the next play
      this._scheduleRandom(current);
    }, delay));
  }

  private _cancelRandom(slotId: string): void {
    const handle = this.randomTimers.get(slotId);
    if (handle !== undefined) { clearTimeout(handle); this.randomTimers.delete(slotId); }
  }

  private async _loadAssetIntoEngine(asset: AudioAsset): Promise<void> {
    if (this.engine.isLoaded(asset.id)) return;
    const blob = await AudioAssetStore.getBlob(asset);
    if (!blob) return;
    const blobUrl = URL.createObjectURL(blob);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    this.engine.prepareAsset(asset.id, blobUrl, dataUrl);
  }

  // ─── Attributions modal ───────────────────────────────────────────────────

  private _esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
