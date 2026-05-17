/**
 * Pre-ship debug helper. The GM tunes the MapFX kind drafts + backdrop
 * params to taste, then runs `window.mappaduxDumpFx()` in the browser
 * console. The helper:
 *
 *   • Walks every kind in OVERLAY_KIND_REGISTRY that has tuned values
 *     in FogState.shaderParams (the per-kind draft buffer the panel
 *     edits), and the active backdrop's params if one is set.
 *   • Compares each value to the registered default for that param.
 *     Only shows params the GM has actually moved away from default —
 *     keeps the output focused on what matters.
 *   • Logs a paste-friendly summary, caches the full snapshot on
 *     `window._mppFxLast` for later inspection, and copies a JSON
 *     blob to the clipboard so it can be dropped straight back into
 *     a chat / commit message.
 *
 *   Pass an effect id (e.g. `mappaduxDumpFx('fire')`) to see ALL
 *   params for one kind, including ones still at default.
 */

import type { SessionState } from '../types.ts';
import {
  OVERLAY_KIND_REGISTRY,
  OVERLAY_KIND_ORDER,
  type ShaderParamDef,
} from '../mapfx/overlayKindRegistry.ts';

interface FxParamSnapshot {
  /** Param id (matches ShaderParamDef.id). */
  id:       string;
  /** Current value the GM has dialled in. May equal `default`. */
  value:    number | string;
  /** Registered default from the registry. */
  default:  number | string;
  /** True when value !== default. */
  changed:  boolean;
  /** UI control type (slider / toggle / color), for context. */
  type:     'slider' | 'toggle' | 'color';
}

interface FxKindSnapshot {
  kind:   string;
  label:  string;
  /** Empty array → no params were tuned. The console output skips
   *  kinds with no changed params unless the GM passed the kind id
   *  explicitly. */
  params: FxParamSnapshot[];
}

interface FxBackdropSnapshot {
  kind:   string;
  label:  string;
  params: FxParamSnapshot[];
}

export interface FxDumpResult {
  timestamp: string;
  mapfx:     FxKindSnapshot[];
  backdrop:  FxBackdropSnapshot | null;
}

function paramType(p: ShaderParamDef): 'slider' | 'toggle' | 'color' {
  if (p.type === 'color')  return 'color';
  if (p.type === 'toggle') return 'toggle';
  return 'slider';
}

function snapshotParam(
  def: ShaderParamDef,
  stored: number | string | undefined,
): FxParamSnapshot {
  const value = stored ?? def.default;
  return {
    id:      def.id,
    value,
    default: def.default,
    changed: value !== def.default,
    type:    paramType(def),
  };
}

function buildMapFxSnapshots(
  state: SessionState,
  filterKindId: string | null,
): FxKindSnapshot[] {
  const out: FxKindSnapshot[] = [];
  const drafts = state.fog.shaderParams ?? {};
  for (const kindId of OVERLAY_KIND_ORDER) {
    if (filterKindId && kindId !== filterKindId) continue;
    const entry = OVERLAY_KIND_REGISTRY[kindId];
    const defs  = entry.shaderParams ?? [];
    if (defs.length === 0) continue;
    const draft = drafts[kindId] ?? {};
    const params = defs.map((d) => snapshotParam(d, draft[d.id]));
    // Skip kinds with no tuned params UNLESS the GM explicitly asked
    // for this kind via the filter arg — that case wants the full
    // picture even when nothing was moved.
    const anyChanged = params.some((p) => p.changed);
    if (!anyChanged && !filterKindId) continue;
    out.push({
      kind:   kindId,
      label:  entry.label,
      params: filterKindId ? params : params.filter((p) => p.changed),
    });
  }
  return out;
}

async function buildBackdropSnapshot(
  state: SessionState,
): Promise<FxBackdropSnapshot | null> {
  const cfg = state.view.backdrop;
  if (!cfg || cfg.kind === 'none') return null;
  // Lazy-import the registry so this debug helper doesn't pull the
  // whole rendering bundle into the GMApp critical path.
  const { BACKDROPS } = await import('../rendering/backdrops/backdropRegistry.ts');
  const entry = BACKDROPS.find((b) => b.id === cfg.kind);
  if (!entry) return { kind: cfg.kind, label: cfg.kind, params: [] };
  const stored = cfg.params ?? {};
  const params = (entry.params ?? []).map((d) => snapshotParam(d, stored[d.id]));
  return { kind: entry.id, label: entry.label, params };
}

function formatParamLine(p: FxParamSnapshot): string {
  const flag = p.changed ? '*' : ' ';
  const v = JSON.stringify(p.value);
  const d = JSON.stringify(p.default);
  return p.changed
    ? `  ${flag} ${p.id.padEnd(20)} = ${v}  (default ${d})`
    : `  ${flag} ${p.id.padEnd(20)} = ${v}`;
}

function logSnapshot(result: FxDumpResult, filterKindId: string | null): void {
  console.group(`%cmappadux FX dump — ${result.timestamp}`, 'font-weight:bold');
  if (result.mapfx.length === 0 && !filterKindId) {
    console.log('No MapFX kinds have tuned params (everything still at registered defaults).');
  } else {
    console.group('MapFX (per-kind drafts)');
    for (const k of result.mapfx) {
      console.group(`${k.label} — ${k.kind}`);
      for (const p of k.params) console.log(formatParamLine(p));
      console.groupEnd();
    }
    console.groupEnd();
  }
  if (result.backdrop) {
    console.group(`Backdrop — ${result.backdrop.label} (${result.backdrop.kind})`);
    for (const p of result.backdrop.params) console.log(formatParamLine(p));
    console.groupEnd();
  } else {
    console.log('No active backdrop.');
  }
  console.log('Full snapshot cached at window._mppFxLast. JSON copied to clipboard.');
  console.groupEnd();
}

/** Wire `window.mappaduxDumpFx(...)` and `window._mppFxLast`. Called
 *  once from GMApp's constructor. */
export function setupFxDump(getState: () => SessionState): void {
  const win = window as Window & {
    mappaduxDumpFx?: (kindId?: string) => Promise<FxDumpResult>;
    _mppFxLast?:     FxDumpResult;
  };
  win.mappaduxDumpFx = async (kindId?: string): Promise<FxDumpResult> => {
    const state = getState();
    const filter = kindId ?? null;
    const result: FxDumpResult = {
      timestamp: new Date().toISOString(),
      mapfx:     buildMapFxSnapshots(state, filter),
      backdrop:  await buildBackdropSnapshot(state),
    };
    win._mppFxLast = result;
    logSnapshot(result, filter);
    try {
      await navigator.clipboard.writeText(JSON.stringify(result, null, 2));
    } catch { /* user gesture missing / blocked — output is still in the cache */ }
    return result;
  };
}
