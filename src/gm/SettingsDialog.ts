import {
  getStoredApiKeys,
  deleteApiKey,
  deleteAllApiKeys,
  isVideoCap1080Enabled,
  setVideoCap1080Enabled,
  isLocalPlayerStaticOnly,
  setLocalPlayerStaticOnly,
  isScaledViewTransitionsEnabled,
  setScaledViewTransitionsEnabled,
  getMeasureUnitValue,
  setMeasureUnitValue,
  getMeasureUnitSuffix,
  setMeasureUnitSuffix,
  getUiScale,
  setUiScale,
  applyUiScale,
  UI_SCALE_MIN,
  UI_SCALE_MAX,
  UI_SCALE_DEFAULT,
  arePingsEnabled,
  areDiceEnabled,
  setDiceEnabled,
  getDiceRenderPreference,
  setDiceRenderPreference,
  setPingsEnabled,
  getInitiativeSortDirection,
  setInitiativeSortDirection,
  isInitiativeAnonymised,
  setInitiativeAnonymised,
  isMessagingEnabled,
  setMessagingEnabled,
  arePlayerMarkersMovable,
  setPlayerMarkersMovable,
  showFullPlayerUiInPreview,
  setShowFullPlayerUiInPreview,
  getLLMSettings,
  setLLMSettings,
  getLLMApiKey,
  setLLMApiKey,
  DEFAULT_GM_ASSISTANT_PROMPT,
  type LLMSettings,
  type StoredApiKey,
} from '../storage/localSettings.ts';
import {
  getWledEndpoints,
  addWledEndpoint,
  removeWledEndpoint,
  getHaConfig,
  setHaConfig,
  getQlcConfig,
  setQlcConfig,
  isYoutubeEnabled,
  setYoutubeEnabled,
  isSpotifyEnabled,
  setSpotifyEnabled,
} from '../stagecraft/stagecraftStorage.ts';
import { loadStoredIce, saveStoredIce, parseIceText, iceToText } from '../p2p/iceConfig.ts';
import { getSseOrigin, setSseOrigin, SSE_ORIGIN_DEFAULT } from '../storage/localSettings.ts';
import { buildDiceSettings, type DiceSettingsOptions } from './DiceSettings.ts';
import { fetchInfo as fetchWledInfo, normaliseEndpoint } from '../stagecraft/wledClient.ts';
import { fetchInfo as fetchQlcInfo, normaliseQlcEndpoint } from '../stagecraft/qlcClient.ts';
import { wledConfigUrl, haConfigUrl, qlcConfigUrl } from '../stagecraft/configUrls.ts';
import {
  getSpotifyClientId,
  setSpotifyClientId,
  getSpotifyProfile,
  isSpotifyConnected,
  clearSpotifyAuth,
  startConnect as startSpotifyConnect,
  getRedirectUri as spotifyRedirectUri,
} from '../stagecraft/spotifyAuth.ts';
import {
  isInProgressEnabled,
  setInProgressEnabled,
  inProgressFlagOrigin,
} from '../storage/featureFlags.ts';
import { generateId } from '../utils/id.ts';
import { LLMClient } from '../ai/LLMClient.ts';

/**
 * Settings dialog. Houses:
 *   • Storage — IndexedDB usage / quota readout, persistence request.
 *   • API Keys — list of stored browser credentials with bulk delete.
 *   • Danger Zone — Delete DB (keep settings) / Delete All Data (wipe).
 *
 * Reads everything live each time it opens — there's nothing persisted by
 * the dialog itself. Destructive actions are handled by the caller via the
 * callbacks; the dialog just confirms intent.
 */
export interface SettingsDialogCallbacks {
  onDeleteDb:        () => Promise<void> | void;
  onDeleteAllData:   () => Promise<void> | void;
  /** v2.19.7 — the dice set, permission or policy changed in here. Viewers
   *  need telling straight away: a GM editing the set mid-session expects it
   *  on the players' trays before they close the dialog. */
  onDiceChanged?:    () => void;
  /** v2.19.8 — pairing physical dice is setup, so it belongs in here too. */
  pixels?:           DiceSettingsOptions['pixels'];
}

