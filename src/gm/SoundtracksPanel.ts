/**
 * SoundtracksPanel — pack-level background music with N user-defined
 * slots, mutually-exclusive playback, and crossfade on slot switch.
 *
 * The first slot is always a "Silent" anchor — selecting it
 * crossfades the current track to silence and stops. Other slots
 * are user-authored, each with:
 *   - label (e.g. "Tavern", "Combat")
 *   - mode: play-once | loop | playlist
 *   - tracks: YouTube and/or Spotify URLs
 *   - per-mode controls: start/end times for play-once/loop, shuffle
 *     for playlist
 *   - per-slot volume
 *
 * One YouTube and one Spotify engine live alongside each other. The
 * crossfade engine ramps the active engine's volume to 0 while
 * ramping the new engine's volume from 0 to the target. Both engines
 * support setVolume (YouTube IFrame Player + Spotify Web Playback
 * SDK), so this works across providers without a parallel-iframe
 * trick.
 *
 * v2.15.12 — N-slot model + Spotify SDK + crossfade.
 *
 * v2.20.0 — Local songs via the Vamper engine (VamperSongPlayer). A
 * slot can hold a song from the audio library; every slot on the
 * same song is a passage of it (Start / End trim, snapped to bars),
 * and switching between two of them changes on the next bar with a
 * seamless join instead of crossfading. Switching to or from any
 * other slot still crossfades.
 */

import type { SoundtracksConfig, SoundtrackSlot, SoundtrackTrack } from '../types.ts';
import {
  isSoundtracksEnabled,
  isYoutubeEnabled,
  isSpotifyEnabled,
  isLocalSongsEnabled,
} from '../stagecraft/stagecraftStorage.ts';
import { VamperSongPlayer } from '../audio/VamperSongPlayer.ts';
import { AudioAssetStore } from '../audio/AudioAssetStore.ts';
import { generateId } from '../utils/id.ts';
import type { AudioAsset } from '../types.ts';
import {
  createYouTubePlayer,
  YT_STATE,
  type YouTubeSoundtrackPlayer,
} from '../stagecraft/youtubePlayer.ts';
import {
  createSpotifyPlayer,
  type SpotifySoundtrackPlayer,
} from '../stagecraft/spotifySdk.ts';
import { isSpotifyConnected, getSpotifyProfile, getAccessToken, startConnect } from '../stagecraft/spotifyAuth.ts';
import { parseSoundtrackUrl, parseSpotifyUri } from '../stagecraft/soundtrackUrl.ts';
import { migrateSoundtracksConfig, newUserSlot } from '../stagecraft/soundtracksMigrate.ts';

// Lucide-style inline SVGs. Stroke uses currentColor so they pick
// up the button's text colour (active toggles get the accent).
const ICON_PLAY    = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>';
const ICON_PAUSE   = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
const ICON_PREV    = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M6 6v12h2V6H6zM20 6l-10 6 10 6V6z"/></svg>';
const ICON_NEXT    = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M4 6l10 6-10 6V6zM16 6v12h2V6h-2z"/></svg>';
const ICON_LOOP    = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';
const ICON_SHUFFLE = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>';
// v2.15.32 — Slot-type indicators (between the play button and the
// label so the GM can tell at a glance what each slot contains).
const ICON_TYPE_SILENT   = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>';
const ICON_TYPE_TRACK    = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>';
const ICON_TYPE_PLAYLIST = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15V6"/><circle cx="18.5" cy="17.5" r="2.5"/><path d="M12 12H3"/><path d="M16 6H3"/><path d="M12 18H3"/></svg>';
// v2.15.34 — Restart-vs-resume toggle. Lucide rotate-ccw — a clear
// "back to the start" arrow distinct from the prev-track icon used
// by the transport bar.
const ICON_RESTART = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>';

// v2.15.36 — Provider brand icons. Brand colours baked in so they
// pop next to the monochrome type icons. Simple Icons paths.
const ICON_PROVIDER_YT = '<svg viewBox="0 0 24 24" width="14" height="14" fill="#FF0033"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>';
const ICON_PROVIDER_SP = '<svg viewBox="0 0 24 24" width="14" height="14" fill="#1DB954"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.42 1.56-.299.421-1.02.599-1.559.3z"/></svg>';

// v2.20.0 — Local song (Vamper): an audio waveform, in the accent colour.
const ICON_PROVIDER_VAMPER = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12h2M6 8v8M10 4v16M14 7v10M18 10v4M22 12h0"/></svg>';

function _providerIconFor(track: SoundtrackTrack | undefined): string | null {
  if (!track) return null;
  if (track.kind === 'vamper')  return ICON_PROVIDER_VAMPER;
  if (track.kind === 'spotify') return ICON_PROVIDER_SP;
  return ICON_PROVIDER_YT;  // 'youtube' or 'youtube-playlist'
}

function _providerNameFor(track: SoundtrackTrack | undefined): string {
  if (!track) return '';
  if (track.kind === 'vamper')  return 'Vamper';
  if (track.kind === 'spotify') return 'Spotify';
  return 'YouTube';
}

/** Effective Restart-vs-Resume for a slot. If the user has
 *  explicitly set slot.restart, use that. Otherwise default by
 *  content kind: single tracks restart; playlists + loops resume. */
function _effectiveRestart(slot: SoundtrackSlot): boolean {
  if (slot.restart !== undefined) return slot.restart;
  if (!slot.track) return true;
  if (_isPlaylistContent(slot.track)) return false;
  if (slot.loop) return false;
  return true;
}

interface ResumeState {
  /** Position in seconds within the current track. */
  positionSec: number;
  /** YT playlist index, if the slot was playing a YT playlist.
   *  v2.15.39 — kept as a hint for the post-resume playlist handoff
   *  (so an unshuffled playlist continues with the NEXT track in
   *  order). Shuffled playlists ignore it and re-randomise. */
  playlistIndex?: number;
  /** YT video id of the specific track playing when we switched
   *  away. v2.15.39 — shuffle re-randomises the playlist queue on
   *  reload, so playlistIndex alone resumes onto the wrong track.
   *  Capturing the videoId lets us play THIS exact track first (via
   *  a one-shot single-video load), then hand off to the playlist
   *  for the rest. */
  youtubeVideoId?: string;
  /** Spotify current-track URI within the playing context (for
   *  best-effort resume — Spotify can only resume from the same
   *  context-uri unless we use the offset parameter on play). */
  spotifyTrackUri?: string;
}

/** v2.15.39 — pending handoff back into a YT playlist after a
 *  single-track shuffle-stable resume finishes. When set, the next
 *  ENDED state event for the active slot triggers loadPlaylist
 *  instead of falling to the silent anchor. */
interface YouTubePlaylistHandoff {
  slotId: string;
  listId: string;
  loop: boolean;
  shuffle: boolean;
  /** Index to start the playlist at — for unshuffled playlists we
   *  continue from savedIndex + 1; shuffled playlists ignore this. */
  startIndex: number;
  /** Volume to apply when the playlist takes over (the active slot's
   *  configured volume, modulo mute). */
  volume: number;
}

/** True if the track is a playlist-style item — the engine iterates
 *  it internally rather than playing one item. Drives whether the
 *  Shuffle toggle is visible / meaningful on the slot. */
function _isPlaylistContent(track: SoundtrackTrack): boolean {
  if (track.kind === 'youtube-playlist') return true;
  if (track.kind === 'spotify') {
    const p = parseSpotifyUri(track.trackUri);
    return !!p && p.kind !== 'track';
  }
  return false;
}

export interface SoundtracksPanelHost {
  /** Returns the current config (legacy-shape allowed; the panel
   *  migrates on first read). */
  getConfig(): SoundtracksConfig;
  saveConfig(cfg: SoundtracksConfig): Promise<void>;
}

const DEFAULT_VOLUME = 80;
const CROSSFADE_STEPS = 20;