export class SettingsDialog {
  private overlay: HTMLElement | null = null;
  private resolver: (() => void) | null = null;
  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this._resolve();
  };

  open(cb: SettingsDialogCallbacks): Promise<void> {
    this._onDiceChanged = cb.onDiceChanged;
    this._pixels = cb.pixels;
    this.overlay = this._build(cb);
    document.body.appendChild(this.overlay);
    document.addEventListener('keydown', this.onKey);
    return new Promise((resolve) => { this.resolver = resolve; });
  }

  private _resolve(): void {
    if (this.overlay) this.overlay.remove();
    this.overlay = null;
    document.removeEventListener('keydown', this.onKey);
    this.resolver?.();
    this.resolver = null;
  }

  private _build(cb: SettingsDialogCallbacks): HTMLElement {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    // Click-outside-to-dismiss intentionally disabled — use Close / × / Escape.

    const dialog = document.createElement('div');
    dialog.className = 'modal-dialog';
    // v2.15.44 — Widen by 50% (560 → 840) so the longer Stagecraft /
    // Soundtracks sections don't squash. Width still clamped to
    // 95vw on narrow viewports via the .modal-dialog base rule.
    dialog.style.width = '840px';
    overlay.appendChild(dialog);

    const header = document.createElement('div');
    header.className = 'modal-header';
    const title = document.createElement('span');
    title.className = 'modal-title';
    title.textContent = 'Settings';
    header.appendChild(title);
    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'modal-close';
    closeX.textContent = '×';
    closeX.addEventListener('click', () => this._resolve());
    header.appendChild(closeX);
    dialog.appendChild(header);

    const body = document.createElement('div');
    body.className = 'settings-body';
    dialog.appendChild(body);

    // ── Storage section ──────────────────────────────────────────────────
    body.appendChild(this._buildStorageSection());
    // ── Display section ──────────────────────────────────────────────────
    body.appendChild(this._buildDisplaySection());
    // ── Scaled View section ──────────────────────────────────────────────
    body.appendChild(this._buildScaledViewSection());
    // ── Performance section ──────────────────────────────────────────────
    body.appendChild(this._buildPerformanceSection());
    // ── Soundtracks — pack-level background music ──────────────────────
    // v2.15.43 — Promoted out of the in-progress gate. The YouTube
    // and Spotify paths have matured enough to ship; Lighting +
    // Automation remain gated below.
    body.appendChild(this._buildSoundtracksSection());
    // ── v2.16 in-progress features (Stagecraft Lighting + Automation) ─
    // Hidden by default on production; the Danger Zone has a toggle
    // to reveal them so curious users can opt in. Existing users
    // who've configured these features keep using them — only the
    // initial configuration UI is gated by the flag.
    if (isInProgressEnabled()) {
      body.appendChild(this._buildStagecraftSection());
    }
    // ── Player Permissions / Game System / Reply Assistant ───────────────
    // v2.16.109 — split the old "Player Voice" section into three focused
    // ones so each reads on its own.
    body.appendChild(this._buildDiceSection());
    body.appendChild(this._buildPlayerPermissionsSection());
    body.appendChild(this._buildGameSystemSection());
    body.appendChild(this._buildReplyAssistantSection());
    // ── v2.18 Connections: remote relay + Star System Explorer origin ─────
    body.appendChild(this._buildConnectionsSection());
    // ── API Keys section ─────────────────────────────────────────────────
    body.appendChild(this._buildApiKeysSection());
    // ── Danger Zone ──────────────────────────────────────────────────────
    body.appendChild(this._buildDangerZone(cb));

    // Footer — single Close button
    const footer = document.createElement('div');
    footer.className = 'about-actions';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn btn--ghost';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => this._resolve());
    footer.appendChild(closeBtn);
    dialog.appendChild(footer);

    return overlay;
  }

  // ─── Storage ────────────────────────────────────────────────────────────

  private _buildStorageSection(): HTMLElement {
    const sec = mkSection('Storage', 'How much of your browser’s allowance Mappadux is using. The quota is set by the browser — you can’t override it, but you can ask for persistence so the browser doesn’t evict your data under pressure.', { open: true });

    const usageLine = document.createElement('div');
    usageLine.className = 'settings-stat';
    usageLine.textContent = 'Reading…';
    sec.appendChild(usageLine);

    const persistLine = document.createElement('div');
    persistLine.className = 'settings-stat';
    persistLine.textContent = 'Persistence: …';
    sec.appendChild(persistLine);

    const btnRow = document.createElement('div');
    btnRow.className = 'settings-btn-row';
    const persistBtn = document.createElement('button');
    persistBtn.type = 'button';
    persistBtn.className = 'btn btn--ghost btn--sm';
    persistBtn.textContent = 'Request persistent storage';
    persistBtn.addEventListener('click', async () => {
      if (!navigator.storage?.persist) {
        persistLine.textContent = 'Persistence: not supported in this browser.';
        return;
      }
      const ok = await navigator.storage.persist();
      persistLine.textContent = ok
        ? 'Persistence: enabled. Mappadux data is protected from eviction.'
        : 'Persistence: not granted. Try again after user activity, or rely on the standard quota.';
      persistBtn.hidden = ok;
    });
    btnRow.appendChild(persistBtn);
    sec.appendChild(btnRow);

    // Populate async — estimate + persisted are both Promises.
    void this._refreshStorageStats(usageLine, persistLine, persistBtn);

    return sec;
  }

  private async _refreshStorageStats(
    usageLine: HTMLElement,
    persistLine: HTMLElement,
    persistBtn: HTMLButtonElement,
  ): Promise<void> {
    if (navigator.storage?.estimate) {
      try {
        const est = await navigator.storage.estimate();
        const usage = est.usage ?? 0;
        const quota = est.quota ?? 0;
        const pct   = quota > 0 ? (usage / quota * 100).toFixed(1) : '?';
        usageLine.innerHTML = `Using <strong>${formatBytes(usage)}</strong> of <strong>${formatBytes(quota)}</strong> (${pct}%)`;
      } catch {
        usageLine.textContent = 'Storage usage unavailable in this browser.';
      }
    } else {
      usageLine.textContent = 'Storage usage unavailable in this browser.';
    }

    if (navigator.storage?.persisted) {
      try {
        const persisted = await navigator.storage.persisted();
        persistLine.textContent = persisted
          ? 'Persistence: enabled. Mappadux data is protected from eviction.'
          : 'Persistence: not granted. The browser may evict data if it runs low on space.';
        persistBtn.hidden = persisted;
      } catch {
        persistLine.textContent = 'Persistence: status unavailable.';
      }
    } else {
      persistLine.textContent = 'Persistence: not supported in this browser.';
      persistBtn.hidden = true;
    }
  }

  // ─── API Keys ───────────────────────────────────────────────────────────

  private _buildApiKeysSection(): HTMLElement {
    const sec = mkSection('API Keys (this browser only)', 'Credentials stored locally for external services. These never leave this browser — not even inside Map Pack exports.');

    const keys = getStoredApiKeys();
    if (keys.length === 0) {
      const none = document.createElement('div');
      none.className = 'settings-stat';
      none.style.fontStyle = 'italic';
      none.textContent = 'No API keys stored.';
      sec.appendChild(none);
    } else {
      // v2.15.51 — Each row now carries its own Delete button on
      // the right so the list scales as more service keys land
      // (Spotify, future Syrinscape, etc.). The bulk "Delete all"
      // stays underneath but only when there's more than one key.
      const list = document.createElement('ul');
      list.className = 'settings-key-list';
      const rerender = (): void => {
        const next = this._buildApiKeysSection();
        sec.replaceWith(next);
      };
      for (const k of keys) {
        const li = document.createElement('li');
        const label = document.createElement('span');
        label.className = 'settings-key-label';
        label.textContent = k.label;
        const preview = document.createElement('span');
        preview.className = 'settings-key-preview';
        preview.textContent = k.preview;
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'btn btn--danger btn--sm settings-key-del';
        del.textContent = 'Delete';
        del.title = `Remove the ${k.label} from this browser. External services using it will stop working until you re-enter the key.`;
        del.addEventListener('click', () => {
          const ok = confirm(
            `Delete the ${k.label}?\n\n` +
            `Anything that uses it will stop working until you re-enter it.`,
          );
          if (!ok) return;
          deleteApiKey(k.key);
          rerender();
        });
        li.append(label, preview, del);
        list.appendChild(li);
      }
      sec.appendChild(list);

      if (keys.length > 1) {
        const btnRow = document.createElement('div');
        btnRow.className = 'settings-btn-row';
        const deleteAll = document.createElement('button');
        deleteAll.type = 'button';
        deleteAll.className = 'btn btn--danger btn--sm';
        deleteAll.textContent = 'Delete all API keys';
        deleteAll.addEventListener('click', () => {
          const ok = confirm(
            `Delete all ${keys.length} stored API keys?\n\n` +
            `External services using these credentials will stop working until you re-enter them.`,
          );
          if (!ok) return;
          deleteAllApiKeys();
          rerender();
        });
        btnRow.appendChild(deleteAll);
        sec.appendChild(btnRow);
      }
    }

    return sec;
  }

  // ─── Display ────────────────────────────────────────────────────────────

  /** UI scale slider. Drives CSS `zoom` on #sidebar so the whole left
   *  panel — fonts, padding, borders, icons, popovers — scales as one
   *  unit. The map canvas + screen-space marker overlay are untouched.
   *  Persists immediately on drag; double-click resets to 100%. */
  private _buildDisplaySection(): HTMLElement {
    const sec = mkSection(
      'Display',
      'How the left-hand panel renders. The map canvas itself is unaffected.',
    );

    const row = document.createElement('div');
    row.className = 'settings-danger-row';

    const label = document.createElement('div');
    const cur = Math.round(getUiScale() * 100);
    const valueEl = document.createElement('strong');
    valueEl.textContent = `UI scale — ${cur}%`;
    label.appendChild(valueEl);
    label.appendChild(document.createElement('br'));
    const help = document.createElement('span');
    help.className = 'settings-stat-sub';
    help.textContent =
      `Shrink or grow the whole sidebar in proportion. Useful on very ` +
      `high-DPI screens where the default reads tiny, or on small ` +
      `laptops where shrinking buys back canvas space. Range ` +
      `${Math.round(UI_SCALE_MIN * 100)}–${Math.round(UI_SCALE_MAX * 100)}%. ` +
      `Double-click the slider to reset to ${Math.round(UI_SCALE_DEFAULT * 100)}%.`;
    label.appendChild(help);

    const slider = document.createElement('input');
    slider.type  = 'range';
    slider.min   = String(UI_SCALE_MIN);
    slider.max   = String(UI_SCALE_MAX);
    slider.step  = '0.05';
    slider.value = String(getUiScale());
    slider.style.width = '120px';
    slider.style.flex  = '0 0 auto';
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      setUiScale(v);
      applyUiScale(v);
      valueEl.textContent = `UI scale — ${Math.round(v * 100)}%`;
    });
    slider.addEventListener('dblclick', () => {
      slider.value = String(UI_SCALE_DEFAULT);
      setUiScale(UI_SCALE_DEFAULT);
      applyUiScale(UI_SCALE_DEFAULT);
      valueEl.textContent = `UI scale — ${Math.round(UI_SCALE_DEFAULT * 100)}%`;
    });

    row.append(label, slider);
    sec.appendChild(row);
    return sec;
  }

  // ─── Scaled View ────────────────────────────────────────────────────────

  private _buildScaledViewSection(): HTMLElement {
    const sec = mkSection(
      'Scaled View',
      'Settings apply on next Scaled View open.',
    );

    sec.appendChild(this._buildPerfToggle({
      title: 'Enable transitions & animations',
      help:
        'Off by default — Scaled View cuts instantly to each new frame so a physical table screen never visibly shudders. Tick to enable map-change transitions + handout reveals (good for cinematic table screens; can feel jarring on bare battlemaps).',
      get: isScaledViewTransitionsEnabled,
      set: setScaledViewTransitionsEnabled,
    }));

    sec.appendChild(this._buildMeasureUnitRow());

    return sec;
  }

  /** v2.18 — remote players' relay (BYO STUN/TURN) + default Star System
   *  Explorer origin (prod / beta / dev) for the StarMap map kind. */
  private _buildConnectionsSection(): HTMLElement {
    const sec = mkSection(
      'Connections',
      'Remote players connect peer-to-peer. That works on home and mobile networks by itself (a public relay is built in). A workplace network that blocks UDP can stop it - then a relay that speaks TLS on port 443 is needed.',
    );
    // Relay
    const relayLabel = document.createElement('span');
    relayLabel.className = 'about-edit-label';
    relayLabel.textContent = 'Your own STUN/TURN servers (one per line: turns:host:443|username|credential)';
    const ta = document.createElement('textarea');
    ta.className = 'select-full';
    ta.rows = 3;
    ta.style.cssText = 'font: 12px/1.4 ui-monospace, monospace; resize: vertical;';
    ta.placeholder = 'turns:relay.example.com:443|user|secret';
    ta.value = iceToText(loadStoredIce());
    const status = document.createElement('p');
    status.className = 'settings-section-intro';
    const summarise = () => {
      const l = loadStoredIce();
      if (!l || l.length === 0) { status.textContent = 'Using the built-in relay only.'; return; }
      const tls = l.some((e) => (Array.isArray(e.urls) ? e.urls : [e.urls]).some((u) => /^turns:/i.test(u)));
      status.textContent = `${l.length} custom server${l.length === 1 ? '' : 's'} saved${tls ? ' (includes a TLS relay - good for locked-down networks)' : ' (no turns: entry - a UDP-blocking network may still fail)'}. New player links and QR codes carry it; re-share existing ones.`;
    };
    ta.addEventListener('change', () => {
      const servers = parseIceText(ta.value);
      saveStoredIce(servers.length ? servers : null);
      ta.value = iceToText(servers);
      summarise();
    });
    summarise();
    sec.append(relayLabel, ta, status);

    // SSE origin
    const originLabel = document.createElement('span');
    originLabel.className = 'about-edit-label';
    originLabel.style.marginTop = 'var(--space-md)';
    originLabel.textContent = 'Star System Explorer address for new StarMaps';
    const originInput = document.createElement('input');
    originInput.type = 'url';
    originInput.className = 'select-full';
    originInput.value = getSseOrigin();
    originInput.title = `Production is ${SSE_ORIGIN_DEFAULT}. Point at the beta site (https://beta.starsystemx.com) or a local dev server to test against it. Existing StarMap maps keep their own address.`;
    originInput.addEventListener('change', () => {
      let v = originInput.value.trim();
      try { v = v ? new URL(v).origin : ''; } catch { v = ''; }
      setSseOrigin(v || null);
      originInput.value = getSseOrigin();
    });
    const originHint = document.createElement('p');
    originHint.className = 'settings-section-intro';
    originHint.textContent = 'Production by default. Use the beta address to test beta Mappadux against beta Star System Explorer; each StarMap map remembers the address it was created with.';
    sec.append(originLabel, originInput, originHint);
    return sec;
  }

  /** Distance unit for the "Measure from here" map ruler: a number-per-square
   *  plus a free-form suffix (e.g. 5 + "'" or 3 + "m"). */
  private _buildMeasureUnitRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'settings-danger-row';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';

    const label = document.createElement('div');
    label.innerHTML =
      '<strong>Measurement scale</strong><br><span class="settings-stat-sub">' +
      'One grid square equals this distance, used by "Measure from here". The number is multiplied by the square count; the unit is tagged on the end. E.g. 5 + \' or 3 + m.</span>';
    row.appendChild(label);

    const group = document.createElement('div');
    group.style.display = 'flex';
    group.style.gap = '6px';
    group.style.alignItems = 'center';
    group.style.flexShrink = '0';

    const num = document.createElement('input');
    num.type = 'number';
    num.min = '0';
    num.step = 'any';
    num.value = String(getMeasureUnitValue());
    num.className = 'marker-text-input';
    num.style.width = '64px';
    num.title = 'Distance per grid square (the number used in the maths)';
    num.addEventListener('change', () => {
      const v = parseFloat(num.value);
      if (Number.isFinite(v) && v > 0) setMeasureUnitValue(v);
      else num.value = String(getMeasureUnitValue());
      window.dispatchEvent(new CustomEvent('mappadux:measure-unit-changed'));
    });

    const suffix = document.createElement('input');
    suffix.type = 'text';
    suffix.value = getMeasureUnitSuffix();
    suffix.maxLength = 8;
    suffix.className = 'marker-text-input';
    suffix.style.width = '52px';
    suffix.title = 'Unit tag appended to the result (e.g. \', ft, m, km)';
    suffix.addEventListener('change', () => {
      setMeasureUnitSuffix(suffix.value);
      window.dispatchEvent(new CustomEvent('mappadux:measure-unit-changed'));
    });

    const perSq = document.createElement('span');
    perSq.className = 'settings-stat-sub';
    perSq.textContent = '/ square';

    group.append(num, suffix, perSq);
    row.appendChild(group);
    return row;
  }

  // ─── Performance ────────────────────────────────────────────────────────

  private _buildPerformanceSection(): HTMLElement {
    const sec = mkSection(
      'Performance',
      'Animated-map playback trade-offs. Defaults are fine on capable hardware — reach for these if you hit stalls or stutter.',
    );

    sec.appendChild(this._buildPerfToggle({
      title: 'Send only the first frame to local player windows',
      help:
        'If your GM PC also runs a player or projector window, both fight the GM canvas for Chrome’s video-decode budget. On: same-browser windows show a static first frame instead of animating (phones / LAN players always get full animation). <em>Turn on if</em> local windows stutter on big animated maps.',
      get: isLocalPlayerStaticOnly,
      set: setLocalPlayerStaticOnly,
    }));

    sec.appendChild(this._buildDiceAppearanceRow());

    sec.appendChild(this._buildPerfToggle({
      title: 'Cap animated map texture at 1080p',
      help:
        'Animated maps upload at the player’s window size, so a 4K fullscreen player uploads 4K every frame — which stalls modest GPUs. On: caps the texture at 1920 px (slightly softer when zoomed, much smoother). <em>Turn on if</em> players report stutter on animated maps.',
      get: isVideoCap1080Enabled,
      set: setVideoCap1080Enabled,
    }));

    return sec;
  }

  /** Build one row in the Performance section — title + multi-line
   *  help text + a right-aligned toggle that mirrors a localStorage
   *  flag via the supplied get/set pair. */
  /** v2.19.3 — shaped dice or plain numbers, for THIS screen. Fidelity, not
   *  attention: how MUCH you see of a roll is the Dice panel's business, and
   *  travels with the pack; this never does. */
  private _buildDiceAppearanceRow(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'settings-danger-row';

    const label = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = 'Dice appearance';
    const help = document.createElement('span');
    help.className = 'settings-stat-sub';
    help.innerHTML =
      'Rolled dice can be drawn as shaped, shaded dice or as plain numbered tiles. '
      + '<em>Automatic</em> picks plain on a modest device or when you have asked the system '
      + 'for less motion. This is for this screen only — it never travels with a pack, and every '
      + 'player chooses their own.';
    label.append(title, document.createElement('br'), help);

    const select = document.createElement('select');
    select.className = 'select-full';
    select.style.flex = '0 0 auto';
    select.style.width = '150px';
    for (const [value, text] of [['auto', 'Automatic'], ['shaped', 'Shaped dice'], ['plain', 'Plain numbers']] as const) {
      const o = document.createElement('option');
      o.value = value; o.textContent = text;
      select.append(o);
    }
    select.value = getDiceRenderPreference();
    select.addEventListener('change', () => setDiceRenderPreference(select.value as 'auto' | 'shaped' | 'plain'));

    row.append(label, select);
    return row;
  }

  private _buildPerfToggle(opts: {
    title: string;
    help:  string;
    get:   () => boolean;
    set:   (v: boolean) => void;
  }): HTMLElement {
    const row = document.createElement('div');
    row.className = 'settings-danger-row';
    const label = document.createElement('div');
    label.innerHTML =
      `<strong>${opts.title}</strong><br>` +
      `<span class="settings-stat-sub">${opts.help}</span>`;
    const toggle = document.createElement('label');
    toggle.className = 'toggle-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = opts.get();
    input.addEventListener('change', () => opts.set(input.checked));
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    toggle.append(input, slider);
    row.append(label, toggle);
    return row;
  }

  // ─── Player Voice ─────────────────────────────────────────────────────────

  /** v2.19.7 — dice SETUP: sets, systems, who sees what, colours. Rolling is an
   *  overlay on the canvas, because that is the only part you need mid-game. */
  private _buildDiceSection(): HTMLElement {
    const sec = mkSection(
      'Dice',
      'The rolls your game asks for, and the house rules about who sees them. Both travel with the pack.',
    );
    buildDiceSettings(sec, {
      onChanged: () => this._onDiceChanged?.(),
      ...(this._pixels ? { pixels: this._pixels } : {}),
    });
    return sec;
  }
  private _onDiceChanged: (() => void) | undefined;
  private _pixels: DiceSettingsOptions['pixels'];

  private _buildPlayerPermissionsSection(): HTMLElement {
    const sec = mkSection(
      'Player Permissions',
      'What connected players can do beyond watching. Switch off anything that doesn’t suit your table.',
    );

    sec.appendChild(this._buildPerfToggle({
      title: 'Allow player pings',
      help:
        'Players right-click (long-press on touch) the map to ping a point. Everyone sees a pulse in that player’s colour; on your screen it stays, labelled, until you dismiss it.',
      get: arePingsEnabled,
      set: setPingsEnabled,
    }));

    sec.appendChild(this._buildPerfToggle({
      title: 'Allow player messages',
      help:
        'Players message you privately, or each other (copied to you). Messages arrive in the Player Voice panel with an unread count.',
      get: isMessagingEnabled,
      set: setMessagingEnabled,
    }));

    sec.appendChild(this._buildPerfToggle({
      title: 'Allow player dice',
      help:
        'Players get a tray of the rolls you set up in the Dice panel — one tap is one roll. Results reach you as chat, so open All players to watch them. Off hides the tray everywhere; your own dice keep working.',
      get: areDiceEnabled,
      set: (v: boolean) => { setDiceEnabled(v); const t = document.getElementById('dice-enabled-toggle') as HTMLInputElement | null; if (t) t.checked = v; },
    }));

    sec.appendChild(this._buildPerfToggle({
      title: 'Let players move their own token',
      help:
        'Lets a player drag their placed token from their own view — you see it move live, with a “send it back” undo. Off keeps token placement in your hands.',
      get: arePlayerMarkersMovable,
      set: setPlayerMarkersMovable,
    }));

    sec.appendChild(this._buildPerfToggle({
      title: 'Full player UI in the GM preview window',
      help:
        'Off (default): the inline Show Player View / pop-out preview hides identity prompts, the identity pill, toasts, the right-click menu and the roll prompt — handy for previewing what players see. On: the preview behaves as a real player. Only affects GM preview windows (?gmPreview flag); real players joining via the QR are never gated by this.',
      get: showFullPlayerUiInPreview,
      set: setShowFullPlayerUiInPreview,
    }));

    return sec;
  }

  /** v2.16.109 — Game-system rules that shape the table tools (currently the
   *  initiative tracker's sort direction; room here for more later). */
  private _buildGameSystemSection(): HTMLElement {
    const sec = mkSection(
      'Game System',
      'Rules that shape the table tools for your system.',
    );
    sec.appendChild(this._buildInitiativeOrderBlock());
    sec.appendChild(this._buildPerfToggle({
      title: 'Initiative anonymisation',
      help:
        'On (default): players see opposition turns as anonymous "!" cards — no threat letter, no clue which enemy is which (the letter is stripped from the broadcast entirely). Off: players see the same A/B/C threat letters you do, for tables that track named or numbered enemies openly.',
      get: isInitiativeAnonymised,
      set: (v) => {
        setInitiativeAnonymised(v);
        // Re-broadcast so connected players update live without waiting for the
        // next tracker change. GMApp listens and reships the (re-)stripped state.
        window.dispatchEvent(new CustomEvent('mappadux:initiative-anonymise-changed', { detail: v }));
      },
    }));
    return sec;
  }

  /** v2.16.109 — the LLM reply assistant, promoted to its own section. */
  private _buildReplyAssistantSection(): HTMLElement {
    const sec = mkSection(
      'Reply Assistant (LLM)',
      'Optional LLM that drafts replies to player messages — click “Suggest replies” on a message in the Player Voice panel. Use a local LM Studio server (URL pre-filled — no API key needed) or a hosted provider like OpenRouter (new URL & API key required). Everything stays between your browser and the endpoint you choose.',
    );
    sec.appendChild(this._buildLlmAssistantBlock());
    return sec;
  }

  /** v2.16.65 — Initiative sort direction. One-shot GM preference; the
   *  in-tracker dropdown has been removed in favour of this single
   *  control. Default High → Low. */
  private _buildInitiativeOrderBlock(): HTMLElement {
    const row = document.createElement('div');
    row.className = 'settings-danger-row';
    row.style.alignItems = 'center';
    row.style.justifyContent = 'space-between';
    const label = document.createElement('div');
    label.innerHTML =
      '<strong>Initiative order</strong><br>' +
      '<span class="settings-stat-sub">Numeric direction for the initiative rail. Default High → Low (d20 systems). Switch to Low → High for roll-under systems (Cyberpunk Red, Call of Cthulhu).</span>';
    row.appendChild(label);
    const select = document.createElement('select');
    select.className = 'select-full';
    select.style.maxWidth = '180px';
    for (const [val, txt] of [
      ['high-to-low', 'High → Low'],
      ['low-to-high', 'Low → High'],
    ] as Array<['high-to-low' | 'low-to-high', string]>) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = txt;
      if (getInitiativeSortDirection() === val) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', () => {
      const dir = select.value as 'high-to-low' | 'low-to-high';
      setInitiativeSortDirection(dir);
      window.dispatchEvent(new CustomEvent('mappadux:initiative-direction-changed', { detail: dir }));
    });
    row.appendChild(select);
    return row;
  }

  /** GM reply assistant — optional LLM that suggests replies to player
   *  messages. Works with a local LM Studio server or a hosted OpenAI-compatible
   *  provider (OpenRouter etc.). The system prompt is fully editable. */
  private _buildLlmAssistantBlock(): HTMLElement {
    const cfg: LLMSettings = getLLMSettings();

    const wrap = document.createElement('div');
    wrap.className = 'settings-danger-row';
    wrap.style.flexDirection = 'column';
    wrap.style.alignItems = 'stretch';
    wrap.style.gap = 'var(--space-sm)';

    // v2.16.109 — header removed; the section title + intro now cover it.
    const enableLabel = document.createElement('label');
    enableLabel.className = 'toggle-switch';
    enableLabel.style.alignSelf = 'flex-start';
    const enableInput = document.createElement('input');
    enableInput.type = 'checkbox';
    enableInput.checked = cfg.enabled;
    const enableSlider = document.createElement('span');
    enableSlider.className = 'toggle-slider';
    enableLabel.append(enableInput, enableSlider);
    const enableRow = document.createElement('div');
    enableRow.style.display = 'flex';
    enableRow.style.alignItems = 'center';
    enableRow.style.gap = 'var(--space-sm)';
    const enableText = document.createElement('span');
    enableText.className = 'settings-stat-sub';
    enableText.textContent = 'Enable reply assistant';
    enableRow.append(enableLabel, enableText);
    wrap.appendChild(enableRow);

    const persist = () => setLLMSettings({
      enabled:      enableInput.checked,
      baseUrl:      baseInput.value,
      model:        modelsSelect.value,
      systemPrompt: promptArea.value,
    });

    const mkInput = (labelText: string, placeholder: string, value: string): HTMLInputElement => {
      const lab = document.createElement('label');
      lab.style.display = 'flex';
      lab.style.flexDirection = 'column';
      lab.style.gap = '3px';
      lab.className = 'settings-stat-sub';
      lab.textContent = labelText;
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'select-full';
      inp.placeholder = placeholder;
      inp.value = value;
      inp.autocomplete = 'off';
      lab.appendChild(inp);
      wrap.appendChild(lab);
      return inp;
    };

    // v2.16.111 — default to the LM Studio local URL so the common path
    // works out of the box; a hosted-provider user overwrites it.
    const baseInput  = mkInput('Base URL', 'http://localhost:1234/v1', cfg.baseUrl || 'http://localhost:1234/v1');

    const keyLab = document.createElement('label');
    keyLab.style.display = 'flex';
    keyLab.style.flexDirection = 'column';
    keyLab.style.gap = '3px';
    keyLab.className = 'settings-stat-sub';
    keyLab.textContent = 'API key (leave blank for LM Studio / local)';
    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.className = 'select-full';
    keyInput.placeholder = 'sk-… (OpenRouter etc.)';
    keyInput.value = getLLMApiKey();
    keyInput.autocomplete = 'off';
    keyInput.addEventListener('change', () => setLLMApiKey(keyInput.value));
    keyLab.appendChild(keyInput);
    wrap.appendChild(keyLab);

    // Model dropdown — populated by Test connection. Picking an option fills
    // the model input above; the input stays the source of truth so a model
    // unloaded on the server doesn't blank the user's saved choice.
    const modelsLab = document.createElement('label');
    modelsLab.style.display = 'flex';
    modelsLab.style.flexDirection = 'column';
    modelsLab.style.gap = '3px';
    modelsLab.className = 'settings-stat-sub';
    modelsLab.textContent = 'Model';
    const modelsSelect = document.createElement('select');
    modelsSelect.className = 'select-full';
    // v2.16.110 — the dropdown IS the model source of truth (no manual field —
    // you rarely know an LLM's full path, so picking is friendlier). Seed it
    // with the saved model so it shows before any fetch; the button below
    // replaces it with the endpoint's list, keeping the saved pick selected
    // (listed as "(saved)" if the endpoint doesn't advertise it).
    const seedModels = (saved: string): void => {
      modelsSelect.replaceChildren();
      const o = document.createElement('option');
      if (saved) { o.value = saved; o.textContent = saved; o.selected = true; }
      else       { o.value = ''; o.textContent = 'Test connection & fetch models…'; }
      modelsSelect.appendChild(o);
    };
    seedModels(cfg.model);
    modelsSelect.addEventListener('change', persist);
    modelsLab.appendChild(modelsSelect);
    // v2.16.111 — modelsLab is appended AFTER the Test button below, so the
    // section reads as a guided flow: URL -> key -> Test & fetch -> Model.

    const testRow = document.createElement('div');
    testRow.style.display = 'flex';
    testRow.style.alignItems = 'center';
    testRow.style.gap = 'var(--space-sm)';
    const testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'btn btn--ghost btn--sm';
    testBtn.textContent = 'Test connection & fetch models';
    const testStatus = document.createElement('span');
    testStatus.className = 'settings-stat-sub';
    testStatus.style.minHeight = '1.2em';
    testRow.append(testBtn, testStatus);
    wrap.appendChild(testRow);

    const runTest = async (): Promise<void> => {
      const saved = modelsSelect.value; // preserve the current pick across the fetch
      testBtn.disabled = true;
      testStatus.style.color = 'var(--text-secondary)';
      testStatus.textContent = 'Connecting…';
      try {
        const ids = await LLMClient.listModels(baseInput.value, keyInput.value);
        if (ids.length === 0) {
          testStatus.style.color = 'var(--warn)';
          testStatus.textContent = 'Connected, but no models are loaded on the server.';
          seedModels(saved);
          return;
        }
        testStatus.style.color = 'var(--ok)';
        testStatus.textContent = `Connected — ${ids.length} model${ids.length === 1 ? '' : 's'} available.`;
        modelsSelect.replaceChildren();
        let matched = false;
        for (const id of ids) {
          const opt = document.createElement('option');
          opt.value = id;
          opt.textContent = id;
          if (id === saved) { opt.selected = true; matched = true; }
          modelsSelect.appendChild(opt);
        }
        if (saved && !matched) {
          const opt = document.createElement('option');
          opt.value = saved;
          opt.textContent = `${saved} (saved — not on this endpoint)`;
          opt.selected = true;
          modelsSelect.insertBefore(opt, modelsSelect.firstChild);
        }
        persist(); // selection may have shifted to the first model
      } catch (err) {
        testStatus.style.color = 'var(--danger)';
        testStatus.textContent = (err as Error).message;
        seedModels(saved);
      } finally {
        testBtn.disabled = false;
      }
    };
    testBtn.addEventListener('click', () => { void runTest(); });

    // If the endpoint changes after a fetch, the listed models are stale —
    // collapse back to just the saved pick + prompt a re-fetch.
    const markStale = () => {
      if (modelsSelect.options.length <= 1) return;
      seedModels(modelsSelect.value);
      testStatus.textContent = 'Endpoint changed — fetch models again.';
    };
    baseInput.addEventListener('input', markStale);
    keyInput.addEventListener('input', markStale);

    // v2.16.111 — Model box goes here, directly under Test connection & fetch
    // models, completing the URL -> key -> Test -> Model walkthrough.
    wrap.appendChild(modelsLab);

    const promptLab = document.createElement('label');
    promptLab.style.display = 'flex';
    promptLab.style.flexDirection = 'column';
    promptLab.style.gap = '3px';
    promptLab.className = 'settings-stat-sub';
    promptLab.textContent = 'System prompt (tune it to your LLM + GMing style)';
    const promptArea = document.createElement('textarea');
    promptArea.className = 'select-full';
    promptArea.rows = 8;
    promptArea.style.resize = 'vertical';
    promptArea.style.fontFamily = 'var(--font-mono)';
    promptArea.style.fontSize = 'var(--font-size-sm)';
    promptArea.value = cfg.systemPrompt;
    promptLab.appendChild(promptArea);
    wrap.appendChild(promptLab);

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'btn btn--ghost btn--sm';
    resetBtn.style.alignSelf = 'flex-start';
    resetBtn.textContent = 'Reset prompt to default';
    resetBtn.addEventListener('click', () => { promptArea.value = DEFAULT_GM_ASSISTANT_PROMPT; persist(); });
    wrap.appendChild(resetBtn);

    for (const el of [enableInput, baseInput, promptArea]) {
      el.addEventListener('change', persist);
    }

    return wrap;
  }

  // ─── Danger Zone ────────────────────────────────────────────────────────

  private _buildDangerZone(cb: SettingsDialogCallbacks): HTMLElement {
    const sec = mkSection('Danger Zone', 'Destructive actions. Make sure you have a Map Pack saved first if you want to keep anything.');
    sec.classList.add('settings-danger');

    // ── In-progress features toggle (v2.15.17) ──────────────────
    // Reveals the Settings UI for the v2.16 work (Stagecraft —
    // Lighting + Automation) that ships ahead of being fully polished.
    // Soundtracks graduated out in v2.15.43.
    // Hidden by default in production; visible by default on beta /
    // dev / deploy previews. Users with existing configurations are
    // unaffected — the sidebar panels continue to work whenever
    // they're configured, this flag only gates the Settings entry
    // points. Reload required so newly-toggled-on sections render
    // (the dialog only checks the flag at open time).
    const flagRow = document.createElement('div');
    flagRow.className = 'settings-danger-row';
    const flagText = document.createElement('div');
    flagText.innerHTML =
      '<strong>Show in-progress features</strong><br>' +
      '<span class="settings-stat-sub">' +
      'Reveals configuration UI for features that ship ahead of their final polish. Off by default on production. Status: ' +
      escapeHtml(inProgressFlagOrigin()) + '. Reload after toggling.' +
      '</span>';
    const flagToggle = document.createElement('label');
    flagToggle.className = 'toggle-switch';
    const flagInput = document.createElement('input');
    flagInput.type = 'checkbox';
    flagInput.checked = isInProgressEnabled();
    flagInput.addEventListener('change', () => setInProgressEnabled(flagInput.checked));
    const flagSlider = document.createElement('span');
    flagSlider.className = 'toggle-slider';
    flagToggle.append(flagInput, flagSlider);
    flagRow.append(flagText, flagToggle);
    sec.appendChild(flagRow);

    const row1 = document.createElement('div');
    row1.className = 'settings-danger-row';
    const row1Text = document.createElement('div');
    row1Text.innerHTML =
      '<strong>Delete database</strong><br>' +
      '<span class="settings-stat-sub">Wipes maps, audio, icons, and all pack settings. Keeps API keys, projector calibration, and other browser preferences.</span>';
    const row1Btn = document.createElement('button');
    row1Btn.type = 'button';
    row1Btn.className = 'btn btn--danger btn--sm';
    row1Btn.textContent = 'Delete DB';
    row1Btn.addEventListener('click', async () => {
      const ok = confirm(
        'Delete database?\n\n' +
        'This wipes ALL maps, sounds, custom icons, and pack settings. ' +
        'Your API keys and projector calibration stay. The page will reload into an empty workspace.',
      );
      if (!ok) return;
      await cb.onDeleteDb();
    });
    row1.append(row1Text, row1Btn);
    sec.appendChild(row1);

    const row2 = document.createElement('div');
    row2.className = 'settings-danger-row';
    const row2Text = document.createElement('div');
    row2Text.innerHTML =
      '<strong>Delete everything</strong><br>' +
      '<span class="settings-stat-sub">Wipes the database AND all local browser settings, including API keys and projector calibration. Acts like a fresh install.</span>';
    const row2Btn = document.createElement('button');
    row2Btn.type = 'button';
    row2Btn.className = 'btn btn--danger btn--sm';
    row2Btn.textContent = 'Delete All Data';
    row2Btn.addEventListener('click', async () => {
      const ok = confirm(
        'Delete EVERYTHING?\n\n' +
        'This wipes the database AND every local setting Mappadux has stored ' +
        '(API keys, projector calibration, UI preferences). The page will reload as if freshly installed.\n\n' +
        'This cannot be undone.',
      );
      if (!ok) return;
      await cb.onDeleteAllData();
    });
    row2.append(row2Text, row2Btn);
    sec.appendChild(row2);

    return sec;
  }

  // ─── Stagecraft (v2.16) ─────────────────────────────────────────────────

  /** Stagecraft section — lighting + automation only. WLED, HA, QLC+.
   *  Soundtracks (audio) live in their own Settings section now —
   *  Stagecraft was getting busy and the two concerns are independent
   *  (lighting is per-map; soundtracks are pack-level). */
  private _buildStagecraftSection(): HTMLElement {
    const sec = mkSection(
      'Stagecraft (Lighting + Automation)',
      'Connect Mappadux to physical lighting and home-automation so a map switch can fire LED presets, scenes, and DMX cues at the table. Mappadux only references presets you have already authored in those tools — set them up there first, then point Mappadux at the device and pick from the dropdown when assigning per map. None of this travels in Map Pack exports; the connection details stay on this machine.',
    );

    sec.appendChild(this._buildWledSubsection());
    sec.appendChild(document.createElement('hr'));
    sec.appendChild(this._buildHaSubsection());
    sec.appendChild(document.createElement('hr'));
    sec.appendChild(this._buildQlcSubsection());

    return sec;
  }

  /** v2.15.14 — Standalone Soundtracks Settings section. Pack-level
   *  music providers (YouTube + Spotify). Split out of Stagecraft so
   *  the lighting and audio configurations don't crowd each other. */
  private _buildSoundtracksSection(): HTMLElement {
    const sec = mkSection(
      'Soundtracks (Background Music)',
      'Pack-level background music that persists across map switches. Enable the providers you want to use; the Soundtracks panel appears in the sidebar as soon as at least one is on. Track URLs travel with your .mappadux bundle; auth tokens stay on this machine.',
    );
    sec.appendChild(this._buildSoundtracksSubsection());
    return sec;
  }

  private _buildQlcSubsection(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'settings-stagecraft-qlc';

    const heading = document.createElement('strong');
    heading.textContent = 'QLC+ (DMX lighting)';
    wrap.appendChild(heading);
    const sub = document.createElement('div');
    sub.className = 'settings-stat-sub';
    sub.style.marginBottom = '6px';
    sub.innerHTML =
      'Connect to a <a href="https://www.qlcplus.org" target="_blank" rel="noopener">Q Light Controller Plus</a> ' +
      'instance to fire DMX scenes / chasers / sequences on map switch. ' +
      'Enable the Web Interface in QLC+ (Functions menu → Web Interface). ' +
      'Mappadux only calls existing Functions you have authored in QLC+ — ' +
      'set them up there first.';
    wrap.appendChild(sub);

    const existing = getQlcConfig();
    const form = document.createElement('div');
    form.className = 'settings-stagecraft-ha-form';
    form.innerHTML =
      `<input type="text" data-field="url" placeholder="URL (e.g. 192.168.1.50 or ws://192.168.1.50:9999)" value="${existing ? escapeHtml(existing.url) : ''}" />`;
    wrap.appendChild(form);

    const btnRow = document.createElement('div');
    btnRow.className = 'settings-btn-row';
    btnRow.style.marginTop = '6px';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn--ghost btn--sm';
    saveBtn.textContent = existing ? 'Save changes' : 'Save';
    const testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'btn btn--ghost btn--sm';
    testBtn.textContent = 'Test';
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn--danger btn--sm';
    clearBtn.textContent = 'Disconnect';
    clearBtn.hidden = !existing;
    const status = document.createElement('div');
    status.className = 'settings-stat-sub';
    status.style.marginTop = '4px';

    const openLink = document.createElement('a');
    openLink.target = '_blank';
    openLink.rel    = 'noopener';
    openLink.className = 'stagecraft-config-link';
    openLink.textContent = 'Open QLC+ ↗';
    openLink.title = 'Open the QLC+ Web Interface to author Functions';
    openLink.hidden = !existing;
    if (existing) openLink.href = qlcConfigUrl(existing.url);

    const urlInput = form.querySelector<HTMLInputElement>('[data-field="url"]')!;
    saveBtn.addEventListener('click', () => {
      const url = normaliseQlcEndpoint(urlInput.value);
      if (!url) { status.textContent = 'Enter a URL to save.'; return; }
      setQlcConfig({ url });
      urlInput.value = url;
      saveBtn.textContent = 'Save changes';
      clearBtn.hidden = false;
      openLink.hidden = false;
      openLink.href = qlcConfigUrl(url);
      status.textContent = 'Saved. Open the Lighting / Automation panel to pick a Function for the active map.';
    });
    testBtn.addEventListener('click', async () => {
      const url = normaliseQlcEndpoint(urlInput.value);
      if (!url) { status.textContent = 'Enter a URL first.'; return; }
      status.textContent = 'Testing…';
      const info = await fetchQlcInfo(url);
      if (info.ok) status.textContent = `OK — ${info.data.functionCount} Functions reported.`;
      else         status.textContent = `Failed: ${info.message}`;
    });
    clearBtn.addEventListener('click', () => {
      setQlcConfig(null);
      urlInput.value = '';
      saveBtn.textContent = 'Save';
      clearBtn.hidden = true;
      openLink.hidden = true;
      status.textContent = 'Disconnected.';
    });

    btnRow.append(saveBtn, testBtn, clearBtn, openLink);
    wrap.append(btnRow, status);
    return wrap;
  }

  private _buildSoundtracksSubsection(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'settings-stagecraft-soundtracks';

    wrap.appendChild(this._buildProviderToggleRow(
      'Enable YouTube',
      'No sign-in needed. Plays via YouTube\'s public IFrame Player API.',
      isYoutubeEnabled,
      setYoutubeEnabled,
    ));
    wrap.appendChild(this._buildProviderToggleRow(
      'Enable Spotify',
      'Plays via the Spotify Web Playback SDK (the in-browser player) with the Spotify Web API for transport commands (play / pause / shuffle / repeat). Both are free for the user — there is no per-call cost. Requirements: a Spotify Premium account (the SDK won\'t play for free accounts) AND a one-time Spotify Developer App registration so we have a Client ID. Setup steps appear when you enable this.',
      isSpotifyEnabled,
      setSpotifyEnabled,
    ));
    wrap.appendChild(this._buildSpotifyConnectRow());

    return wrap;
  }

  /** Spotify Client ID input + Connect button. Surfaces profile +
   *  product when connected. Hidden when Spotify isn't enabled. */
  private _buildSpotifyConnectRow(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'settings-stagecraft-spotify-connect';
    wrap.style.marginTop = '6px';

    // v2.15.47 — Step-by-step guide. Spotify's Developer flow is
    // well-trodden but unsigned-up users hit "what do I need?" with
    // no clear answer; we use both the Web Playback SDK (audio out)
    // and the Web API (transport commands), and the OAuth scopes
    // need to match. Stating it explicitly here avoids a support
    // round-trip every time a new GM hits Connect.
    const sub = document.createElement('div');
    sub.className = 'settings-stat-sub';
    sub.innerHTML =
      '<strong>What we use:</strong> Spotify Web Playback SDK (audio playback in the browser) + Spotify Web API (transport: play / pause / shuffle / repeat / device transfer). Both are free for the user.<br>' +
      '<br>' +
      '<strong>Setup steps:</strong>' +
      '<ol class="settings-spotify-steps">' +
      '<li>Sign in at <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">developer.spotify.com/dashboard</a> with your Spotify Premium account.</li>' +
      '<li>Click <strong>Create app</strong>. Name + description can be anything (e.g. "Mappadux for me"). Website can be blank.</li>' +
      '<li>For <strong>APIs used</strong>, tick <em>Web API</em> and <em>Web Playback SDK</em>. Both are needed.</li>' +
      `<li>Under <strong>Redirect URIs</strong>, paste exactly: <code>${escapeHtml(spotifyRedirectUri())}</code> and click Add.${_spotifyMultiOriginTip()}</li>` +
      '<li>Save. Open the app\'s Settings page and copy the <strong>Client ID</strong>. (You don\'t need the Client Secret — Mappadux uses PKCE, not a server.)</li>' +
      '<li>Paste the Client ID below, click <strong>Save Client ID</strong>, then <strong>Connect Spotify</strong>. You\'ll be sent to Spotify to approve, then returned here.</li>' +
      '</ol>' +
      '<strong>Permissions you\'ll grant:</strong> <code>streaming</code> (audio playback), <code>user-modify-playback-state</code> (play / pause commands), <code>user-read-email</code> + <code>user-read-private</code> (required by Spotify alongside <code>streaming</code>).<br>' +
      '<br>' +
      '<strong>Privacy:</strong> the Client ID + access token stay in your browser (localStorage). They never travel in <code>.mappadux</code> pack bundles, and there is no Mappadux server holding your data. (mappadux.com does count page views — no cookies, nothing identifying, nothing about your table; see About.)';
    wrap.appendChild(sub);

    const form = document.createElement('div');
    form.className = 'settings-stagecraft-ha-form';
    form.style.marginTop = '4px';
    const idInput = document.createElement('input');
    idInput.type = 'text';
    idInput.placeholder = 'Spotify Client ID';
    idInput.value = getSpotifyClientId();
    form.appendChild(idInput);
    wrap.appendChild(form);

    const btnRow = document.createElement('div');
    btnRow.className = 'settings-btn-row';
    btnRow.style.marginTop = '4px';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn--ghost btn--sm';
    saveBtn.textContent = 'Save Client ID';

    const connectBtn = document.createElement('button');
    connectBtn.type = 'button';
    connectBtn.className = 'btn btn--ghost btn--sm';
    connectBtn.textContent = isSpotifyConnected() ? 'Reconnect' : 'Connect Spotify';

    const disconnectBtn = document.createElement('button');
    disconnectBtn.type = 'button';
    disconnectBtn.className = 'btn btn--danger btn--sm';
    disconnectBtn.textContent = 'Disconnect';
    disconnectBtn.hidden = !isSpotifyConnected();

    const status = document.createElement('div');
    status.className = 'settings-stat-sub';
    status.style.marginTop = '4px';
    const profile = getSpotifyProfile();
    if (isSpotifyConnected() && profile) {
      status.textContent = `Connected as ${profile.displayName} (${profile.product}).`;
      if (profile.product !== 'premium') {
        status.textContent += ' Web Playback SDK requires Premium — free accounts can\'t play full tracks.';
      }
    }

    saveBtn.addEventListener('click', () => {
      setSpotifyClientId(idInput.value);
      status.textContent = 'Saved Client ID. Click Connect to start the OAuth flow.';
    });
    connectBtn.addEventListener('click', () => {
      setSpotifyClientId(idInput.value);  // save in case user didn't click Save
      void startSpotifyConnect().catch((e) => {
        status.textContent = `Connect failed: ${(e as Error).message}`;
      });
    });
    disconnectBtn.addEventListener('click', () => {
      clearSpotifyAuth();
      connectBtn.textContent = 'Connect Spotify';
      disconnectBtn.hidden = true;
      status.textContent = 'Disconnected.';
    });

    btnRow.append(saveBtn, connectBtn, disconnectBtn);
    wrap.append(btnRow, status);
    return wrap;
  }

  private _buildProviderToggleRow(
    title: string,
    help: string,
    get: () => boolean,
    set: (v: boolean) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'settings-danger-row';
    const label = document.createElement('div');
    label.innerHTML = `<strong>${title}</strong><br>` +
      `<span class="settings-stat-sub">${help}</span>`;
    const toggle = document.createElement('label');
    toggle.className = 'toggle-switch';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = get();
    input.addEventListener('change', () => set(input.checked));
    const slider = document.createElement('span');
    slider.className = 'toggle-slider';
    toggle.append(input, slider);
    row.append(label, toggle);
    return row;
  }

  private _buildWledSubsection(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'settings-stagecraft-wled';

    const heading = document.createElement('strong');
    heading.textContent = 'WLED endpoints';
    wrap.appendChild(heading);
    const sub = document.createElement('div');
    sub.className = 'settings-stat-sub';
    sub.style.marginBottom = '6px';
    sub.textContent =
      'Each row is one WLED-firmware device on your network. Mappadux ' +
      'reads its preset list and fires a preset by id when you assign ' +
      'one to a map. Make sure the device is reachable from this browser ' +
      '(LAN, .local mDNS or IP).';
    wrap.appendChild(sub);

    const list = document.createElement('div');
    list.className = 'settings-stagecraft-wled-list';
    wrap.appendChild(list);

    const renderList = (): void => {
      list.innerHTML = '';
      const endpoints = getWledEndpoints();
      if (endpoints.length === 0) {
        const none = document.createElement('div');
        none.className = 'settings-stat';
        none.style.fontStyle = 'italic';
        none.textContent = 'No WLED devices configured.';
        list.appendChild(none);
        return;
      }
      for (const ep of endpoints) {
        const row = document.createElement('div');
        row.className = 'settings-stagecraft-wled-row';

        const labelEl = document.createElement('div');
        labelEl.innerHTML = `<strong>${escapeHtml(ep.label)}</strong>` +
          `<br><span class="settings-stat-sub">${escapeHtml(ep.url)}</span>` +
          ` <a href="${escapeHtml(wledConfigUrl(ep.url))}" target="_blank" rel="noopener" class="stagecraft-config-link" title="Open WLED's own web UI to author presets">Open WLED ↗</a>` +
          `<br><span class="settings-stat-sub" data-status>(not tested yet)</span>`;

        const btnRow = document.createElement('div');
        btnRow.className = 'settings-btn-row';
        const testBtn = document.createElement('button');
        testBtn.type = 'button';
        testBtn.className = 'btn btn--ghost btn--sm';
        testBtn.textContent = 'Test';
        const statusEl = labelEl.querySelector('[data-status]') as HTMLElement;
        testBtn.addEventListener('click', async () => {
          statusEl.textContent = '(testing…)';
          const info = await fetchWledInfo(ep.url);
          if (info.ok) {
            statusEl.textContent =
              `OK — "${info.data.name}", WLED ${info.data.version}, ${info.data.ledCount} LEDs.`;
          } else {
            statusEl.textContent = `Failed: ${info.message}`;
          }
        });
        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn--danger btn--sm';
        delBtn.textContent = 'Remove';
        delBtn.addEventListener('click', () => {
          removeWledEndpoint(ep.id);
          renderList();
        });
        btnRow.append(testBtn, delBtn);

        row.append(labelEl, btnRow);
        list.appendChild(row);
      }
    };

    renderList();

    // ── Add-device row ───────────────────────────────────────────────
    const addRow = document.createElement('div');
    addRow.className = 'settings-stagecraft-wled-add';
    addRow.style.marginTop = '8px';
    addRow.innerHTML =
      '<input type="text" data-field="label" placeholder="Label (e.g. Table strip)" />' +
      '<input type="text" data-field="url" placeholder="URL (e.g. 192.168.1.42 or wled-table.local)" />' +
      '<button type="button" class="btn btn--ghost btn--sm" data-action="add">Add</button>';
    const labelInput = addRow.querySelector<HTMLInputElement>('[data-field="label"]')!;
    const urlInput   = addRow.querySelector<HTMLInputElement>('[data-field="url"]')!;
    const addBtn     = addRow.querySelector<HTMLButtonElement>('[data-action="add"]')!;
    addBtn.addEventListener('click', () => {
      const label = labelInput.value.trim();
      const url   = normaliseEndpoint(urlInput.value);
      if (!label || !url) return;
      addWledEndpoint({ id: generateId(), label, url });
      labelInput.value = '';
      urlInput.value = '';
      renderList();
    });
    wrap.appendChild(addRow);

    return wrap;
  }

  private _buildHaSubsection(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'settings-stagecraft-ha';

    const heading = document.createElement('strong');
    heading.textContent = 'Home Assistant';
    wrap.appendChild(heading);
    const sub = document.createElement('div');
    sub.className = 'settings-stat-sub';
    sub.style.marginBottom = '6px';
    sub.innerHTML =
      'Connect to a Home Assistant instance to fire scenes or scripts on ' +
      'map switch. Create a <strong>long-lived access token</strong> in HA ' +
      'under Profile → Long-Lived Access Tokens. Mappadux only calls ' +
      'existing scenes/scripts you have authored in HA — set them up ' +
      'there first.';
    wrap.appendChild(sub);

    const existing = getHaConfig();
    const form = document.createElement('div');
    form.className = 'settings-stagecraft-ha-form';
    form.innerHTML =
      `<input type="text" data-field="url" placeholder="URL (e.g. http://homeassistant.local:8123)" value="${existing ? escapeHtml(existing.url) : ''}" />` +
      `<input type="password" data-field="token" placeholder="Long-lived access token" value="${existing ? escapeHtml(existing.token) : ''}" />`;
    wrap.appendChild(form);

    const btnRow = document.createElement('div');
    btnRow.className = 'settings-btn-row';
    btnRow.style.marginTop = '6px';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn btn--ghost btn--sm';
    saveBtn.textContent = existing ? 'Save changes' : 'Save';
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.className = 'btn btn--danger btn--sm';
    clearBtn.textContent = 'Disconnect';
    clearBtn.hidden = !existing;
    const status = document.createElement('div');
    status.className = 'settings-stat-sub';
    status.style.marginTop = '4px';

    const urlInput   = form.querySelector<HTMLInputElement>('[data-field="url"]')!;
    const tokenInput = form.querySelector<HTMLInputElement>('[data-field="token"]')!;
    const openLink = document.createElement('a');
    openLink.target = '_blank';
    openLink.rel    = 'noopener';
    openLink.className = 'stagecraft-config-link';
    openLink.textContent = 'Open Home Assistant ↗';
    openLink.title = 'Open the HA dashboard to author scenes / scripts';
    openLink.hidden = !existing;
    if (existing) openLink.href = haConfigUrl(existing.url);

    saveBtn.addEventListener('click', () => {
      const url = urlInput.value.trim().replace(/\/+$/, '');
      const token = tokenInput.value.trim();
      if (!url || !token) {
        status.textContent = 'Enter both URL and token to save.';
        return;
      }
      setHaConfig({ url, token });
      saveBtn.textContent = 'Save changes';
      clearBtn.hidden = false;
      openLink.hidden = false;
      openLink.href = haConfigUrl(url);
      status.textContent = 'Saved. The Lighting/Automation panel should now show Home Assistant.';
    });
    clearBtn.addEventListener('click', () => {
      setHaConfig(null);
      urlInput.value = '';
      tokenInput.value = '';
      saveBtn.textContent = 'Save';
      clearBtn.hidden = true;
      openLink.hidden = true;
      status.textContent = 'Disconnected. Mappadux will stop firing Home Assistant scenes.';
    });

    btnRow.append(saveBtn, clearBtn, openLink);
    wrap.append(btnRow, status);
    return wrap;
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────

/** v2.15.48 — Spotify Developer Apps accept multiple Redirect URIs
 *  per app, so a user who tests on beta and uses production can drop
 *  both URIs into one app rather than maintain two Client IDs. On
 *  production we don't surface this — production-only users don't
 *  need beta and the noise would just confuse them. On non-production
 *  origins (beta, deploy previews, localhost) we suggest adding the
 *  production URI alongside so the same Client ID works wherever
 *  they open Mappadux. */
function _spotifyMultiOriginTip(): string {
  const h = location.hostname;
  const isProduction = h === 'mappadux.com' || h === 'www.mappadux.com';
  if (isProduction) return '';
  return ' <em>Tip:</em> Spotify accepts multiple Redirect URIs in one Developer App, so you can also paste <code>https://mappadux.com/</code> up-front — the same Client ID then works on production too.';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function mkSection(title: string, intro: string, opts?: { open?: boolean }): HTMLElement {
  // Native <details> + <summary> for the collapsible behaviour —
  // browser owns the open/closed state, no JS event wiring needed.
  // Section-level CSS styles the summary like the rest of the
  // panel-title pattern (uppercase track + chevron) so settings
  // reads consistently with the main UI panels. Callers continue
  // to use `sec.appendChild(row)` and rows land inside the details
  // body where the browser hides them when closed.
  const sec = document.createElement('details');
  sec.className = 'settings-section';
  // v2.16.111 — shared name makes the sections an exclusive accordion:
  // opening one closes the others (native HTML, no JS). Keeps the dialog
  // short so there's nothing to scroll through. Older browsers ignore the
  // attribute and fall back to the previous multi-open behaviour.
  sec.setAttribute('name', 'settings-accordion');
  if (opts?.open) sec.open = true;

  const summary = document.createElement('summary');
  summary.className = 'settings-section-title';
  summary.textContent = title;
  sec.appendChild(summary);

  const p = document.createElement('p');
  p.className = 'settings-section-intro';
  p.textContent = intro;
  sec.appendChild(p);

  return sec;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

// Re-export for callers that want to enumerate keys without importing the
// settings module directly.
export type { StoredApiKey };