export class SoundtracksPanel {
  private host:        SoundtracksPanelHost;
  private panelEl:     HTMLElement;
  private slotsEl:     HTMLElement;
  private statusEl:    HTMLElement;
  /** Migrated working copy of the config. */
  private cfg:         SoundtracksConfig = { slots: [] };
  /** Lazily created engines. */
  private ytPlayer:      YouTubeSoundtrackPlayer | null = null;
  private spotifyPlayer: SpotifySoundtrackPlayer | null = null;
  /** v2.20.0 — Local songs. Created on first use. */
  private vamper: VamperSongPlayer | null = null;
  /** Which provider's engine is currently producing audio. */
  private activeKind:   'youtube' | 'spotify' | 'vamper' | null = null;
  /** Which slot is currently playing — id from this.cfg.slots. */
  private activeSlotId: string | null = null;
  /** RAF / setTimeout handle for the running crossfade so we can
   *  cancel mid-fade if the user picks another slot. */
  private crossfadeTimer: ReturnType<typeof setTimeout> | null = null;
  /** Poll handle that refreshes the now-playing chip every second
   *  while something is playing (so YT/Spotify track changes within
   *  a playlist surface in the UI). */
  private nowPlayingTimer: ReturnType<typeof setInterval> | null = null;
  /** Whether the active player is currently paused. Flips the
   *  pause/play transport icon. */
  private isPaused = false;
  /** v2.15.27 — panel-level mute. Suppresses the audio output of
   *  whichever player is active without stopping playback (so
   *  toggling back on resumes from where it would have been).
   *  Defaults to NOT muted; persisted in localStorage so a GM who
   *  killed the music last session lands with it killed again. */
  private isMuted = false;
  private muteToggleEl: HTMLInputElement | null = null;
  /** v2.15.28 — Per-slot resume state. When the user switches
   *  away from a slot we capture position / playlist-index /
   *  current-track-uri here; switching back resumes from there.
   *  In-memory only — clears on reload, which is fine (the user
   *  can always hit prev to restart from track 0). */
  private resumeStates = new Map<string, ResumeState>();
  /** v2.15.33 — Count of consecutive unembeddable-track skips for
   *  the active playlist. Bails out at 4 to avoid spinning through
   *  an entirely-broken playlist (private list, region-locked, etc.). */
  private _consecutiveSkips = 0;
  /** v2.15.38 — Suppression latch for the end-trim poll. After we
   *  fire _onTrackEnded because position crossed slot.endSec, hold
   *  off re-firing until position drops back below endSec (the
   *  loop/restart will pull it back to startSec, which is below).
   *  Without this, the half-second poll keeps re-firing during the
   *  reload window. Resets on slot change. */
  private _endTrimFired = false;
  /** v2.15.39 — Pending playlist handoff. See YouTubePlaylistHandoff. */
  private _ytHandoff: YouTubePlaylistHandoff | null = null;
  /** v2.15.42 — Result of the latest Spotify auth probe (refresh-
   *  token still valid?). null = not yet checked or N/A; true = ok;
   *  false = needs reconnect (refresh token revoked / never set).
   *  The panel reads this to decide whether to show an inline
   *  Reconnect prompt. */
  private _spotifyAuthOk: boolean | null = null;

  constructor(host: SoundtracksPanelHost) {
    this.host     = host;
    this.panelEl  = document.getElementById('soundtracks-panel')!;
    this.slotsEl  = document.getElementById('soundtracks-slots')!;
    this.statusEl = document.getElementById('soundtracks-status')!;
    this.muteToggleEl = document.getElementById('soundtracks-mute-toggle') as HTMLInputElement | null;
    if (this.muteToggleEl) {
      try {
        this.isMuted = localStorage.getItem('mappadux:soundtracks_muted') === '1';
      } catch { /* nothing */ }
      this.muteToggleEl.checked = !this.isMuted;
      this.muteToggleEl.addEventListener('click', (e) => e.stopPropagation());
      this.muteToggleEl.addEventListener('change', () => {
        this.isMuted = !this.muteToggleEl!.checked;
        try {
          if (this.isMuted) localStorage.setItem('mappadux:soundtracks_muted', '1');
          else              localStorage.removeItem('mappadux:soundtracks_muted');
        } catch { /* nothing */ }
        this._applyMute();
      });
    }
  }

  /** Snapshot the active engine's playhead so a later switch-back
   *  to this slot can resume from where we left off. */
  private _captureResumeState(): ResumeState | null {
    if (this.activeKind === 'youtube' && this.ytPlayer) {
      const positionSec  = this.ytPlayer.getCurrentTime();
      const playlistIndex = this.ytPlayer.getPlaylistIndex();
      const videoId       = this.ytPlayer.getCurrentVideoId();
      const state: ResumeState = { positionSec };
      if (playlistIndex >= 0) state.playlistIndex   = playlistIndex;
      if (videoId)            state.youtubeVideoId  = videoId;
      return state;
    }
    if (this.activeKind === 'spotify' && this.spotifyPlayer) {
      const positionMs = this.spotifyPlayer.getPositionMs();
      const trackUri   = this.spotifyPlayer.getCurrentTrackUri();
      const state: ResumeState = { positionSec: positionMs / 1000 };
      if (trackUri) state.spotifyTrackUri = trackUri;
      return state;
    }
    return null;
  }

  /** Apply the current mute state to the active player. Volume goes
   *  to 0 when muted; restores to the active slot's volume when
   *  unmuted. Called on toggle + after every track load + crossfade. */
  private _applyMute(): void {
    if (this.activeKind === 'vamper') {
      this.vamper?.setVolume(this.isMuted ? 0 : this._currentVolume(), 100);
      return;
    }
    const p = this._activePlayer();
    if (!p) return;
    const target = this.isMuted ? 0 : this._currentVolume();
    if (this.activeKind === 'spotify') void (p as SpotifySoundtrackPlayer).setVolume(target);
    else                                (p as YouTubeSoundtrackPlayer).setVolume(target);
  }

  refresh(): void {
    if (!isSoundtracksEnabled()) {
      this.panelEl.hidden = true;
      this._teardownAllPlayers();
      return;
    }
    this.panelEl.hidden = false;
    this.cfg = migrateSoundtracksConfig(this.host.getConfig());
    // v2.15.44 — When nothing has ever been played in this session,
    // mark the Silence anchor (always slot index 0) as the active
    // selection. Visually this highlights "Silence" so the GM sees
    // a defined state instead of "no slot selected". Functionally
    // it's already what _selectSlot('silent') would do — engine
    // stays idle — so the first real slot click just crossfades up
    // from silence as expected.
    if (this.activeSlotId === null && this.cfg.slots.length > 0) {
      this.activeSlotId = this.cfg.slots[0]!.id;
    }
    this._renderSlots();
    // v2.15.42 — Probe the Spotify access-token path in the background
    // whenever the panel is shown. If the refresh token has been
    // revoked (Spotify side, or > 1 yr inactivity) this catches it
    // upfront so the GM sees an inline "Reconnect" prompt instead of
    // a stuck "Loading Spotify player…" the first time they click play.
    if (isSpotifyEnabled() && isSpotifyConnected()) {
      this._spotifyAuthOk = null;
      void getAccessToken().then((tok) => {
        this._spotifyAuthOk = !!tok;
        // Re-render so the Reconnect prompt (or its absence) reflects
        // the probe result. Cheap — the panel is small.
        this._renderSlots();
      });
    } else {
      this._spotifyAuthOk = null;
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────

  private _renderSlots(): void {
    this.slotsEl.innerHTML = '';
    for (const slot of this.cfg.slots) {
      this.slotsEl.appendChild(this._renderSlotRow(slot));
    }
    // Add-slot button.
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn--ghost btn--sm btn--full';
    addBtn.style.marginTop = '8px';
    addBtn.textContent = '+ Add slot';
    addBtn.title = 'Add a new soundtrack slot. Each slot holds one track or playlist; switching between slots crossfades.';
    addBtn.addEventListener('click', () => void this._addSlot());
    this.slotsEl.appendChild(addBtn);

    // Spotify status note (helpful when SDK won't play).
    if (isSpotifyEnabled()) {
      const needsReconnect =
        !isSpotifyConnected() ||
        this._spotifyAuthOk === false;
      const note = document.createElement('div');
      note.className = 'settings-stat-sub';
      note.style.marginTop = '4px';
      if (needsReconnect) {
        note.textContent = !isSpotifyConnected()
          ? 'Spotify enabled but not connected. '
          : 'Spotify session expired — reconnect to play. ';
        const reconnect = document.createElement('button');
        reconnect.type = 'button';
        reconnect.className = 'btn btn--ghost btn--sm';
        reconnect.textContent = 'Reconnect';
        reconnect.title = 'Open the Spotify authorisation page in this tab. You\'ll be brought back to Mappadux once approved.';
        reconnect.addEventListener('click', () => {
          void startConnect().catch((e) => {
            this._showError((e as Error).message ?? 'Spotify reconnect failed.');
          });
        });
        note.appendChild(reconnect);
        this.slotsEl.appendChild(note);
      } else {
        const p = getSpotifyProfile();
        if (p && p.product !== 'premium') {
          note.textContent = `Spotify connected as ${p.displayName} (${p.product}). Web Playback SDK requires a Premium account — free accounts can't play full tracks.`;
          this.slotsEl.appendChild(note);
        }
      }
    }
  }

  private _renderSlotRow(slot: SoundtrackSlot): HTMLElement {
    const row = document.createElement('div');
    row.className = 'soundtrack-slot';
    row.dataset['slotId'] = slot.id;
    const isActive = this.activeSlotId === slot.id;
    if (isActive) row.classList.add('is-active');
    const isSilent = slot.kind === 'silent';

    // Header — play button + label + (loop/shuffle icons) + remove.
    const header = document.createElement('div');
    header.className = 'soundtrack-slot-header';

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'btn btn--ghost btn--sm soundtrack-play-btn';
    playBtn.innerHTML = isActive
      ? '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>'
      : ICON_PLAY;
    playBtn.title = isActive
      ? 'Currently playing — click again to do nothing (use Silence to stop)'
      : 'Click to start this slot. Crossfades from whatever\'s playing now.';
    playBtn.disabled = !isSilent && !slot.track;
    playBtn.addEventListener('click', () => void this._selectSlot(slot.id));
    header.appendChild(playBtn);

    // v2.15.32 — Type indicator between play and label so the GM
    // can scan slot contents at a glance.
    const typeEl = document.createElement('span');
    typeEl.className = 'soundtrack-slot-type';
    if (isSilent) {
      typeEl.innerHTML = ICON_TYPE_SILENT;
      typeEl.title = 'Silence — selecting this fades the music out.';
    } else if (slot.track && _isPlaylistContent(slot.track)) {
      typeEl.innerHTML = ICON_TYPE_PLAYLIST;
      typeEl.title = 'Playlist / album — the engine iterates through tracks. Loop + Shuffle below control how.';
    } else if (slot.track) {
      typeEl.innerHTML = ICON_TYPE_TRACK;
      typeEl.title = 'Single track — plays once, then stops unless Loop is on.';
    } else {
      typeEl.innerHTML = ICON_TYPE_TRACK;
      typeEl.style.opacity = '0.3';
      typeEl.title = 'Empty slot — paste a YouTube or Spotify URL below to fill it.';
    }
    header.appendChild(typeEl);

    if (isSilent) {
      const labelEl = document.createElement('div');
      labelEl.className = 'soundtrack-slot-label';
      labelEl.textContent = slot.label;
      // v2.15.31 — Panel-scope explanation moves from a wordy intro
      // paragraph into a hover on the Silence row (the anchor that
      // every Soundtracks panel always has).
      labelEl.title =
        'Pack-level background music that persists across map switches. ' +
        'One slot plays at a time; switching slots crossfades. Selecting ' +
        'Silence fades the music out cleanly. Per-map sound effects still ' +
        'live on the Soundboard.';
      header.appendChild(labelEl);
    } else {
      const labelInput = document.createElement('input');
      labelInput.type = 'text';
      labelInput.value = slot.label;
      labelInput.className = 'soundtrack-slot-label-input';
      labelInput.title = 'Slot name — click to rename. Use anything that helps you remember what\'s in it.';
      labelInput.addEventListener('change', () => void this._updateSlot(slot.id, { label: labelInput.value.trim() || 'Slot' }));
      header.appendChild(labelInput);

      // v2.15.36 — Provider brand badge to the right of the name box.
      // Only meaningful when the slot has a track set.
      if (slot.track) {
        const provider = document.createElement('span');
        provider.className = 'soundtrack-provider-badge';
        provider.innerHTML = _providerIconFor(slot.track) ?? '';
        provider.title = slot.track.kind === 'vamper'
          ? 'Local song, played by Vamper. Other slots on the same song are passages of it: switching between them changes on the next bar.'
          : `Powered by ${_providerNameFor(slot.track)}. Sign in to ${_providerNameFor(slot.track)} (Premium) in another tab for ad-free playback.`;
        header.appendChild(provider);
      }

      // v2.15.37 — Delete button visible only when the slot is the
      // active one OR doesn't have a track yet (so the GM can
      // dispose of an empty slot they don't want, but can't
      // accidentally one-click-delete an inactive slot they've
      // configured). To delete a configured inactive slot: click
      // to make it active first, then click ×.
      if (isActive || !slot.track) {
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn--danger btn--sm';
        delBtn.textContent = '×';
        delBtn.title = 'Remove this slot. To change the track in a slot, delete + recreate.';
        delBtn.addEventListener('click', () => void this._removeSlot(slot.id));
        header.appendChild(delBtn);
      }
    }
    row.appendChild(header);

    if (isSilent) return row;

    // v2.15.37 — Body controls (transport, time-trim, volume,
    // now-playing) only render when the slot is ACTIVE. Inactive
    // populated slots collapse to just the header so the panel
    // stays compact and the GM sees the configured slots at a
    // glance. Empty slots show the URL input so they're still
    // fillable.
    if (!slot.track) {
      if (isYoutubeEnabled() || isSpotifyEnabled()) row.appendChild(this._renderUrlInput(slot));
      if (isLocalSongsEnabled()) row.appendChild(this._renderSongPicker(slot));
    } else if (isActive) {
      row.appendChild(this._renderControlsRow(slot, true));
      row.appendChild(this._renderNowPlaying(slot));
      if (!_isPlaylistContent(slot.track)) row.appendChild(this._renderTimeControls(slot));
      row.appendChild(this._renderVolume(slot));
    }
    return row;
  }

  /** Single horizontal row that combines:
   *   - Transport (prev / pause / next) when the slot is actively
   *     playing. Single tracks omit prev / next.
   *   - Loop + Shuffle icon toggles always (they apply to playback
   *     whether or not the slot is currently the active one).
   *  Shuffle only renders for playlist-style content. */
  private _renderControlsRow(slot: SoundtrackSlot, isActive: boolean): HTMLElement {
    const row = document.createElement('div');
    row.className = 'soundtrack-transport';
    const isPlaylist = !!slot.track && _isPlaylistContent(slot.track);
    if (isActive) {
      if (isPlaylist) {
        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'btn btn--ghost btn--sm';
        prevBtn.title = 'Previous track in this playlist. Click from the first track to restart from the beginning.';
        prevBtn.innerHTML = ICON_PREV;
        prevBtn.addEventListener('click', () => this._transportPrev());
        row.appendChild(prevBtn);
      }
      const pauseBtn = document.createElement('button');
      pauseBtn.type = 'button';
      pauseBtn.className = 'btn btn--ghost btn--sm';
      pauseBtn.title = this.isPaused
        ? 'Resume playback from where it paused'
        : 'Pause — keeps position; click again to resume from here';
      pauseBtn.innerHTML = this.isPaused ? ICON_PLAY : ICON_PAUSE;
      pauseBtn.addEventListener('click', () => this._transportTogglePause());
      row.appendChild(pauseBtn);
      if (isPlaylist) {
        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'btn btn--ghost btn--sm';
        nextBtn.title = 'Skip to the next track in this playlist';
        nextBtn.innerHTML = ICON_NEXT;
        nextBtn.addEventListener('click', () => this._transportNext());
        row.appendChild(nextBtn);
      }
    }
    // Loop + (Shuffle if playlist) + Restart/Resume toggle.
    row.appendChild(this._renderIconToggle({
      icon:    ICON_LOOP,
      title:   slot.loop
        ? (isPlaylist
            ? 'Loop is ON — the playlist will cycle back to the start when it ends. Click to turn off.'
            : 'Loop is ON — the track will replay (using Start/End trim) when it ends. Click to turn off.')
        : (isPlaylist
            ? 'Loop is OFF — playlist plays through once then stops. Click to enable looping.'
            : 'Loop is OFF — track plays once then stops. Click to enable looping.'),
      active:  !!slot.loop,
      onClick: () => void this._updateSlot(slot.id, { loop: !slot.loop }),
    }));
    if (isPlaylist) {
      const shuffleOn = slot.shuffle !== false;
      row.appendChild(this._renderIconToggle({
        icon:    ICON_SHUFFLE,
        title:   shuffleOn
          ? 'Shuffle is ON — tracks play in a random order. Click to play in playlist order.'
          : 'Shuffle is OFF — tracks play in playlist order. Click to randomise.',
        active:  shuffleOn,
        onClick: () => void this._updateSlot(slot.id, { shuffle: !shuffleOn }),
      }));
    }
    // v2.15.34 — Restart-vs-Resume toggle. Active state (accent
    // highlight) = Restart (always start at the slot's start
    // point); inactive = Resume (continue where it left off).
    // Local songs: a passage always starts at its Start bar (a loop
    // simply carries on), so Restart / Resume doesn't apply.
    if (slot.track?.kind === 'vamper') return row;
    const restartOn = _effectiveRestart(slot);
    row.appendChild(this._renderIconToggle({
      icon:    ICON_RESTART,
      title:   restartOn
        ? 'Restart on play — selecting this slot starts from the beginning (or from the Start trim) every time. Click for Resume mode.'
        : 'Resume on play — selecting this slot picks up where it left off. Click for Restart mode (always start from the beginning).',
      active:  restartOn,
      onClick: () => void this._updateSlot(slot.id, { restart: !restartOn }),
    }));
    return row;
  }

  private _renderIconToggle(opts: {
    icon: string;
    title: string;
    active: boolean;
    onClick: () => void;
  }): HTMLElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn btn--ghost btn--sm soundtrack-icon-toggle${opts.active ? ' is-active' : ''}`;
    btn.title = opts.title;
    btn.innerHTML = opts.icon;
    btn.addEventListener('click', opts.onClick);
    return btn;
  }

  private _renderNowPlaying(_slot: SoundtrackSlot): HTMLElement {
    const wrap = document.createElement('div');
    wrap.dataset['nowPlayingWrap'] = '1';
    const text = document.createElement('div');
    text.className = 'soundtrack-now-playing';
    text.textContent = '…';
    text.dataset['nowPlaying'] = '1';
    const track = document.createElement('div');
    track.className = 'sb-progress-track soundtrack-progress soundtrack-progress--clickable';
    track.dataset['nowPlayingProgress'] = '1';
    track.title = 'Playback progress. Click anywhere on the bar to jump to that point in the track.';
    track.addEventListener('click', (ev) => this._onProgressClick(ev, track));
    const fill = document.createElement('div');
    fill.className = 'sb-progress-fill';
    track.appendChild(fill);
    // v2.15.38 — Start / End tick marks on the timeline. Positions
    // are updated by the poll tick alongside the fill width. Hidden
    // until duration > 0 and the slot has a corresponding trim
    // value set.
    const startTick = document.createElement('div');
    startTick.className = 'soundtrack-progress-tick soundtrack-progress-tick--start';
    startTick.dataset['nowPlayingTickStart'] = '1';
    startTick.title = 'Start trim — playback begins here';
    startTick.hidden = true;
    const endTick = document.createElement('div');
    endTick.className = 'soundtrack-progress-tick soundtrack-progress-tick--end';
    endTick.dataset['nowPlayingTickEnd'] = '1';
    endTick.title = 'End trim — playback stops (or loops back to Start) here';
    endTick.hidden = true;
    track.append(startTick, endTick);
    wrap.append(text, track);
    return wrap;
  }

  /** v2.15.35 — Click anywhere on the progress bar to seek there.
   *  Power-user feature for auditioning start/end trim points
   *  alongside the click-to-grab-time inputs. */
  private _onProgressClick(ev: MouseEvent, trackEl: HTMLElement): void {
    const rect = trackEl.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    const { durationSec } = this._currentProgress();
    if (durationSec <= 0) return;
    const target = pct * durationSec;
    if (this.activeKind === 'vamper') { this.vamper?.seek(target); return; }
    if (this.activeKind === 'youtube' && this.ytPlayer) {
      this.ytPlayer.seekSec(target);
    } else if (this.activeKind === 'spotify' && this.spotifyPlayer) {
      void this.spotifyPlayer.seekMs(target * 1000);
    }
  }

  private _transportPrev(): void {
    // v2.15.41 — During a shuffle-stable resume the engine is in
    // single-video mode (not playlist mode), so previous() no-ops.
    // Fire the pending handoff so prev becomes "drop me into the
    // playlist and pick a track". For shuffled, the handoff jumps
    // to a random track; for sequenced, it goes to the next-in-line.
    if (this._ytHandoff && this._ytHandoff.slotId === this.activeSlotId && this.ytPlayer) {
      this._onTrackEnded();
      return;
    }
    if (this.activeKind === 'youtube' && this.ytPlayer) this.ytPlayer.previous();
    else if (this.activeKind === 'spotify' && this.spotifyPlayer) void this.spotifyPlayer.previous();
  }

  private _transportNext(): void {
    if (this._ytHandoff && this._ytHandoff.slotId === this.activeSlotId && this.ytPlayer) {
      this._onTrackEnded();
      return;
    }
    if (this.activeKind === 'youtube' && this.ytPlayer) this.ytPlayer.next();
    else if (this.activeKind === 'spotify' && this.spotifyPlayer) void this.spotifyPlayer.next();
  }

  private _transportTogglePause(): void {
    if (this.activeKind === 'vamper' && this.vamper) {
      if (this.isPaused) this.vamper.resume(); else this.vamper.pause();
      this.isPaused = !this.isPaused;
      this._renderSlots();
      return;
    }
    const p = this._activePlayer();
    if (!p) return;
    if (this.isPaused) {
      if (this.activeKind === 'spotify') void (p as SpotifySoundtrackPlayer).play();
      else                                (p as YouTubeSoundtrackPlayer).play();
      this.isPaused = false;
    } else {
      if (this.activeKind === 'spotify') void (p as SpotifySoundtrackPlayer).pause();
      else                                (p as YouTubeSoundtrackPlayer).pause();
      this.isPaused = true;
    }
    this._renderSlots();
  }

  /** Provider-aware placeholder so the input only mentions the
   *  enabled providers. */
  private _urlPlaceholder(): string {
    const yt = isYoutubeEnabled();
    const sp = isSpotifyEnabled();
    if (yt && sp) return 'Paste YouTube or Spotify URL';
    if (yt)       return 'Paste YouTube URL';
    if (sp)       return 'Paste Spotify URL';
    return 'No provider enabled — see Settings';
  }

  private _renderUrlInput(slot: SoundtrackSlot): HTMLElement {
    const row = document.createElement('div');
    row.className = 'soundtrack-add-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = this._urlPlaceholder();
    input.title = 'Paste a YouTube, YouTube Music, or Spotify URL. Single tracks AND playlists / albums are both accepted — the provider iterates a playlist for you.';
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'btn btn--ghost btn--sm';
    addBtn.textContent = 'Add';
    addBtn.title = 'Save this URL into the slot. To change later, delete the slot and create a new one.';
    const submit = (): void => {
      const t = parseSoundtrackUrl(input.value);
      if (!t) {
        this.statusEl.textContent = 'Couldn\'t parse a YouTube / Spotify URL from that input.';
        return;
      }
      if ((t.kind === 'youtube' || t.kind === 'youtube-playlist') && !isYoutubeEnabled()) {
        this.statusEl.textContent = 'YouTube is disabled — enable it in Settings → Soundtracks.';
        return;
      }
      if (t.kind === 'spotify' && !isSpotifyEnabled()) {
        this.statusEl.textContent = 'Spotify is disabled — enable it in Settings → Soundtracks.';
        return;
      }
      // Default shuffle ON for playlist content; off for single tracks.
      const shuffleDefault = _isPlaylistContent(t);
      void this._updateSlot(slot.id, _isPlaylistContent(t)
        ? { track: t, shuffle: shuffleDefault }
        : { track: t });
      this.statusEl.textContent = '';
    };
    addBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); submit(); } });
    row.append(input, addBtn);
    return row;
  }

  /** v2.20.0 — Fill an empty slot with a song from the audio library
   *  (or a file uploaded into it here), played by Vamper. Songs added
   *  here are ordinary library assets, so they travel in .mappadux
   *  packs with the slots that use them. */
  private _renderSongPicker(slot: SoundtrackSlot): HTMLElement {
    const row = document.createElement('div');
    row.className = 'soundtrack-add-row';
    const select = document.createElement('select');
    select.title = 'A song from your audio library, played by Vamper. Give several slots the same song and set each one\'s Start / End: switching between them changes the music on the next bar.';
    const placeholder = new Option('Local song…', '');
    placeholder.disabled = true;
    placeholder.selected = true;
    select.append(placeholder, new Option('Upload a song file…', '__upload'));
    void AudioAssetStore.getAll().then((assets) => {
      for (const a of assets) select.appendChild(new Option(a.name, a.id));
    });
    const file = document.createElement('input');
    file.type = 'file';
    file.accept = 'audio/*';
    file.hidden = true;
    const choose = (id: string, name: string): void => {
      void this._updateSlot(slot.id, {
        track: { kind: 'vamper', assetId: id, label: name },
        loop:  true,
      });
    };
    select.addEventListener('change', () => {
      if (select.value === '__upload') { select.value = ''; file.click(); return; }
      const opt = select.selectedOptions[0];
      if (select.value && opt) choose(select.value, opt.text);
    });
    file.addEventListener('change', () => {
      const f = file.files?.[0];
      if (!f) return;
      const asset: AudioAsset = {
        id:            generateId(),
        name:          f.name.replace(/\.[^.]+$/, ''),
        source:        'upload',
        locallyStored: true,
        license:       'Unknown / Manual import',
        addedAt:       Date.now(),
      };
      void AudioAssetStore.save(asset, f)
        .then(() => choose(asset.id, asset.name))
        .catch((e) => this._showError(`${f.name}: ${(e as Error).message}`));
    });
    row.append(select, file);
    return row;
  }

  private _renderTimeControls(slot: SoundtrackSlot): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'soundtrack-time-row';
    const mkInput = (label: string, key: 'startSec' | 'endSec'): HTMLElement => {
      // v2.15.45 — The grab-time hot zone is now the LABEL only, not
      // the input. Previously the click handler was on the input,
      // which meant clicking to type a value also grabbed the
      // playhead and overwrote what you were about to type. Now:
      //   - Click the "Start" / "End" label → grab the current
      //     playhead position into the field.
      //   - Click / focus the input → type freely.
      const cell = document.createElement('div');
      cell.className = 'soundtrack-time-cell';
      const grab = document.createElement('span');
      grab.className = 'soundtrack-time-grab';
      grab.textContent = label;
      grab.title = label === 'Start'
        ? 'Click while a track is playing to grab the current playhead position as the Start trim. Or type the value directly into the box.'
        : 'Click while a track is playing to grab the current playhead position as the End trim. Or type the value directly into the box. Leave blank to play to the natural end.';
      grab.addEventListener('click', () => {
        if (this.activeSlotId !== slot.id) return;
        const { positionSec } = this._currentProgress();
        if (positionSec <= 0) return;
        const rounded = Math.round(positionSec * 10) / 10;
        val.value = String(rounded);
        void this._updateSlot(slot.id, { [key]: rounded } as Partial<SoundtrackSlot>);
      });
      const val = document.createElement('input');
      val.type = 'number';
      val.min  = '0';
      val.step = '0.5';
      val.placeholder = label === 'Start' ? '0' : '(end)';
      val.title = label === 'Start'
        ? 'Start point in seconds — where the track begins each time you play this slot. Type a value, or click the "Start" label to grab the current playhead.'
        : 'End point in seconds — where the track stops (and loops back to Start if Loop is on). Type a value, or click the "End" label to grab the current playhead. Leave blank to play to the natural end.';
      const cur = slot[key];
      val.value = cur !== undefined ? String(cur) : '';
      val.addEventListener('change', () => {
        const num = parseFloat(val.value);
        const patch = Number.isFinite(num) && num >= 0
          ? ({ [key]: num } as Partial<SoundtrackSlot>)
          : ({ [key]: undefined } as unknown as Partial<SoundtrackSlot>);
        void this._updateSlot(slot.id, patch);
      });
      cell.append(grab, val);
      return cell;
    };
    wrap.append(mkInput('Start', 'startSec'), mkInput('End', 'endSec'));
    return wrap;
  }

  private _renderVolume(slot: SoundtrackSlot): HTMLElement {
    const row = document.createElement('div');
    row.className = 'soundtrack-volume-row';
    const label = document.createElement('span');
    label.className = 'settings-stat-sub';
    const initialVol = slot.volume ?? DEFAULT_VOLUME;
    label.textContent = `Vol ${initialVol}%`;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min  = '0';
    slider.max  = '100';
    slider.value = String(initialVol);
    slider.title = 'Volume for this slot (0-100%). Drag while playing for a live adjust. Overridden by the panel mute toggle in the header.';
    slider.addEventListener('input', () => {
      const v = parseInt(slider.value, 10);
      label.textContent = `Vol ${v}%`;
      // Live-drive the active player's volume if THIS slot is
      // playing AND the panel isn't muted. Muted state pins at 0.
      if (this.activeSlotId === slot.id && !this.isMuted && this.activeKind === 'vamper') {
        this.vamper?.setVolume(v, 50);
      } else if (this.activeSlotId === slot.id && !this.isMuted) {
        const player = this._activePlayer();
        if (player) {
          if (this.activeKind === 'spotify') void (player as SpotifySoundtrackPlayer).setVolume(v);
          else                                (player as YouTubeSoundtrackPlayer).setVolume(v);
        }
      }
    });
    slider.addEventListener('change', () => {
      const v = parseInt(slider.value, 10);
      void this._updateSlot(slot.id, { volume: v });
    });
    row.append(label, slider);
    return row;
  }

  // ─── Mutations ──────────────────────────────────────────────────────

  private async _addSlot(): Promise<void> {
    const slot = newUserSlot(`Slot ${this.cfg.slots.length}`);
    this.cfg = { ...this.cfg, slots: [...this.cfg.slots, slot] };
    await this.host.saveConfig(this.cfg);
    this._renderSlots();
  }

  private async _removeSlot(id: string): Promise<void> {
    if (this.activeSlotId === id) await this._selectSlot(this.cfg.slots[0]?.id ?? null);
    this.cfg = { ...this.cfg, slots: this.cfg.slots.filter((s) => s.id !== id) };
    await this.host.saveConfig(this.cfg);
    this._renderSlots();
  }

  private async _updateSlot(id: string, patch: Partial<SoundtrackSlot>): Promise<void> {
    this.cfg = {
      ...this.cfg,
      slots: this.cfg.slots.map((s) => s.id === id ? { ...s, ...patch } : s),
    };
    await this.host.saveConfig(this.cfg);
    // Local song: a new trim or Loop setting changes the cue, and the
    // playing passage picks it up on its next bar.
    if (this.activeKind === 'vamper' && this.vamper) {
      this.vamper.setCues(this.cfg.slots);
      if (id === this.activeSlotId) this.vamper.goTo(id);
    }
    this._renderSlots();
  }

  // ─── Playback ───────────────────────────────────────────────────────

  /** Crossfade from the currently-playing slot to `targetSlotId`.
   *  Silent target: fade current down + stop. Same-slot: no-op. */
  private async _selectSlot(targetSlotId: string | null): Promise<void> {
    if (targetSlotId === this.activeSlotId) return;
    const target = targetSlotId ? this.cfg.slots.find((s) => s.id === targetSlotId) : null;
    const crossfadeMs = this.cfg.crossfadeMs ?? 1500;

    // Cancel any in-flight crossfade.
    if (this.crossfadeTimer) { clearTimeout(this.crossfadeTimer); this.crossfadeTimer = null; }

    // v2.20.0 — Another passage of the song already playing: no
    // crossfade, Vamper changes on the next bar.
    if (this.activeKind === 'vamper' && this.vamper && target?.track?.kind === 'vamper'
        && target.track.assetId === this.vamper.loadedAssetId) {
      this.activeSlotId = target.id;
      this.isPaused     = false;
      this.vamper.goTo(target.id);
      this.vamper.setVolume(this.isMuted ? 0 : (target.volume ?? DEFAULT_VOLUME), 300);
      this._renderSlots();
      return;
    }
    if (this.activeKind === 'vamper' && this.vamper) {
      this.vamper.setVolume(0, crossfadeMs);
      await new Promise((r) => setTimeout(r, crossfadeMs));
      this.vamper.stop();
    }

    // v2.15.28 — Capture the current slot's playhead so switching
    // back resumes from where we left off. Only captures if there
    // IS an active slot with an engine running.
    if (this.activeKind && this.activeSlotId && this._activePlayer()) {
      const state = this._captureResumeState();
      if (state) this.resumeStates.set(this.activeSlotId, state);
    }

    // Fade current down (if anything is playing).
    if (this.activeKind && this.activeKind !== 'vamper' && this._activePlayer()) {
      await this._fade(this.activeKind, this._currentVolume(), 0, crossfadeMs);
      try {
        const p = this._activePlayer();
        if (this.activeKind === 'spotify') await (p as SpotifySoundtrackPlayer).stop();
        else                                (p as YouTubeSoundtrackPlayer).stop();
      } catch { /* nothing */ }
    }

    this.activeSlotId = targetSlotId;
    this.activeKind   = null;
    this.isPaused     = false;
    // Fresh slot = fresh skip counter; any previous run-of-bad-tracks
    // is unrelated.
    this._consecutiveSkips = 0;
    this._endTrimFired = false;
    // Any pending playlist handoff belonged to the slot we just left.
    this._ytHandoff = null;

    if (!target || target.kind === 'silent' || !target.track) {
      this._stopNowPlayingPoll();
      this._renderSlots();
      return;
    }

    // Surface any engine-start failure (timeout loading player,
    // missing auth, etc.) in the status line instead of letting
    // the void caller swallow it.
    try {
      await this._playSlotTrack(target, crossfadeMs);
      this._startNowPlayingPoll();
    } catch (e) {
      this._showError((e as Error).message ?? 'Couldn\'t start playback.');
      this.activeSlotId = null;
      this.activeKind   = null;
    }
    this._renderSlots();
  }

  private _startNowPlayingPoll(): void {
    this._stopNowPlayingPoll();
    const tick = (): void => {
      // Update title text.
      const np = this.activeKind === 'youtube'
        ? this.ytPlayer?.getNowPlaying()
        : this.activeKind === 'spotify'
          ? this.spotifyPlayer?.getNowPlaying()
          : this.activeKind === 'vamper' && this.vamper
            ? { title: this.vamper.nowPlaying() }
            : null;
      const el = this.slotsEl.querySelector<HTMLElement>('[data-now-playing="1"]');
      if (el) {
        el.textContent = np?.title
          ? ('author' in np && np.author ? `${np.title} — ${np.author}` : np.title)
          : '…';
      }
      // Update progress fill width + start/end tick positions.
      const progressTrack = this.slotsEl.querySelector<HTMLElement>('[data-now-playing-progress="1"]');
      const slot = this.cfg.slots.find((s) => s.id === this.activeSlotId);
      if (progressTrack && slot) {
        const fill = progressTrack.querySelector<HTMLElement>('.sb-progress-fill');
        const { positionSec, durationSec } = this._currentProgress();
        const pct = durationSec > 0 ? Math.min(100, (positionSec / durationSec) * 100) : 0;
        if (fill) fill.style.width = `${pct}%`;
        progressTrack.hidden = durationSec <= 0;
        // Tick marks — only meaningful for single-track slots.
        const tickStartEl = progressTrack.querySelector<HTMLElement>('[data-now-playing-tick-start="1"]');
        const tickEndEl   = progressTrack.querySelector<HTMLElement>('[data-now-playing-tick-end="1"]');
        const showTicks   = durationSec > 0 && !!slot.track && !_isPlaylistContent(slot.track);
        if (tickStartEl) {
          const s = slot.startSec;
          if (showTicks && s !== undefined && s > 0 && s < durationSec) {
            tickStartEl.hidden = false;
            tickStartEl.style.left = `${(s / durationSec) * 100}%`;
          } else {
            tickStartEl.hidden = true;
          }
        }
        if (tickEndEl) {
          const e = slot.endSec;
          if (showTicks && e !== undefined && e > 0 && e < durationSec) {
            tickEndEl.hidden = false;
            tickEndEl.style.left = `${(e / durationSec) * 100}%`;
          } else {
            tickEndEl.hidden = true;
          }
        }
        // v2.15.38 — Enforce slot.endSec. Neither YT nor Spotify
        // SDK have native "stop at X" so we poll-watch the playhead
        // and intervene. Only meaningful for single-track slots.
        // The suppression latch prevents re-firing during the
        // brief reload window after _onTrackEnded triggers a loop
        // or restart; it clears once position has dropped back
        // below endSec (the seek-to-startSec brings it down).
        // Local songs: Vamper loops / plays on itself; a "once" passage
        // that reaches the end of the song stops, and we fall to Silence.
        if (this.activeKind === 'vamper') {
          const st = this.vamper?.state();
          if (st && !st.playing && !this.isPaused) this._onTrackEnded();
        } else if (showTicks && slot.endSec !== undefined && slot.endSec > 0) {
          if (this._endTrimFired) {
            if (positionSec < slot.endSec - 1) this._endTrimFired = false;
          } else if (positionSec >= slot.endSec - 0.25) {
            this._endTrimFired = true;
            this._onTrackEnded();
          }
        }
      }
    };
    tick();
    this.nowPlayingTimer = setInterval(tick, 500);
  }

  private _currentProgress(): { positionSec: number; durationSec: number } {
    if (this.activeKind === 'vamper' && this.vamper) {
      return { positionSec: this.vamper.state()?.position ?? 0, durationSec: this.vamper.durationSec };
    }
    if (this.activeKind === 'youtube' && this.ytPlayer) {
      return {
        positionSec: this.ytPlayer.getCurrentTime(),
        durationSec: this.ytPlayer.getDuration(),
      };
    }
    if (this.activeKind === 'spotify' && this.spotifyPlayer) {
      return {
        positionSec: this.spotifyPlayer.getPositionMs() / 1000,
        durationSec: this.spotifyPlayer.getDurationMs() / 1000,
      };
    }
    return { positionSec: 0, durationSec: 0 };
  }

  private _stopNowPlayingPoll(): void {
    if (this.nowPlayingTimer) {
      clearInterval(this.nowPlayingTimer);
      this.nowPlayingTimer = null;
    }
  }

  /** Play the slot's single track / playlist. Volume starts at 0
   *  and ramps to `slot.volume` via the crossfade helper so the
   *  switch from the previous slot is smooth. */
  private async _playSlotTrack(slot: SoundtrackSlot, crossfadeMs: number): Promise<void> {
    const track = slot.track;
    if (!track) return;
    // v2.15.27 — Respect the panel-level mute. When muted we still
    // load + play the track (so the engine state stays correct);
    // we just don't ramp the volume up. Toggling mute off later
    // applies the proper level via _applyMute.
    const targetVolume    = this.isMuted ? 0 : (slot.volume ?? DEFAULT_VOLUME);
    const playlistContent = _isPlaylistContent(track);
    const loop            = !!slot.loop;
    const shuffle         = slot.shuffle !== false;  // default true

    // v2.15.34 — Restart mode skips the saved resume state for
    // this slot. Single-track Restart still honours slot.startSec
    // (which may be > 0) — that's the configured trim point, not a
    // literal zero — because the load path falls through to
    // slot.startSec when no resume position is supplied.
    if (track.kind === 'vamper') {
      this.vamper ??= new VamperSongPlayer();
      const v = this.vamper;
      try {
        await v.load(track.assetId, (text) => { this.statusEl.textContent = text; });
      } finally {
        this.statusEl.textContent = '';
      }
      // The GM may have picked another slot while the song was analysed.
      if (this.activeSlotId !== slot.id) return;
      v.setCues(this.cfg.slots);
      v.setVolume(0);
      v.goTo(slot.id);
      this.activeKind = 'vamper';
      v.setVolume(targetVolume, crossfadeMs);
      return;
    }
    const useResume = !_effectiveRestart(slot);
    const resume = useResume ? this.resumeStates.get(slot.id) : undefined;
    if (track.kind === 'youtube') {
      const isFirst = !this.ytPlayer;
      const p = await this._ensureYouTubePlayer(isFirst ? { videoId: track.videoId } : undefined);
      const startSeconds = resume?.positionSec ?? slot.startSec;
      if (!isFirst) {
        p.load(track.videoId, {
          autoplay: true,
          volume:   0,
          ...(startSeconds ? { startSeconds } : {}),
        });
      } else if (startSeconds) {
        // Player came up with the videoId queued; reload with the
        // saved position to seek there.
        p.load(track.videoId, { autoplay: true, volume: 0, startSeconds });
      } else {
        p.setVolume(0); p.play();
      }
      this.activeKind = 'youtube';
    } else if (track.kind === 'youtube-playlist') {
      const isFirst = !this.ytPlayer;
      // v2.15.39 — Shuffle-stable resume. If we captured a specific
      // videoId on switch-away, play THAT exact track first (single-
      // video load), then hand off to the playlist on ENDED. This
      // beats relying on playlistIndex which YT re-randomises every
      // time a shuffled playlist is loaded. Same Spotify approach
      // below uses { context_uri, offset } to achieve this natively.
      const useSpecificTrack = !!resume?.youtubeVideoId && !!resume?.positionSec && resume.positionSec > 0;
      if (useSpecificTrack) {
        const p = await this._ensureYouTubePlayer(isFirst ? { videoId: resume!.youtubeVideoId! } : undefined);
        const startSeconds = resume!.positionSec;
        if (!isFirst) {
          p.load(resume!.youtubeVideoId!, { autoplay: true, volume: 0, startSeconds });
        } else {
          // Player came up with the videoId already queued; reload
          // with startSeconds to seek there.
          p.load(resume!.youtubeVideoId!, { autoplay: true, volume: 0, startSeconds });
        }
        // Queue the playlist-handoff so the next ENDED kicks the
        // shuffled / sequenced playlist into life.
        this._ytHandoff = {
          slotId:     slot.id,
          listId:     track.listId,
          loop,
          shuffle:    playlistContent && shuffle,
          startIndex: (resume!.playlistIndex ?? -1) + 1,
          volume:     targetVolume,
        };
        this.activeKind = 'youtube';
      } else {
        const p = await this._ensureYouTubePlayer(isFirst ? { listId: track.listId } : undefined);
        const wantShuffle = playlistContent && shuffle;
        const playlistOpts: Parameters<typeof p.loadPlaylist>[1] = {
          autoplay: true,
          volume:   0,
          loop,
          shuffle:  wantShuffle,
          // v2.15.41 — fresh shuffled playlist also needs randomStart
          // so the first track isn't always track 0 of the ordered
          // list. The wrapper's cue+shuffle+jump-to-random flow does
          // the right thing. Only applies when there's no resume —
          // resume goes via the specific-track / handoff path above.
          ...(wantShuffle && resume?.playlistIndex === undefined ? { randomStart: true } : {}),
        };
        if (resume?.playlistIndex !== undefined) playlistOpts.index = resume.playlistIndex;
        if (resume?.positionSec)                 playlistOpts.startSeconds = resume.positionSec;
        p.loadPlaylist(track.listId, playlistOpts);
        this._ytHandoff = null;
        this.activeKind = 'youtube';
      }
    } else {
      const p = await this._ensureSpotifyPlayer();
      // Resume position priority: per-slot resume > slot.startSec.
      const positionMs = resume?.positionSec
        ? Math.floor(resume.positionSec * 1000)
        : (slot.startSec ? Math.floor(slot.startSec * 1000) : 0);
      // v2.15.39 — Spotify shuffle-stable resume. For playlist-kind
      // tracks pass offsetTrackUri so the context starts AT the
      // captured track; the rest of the playlist continues after it
      // ends, honouring whatever shuffle state we set on play.
      const loadOpts: Parameters<typeof p.load>[1] = {
        autoplay: true,
        volume:   0,
        repeat:   loop,
        shuffle:  playlistContent && shuffle,
        ...(positionMs ? { positionMs } : {}),
      };
      if (playlistContent && resume?.spotifyTrackUri) {
        loadOpts.offsetTrackUri = resume.spotifyTrackUri;
      }
      await p.load(track.trackUri, loadOpts);
      this.activeKind = 'spotify';
    }
    // Resume consumed — clear so the NEXT switch-away captures fresh.
    this.resumeStates.delete(slot.id);
    await this._fade(this.activeKind, 0, targetVolume, crossfadeMs);
  }

  /** Volume ramp on the named engine. Returns when the fade is done
   *  (or has been cancelled by a newer _selectSlot). */
  private async _fade(kind: 'youtube' | 'spotify', from: number, to: number, durationMs: number): Promise<void> {
    if (durationMs <= 0) {
      // v2.15.40 — Single-track loop calls _playSlotTrack with
      // crossfadeMs=0 to retrigger the same track instantly. Without
      // this branch the load (which starts at volume 0) never ramps
      // up, so the second + subsequent loops are silent. Snap to
      // target instead.
      const p = kind === 'youtube' ? this.ytPlayer : this.spotifyPlayer;
      if (p) {
        if (kind === 'spotify') void (p as SpotifySoundtrackPlayer).setVolume(to);
        else                     (p as YouTubeSoundtrackPlayer).setVolume(to);
      }
      void from;
      return;
    }
    const stepMs = Math.max(20, Math.floor(durationMs / CROSSFADE_STEPS));
    const steps  = Math.max(1, Math.floor(durationMs / stepMs));
    return new Promise((resolve) => {
      let i = 0;
      const tick = (): void => {
        i++;
        const t = Math.min(1, i / steps);
        const v = from + (to - from) * t;
        const p = kind === 'youtube' ? this.ytPlayer : this.spotifyPlayer;
        if (p) {
          if (kind === 'spotify') void (p as SpotifySoundtrackPlayer).setVolume(v);
          else                    (p as YouTubeSoundtrackPlayer).setVolume(v);
        }
        if (i >= steps) { this.crossfadeTimer = null; resolve(); }
        else            { this.crossfadeTimer = setTimeout(tick, stepMs); }
      };
      this.crossfadeTimer = setTimeout(tick, stepMs);
    });
  }

  private _currentVolume(): number {
    const slot = this.cfg.slots.find((s) => s.id === this.activeSlotId);
    return slot?.volume ?? DEFAULT_VOLUME;
  }

  private _activePlayer(): YouTubeSoundtrackPlayer | SpotifySoundtrackPlayer | null {
    if (this.activeKind === 'youtube') return this.ytPlayer;
    if (this.activeKind === 'spotify') return this.spotifyPlayer;
    return null;
  }

  private async _ensureYouTubePlayer(initial?: { videoId?: string; listId?: string }): Promise<YouTubeSoundtrackPlayer> {
    if (this.ytPlayer) return this.ytPlayer;
    this.statusEl.textContent = 'Loading YouTube player…';
    this.ytPlayer = await createYouTubePlayer(initial);
    this.statusEl.textContent = '';
    this.ytPlayer.onStateChange((s) => {
      if (s === YT_STATE.ENDED)   this._onTrackEnded();
      // Successful PLAYING means we're past any earlier skip
      // chain; reset the safety counter.
      if (s === YT_STATE.PLAYING) {
        this._consecutiveSkips = 0;
        // v2.15.46 — Mirror external transport state (BT remote, OS
        // media keys, lock screen, etc.) into the panel's pause
        // icon so the GM can resume from our UI without it being
        // out of sync with what the speaker actually did.
        if (this.isPaused) { this.isPaused = false; this._renderSlots(); }
      }
      if (s === YT_STATE.PAUSED) {
        if (!this.isPaused) { this.isPaused = true; this._renderSlots(); }
      }
    });
    this.ytPlayer.onError((code, message) => this._onYouTubeError(code, message));
    return this.ytPlayer;
  }

  /** v2.15.32 — Auto-skip unembeddable tracks within a playlist.
   *  v2.15.33 — Capped at 3 consecutive skips: if four in a row
   *  fail we assume the whole playlist is broken (private, region-
   *  locked, all removed) and bail out with a clear error so we
   *  don't spin forever. The counter resets to 0 the moment YT
   *  reports PLAYING (= a track successfully started). */
  private _onYouTubeError(code: number, message: string): void {
    const slot = this.cfg.slots.find((s) => s.id === this.activeSlotId);
    const inPlaylist = !!slot?.track && _isPlaylistContent(slot.track);
    if (inPlaylist && (code === 100 || code === 101 || code === 150)) {
      this._consecutiveSkips++;
      if (this._consecutiveSkips > 3) {
        this._showError('Three tracks in a row couldn\'t play — stopping. The playlist may be private, region-locked, or contain only unembeddable items.');
        void this._selectSlot(this.cfg.slots[0]?.id ?? null);  // back to Silence
        this._consecutiveSkips = 0;
        return;
      }
      this._showError(`Skipping unplayable track (${this._consecutiveSkips}/3)…`);
      try { this.ytPlayer?.next(); } catch { /* nothing */ }
      return;
    }
    this._showError(message);
  }

  private async _ensureSpotifyPlayer(): Promise<SpotifySoundtrackPlayer> {
    if (this.spotifyPlayer) return this.spotifyPlayer;
    if (!isSpotifyConnected()) {
      throw new Error('Spotify not connected. Settings → Soundtracks → Connect Spotify.');
    }
    // v2.15.42 — Probe the access-token path before standing up the
    // SDK. If the refresh token is dead the SDK would otherwise spin
    // on the OAuth callback forever (we silently don't call cb).
    // Surfacing it here lets the inline Reconnect button do the work.
    const tok = await getAccessToken();
    if (!tok) {
      this._spotifyAuthOk = false;
      this._renderSlots();
      throw new Error('Spotify session expired. Click Reconnect in the Soundtracks panel.');
    }
    this._spotifyAuthOk = true;
    this.statusEl.textContent = 'Loading Spotify player…';
    this.spotifyPlayer = await createSpotifyPlayer();
    this.statusEl.textContent = '';
    this.spotifyPlayer.onEnded(() => this._onTrackEnded());
    // v2.15.46 — Mirror external pause/resume (BT remote, lock
    // screen, media keys, native Spotify app) into our UI state.
    this.spotifyPlayer.onPaused((paused) => {
      if (this.isPaused !== paused) { this.isPaused = paused; this._renderSlots(); }
    });
    this.spotifyPlayer.onError((_kind, message) => this._showError(message));
    return this.spotifyPlayer;
  }

  /** Surface a player error in the status line + give the engine a
   *  beat to recover. Errors from YT IFrame or the Spotify SDK both
   *  funnel through here so the user sees one consistent place for
   *  troubleshooting hints. Clears after 8 s so it doesn't linger. */
  private _showError(message: string): void {
    this.statusEl.textContent = message;
    this.statusEl.classList.add('soundtrack-status--error');
    setTimeout(() => {
      if (this.statusEl.textContent === message) {
        this.statusEl.textContent = '';
        this.statusEl.classList.remove('soundtrack-status--error');
      }
    }, 8000);
  }

  /** Track / playlist ended. For playlist content with loop=true,
   *  the engine cycles internally so we never hit this. For
   *  single-track loop, we restart. Otherwise we fall to silent. */
  private _onTrackEnded(): void {
    const slot = this.cfg.slots.find((s) => s.id === this.activeSlotId);
    if (!slot || !slot.track) return;
    const crossfadeMs = this.cfg.crossfadeMs ?? 1500;
    const playlistContent = _isPlaylistContent(slot.track);
    // v2.15.39 — Shuffle-stable playlist resume: a single-track YT
    // load played as the resume head-start. Now hand off to the
    // playlist so the rest of the slot's iteration carries on
    // (re-randomising under shuffle is exactly what we want — the
    // user got back the SPECIFIC track they left on, and the
    // playlist continues with a fresh random tail).
    if (this._ytHandoff && this._ytHandoff.slotId === this.activeSlotId && this.ytPlayer) {
      const h = this._ytHandoff;
      this._ytHandoff = null;
      this.ytPlayer.loadPlaylist(h.listId, {
        autoplay: true,
        volume:   h.volume,
        loop:     h.loop,
        shuffle:  h.shuffle,
        // For unshuffled playlists, start at the next track in
        // sequence. Shuffled playlists ignore index — they cue +
        // shuffle + jump to a random track via randomStart, which
        // avoids audibly starting from track 0 of the ordered list.
        ...(h.shuffle
          ? { randomStart: true }
          : { index: Math.max(0, h.startIndex) }),
      });
      this._endTrimFired = false;
      return;
    }
    if (slot.track.kind === 'vamper') {
      void this._selectSlot(this.cfg.slots[0]?.id ?? null);
      return;
    }
    if (!playlistContent && slot.loop) {
      // Single track + loop → replay (respects startSec on Spotify).
      void this._playSlotTrack(slot, 0);
      return;
    }
    // Anything else: stop, fall back to silent anchor.
    void this._selectSlot(this.cfg.slots[0]?.id ?? null);
    void crossfadeMs;
  }

  private _teardownAllPlayers(): void {
    this._stopNowPlayingPoll();
    if (this.ytPlayer)      { try { this.ytPlayer.destroy(); }      catch { /* nothing */ } this.ytPlayer = null; }
    if (this.spotifyPlayer) { try { this.spotifyPlayer.destroy(); } catch { /* nothing */ } this.spotifyPlayer = null; }
    if (this.vamper)        { this.vamper.dispose(); this.vamper = null; }
    this.activeKind   = null;
    this.activeSlotId = null;
    this.isPaused     = false;
  }
}
