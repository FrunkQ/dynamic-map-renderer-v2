/**
 * Provider-agnostic URL → SoundtrackTrack parser. The Soundtracks
 * panel accepts a single text input — paste a YouTube URL, a Spotify
 * URL, or a bare 11-char YouTube video id. This module detects which
 * provider and returns a discriminated SoundtrackTrack.
 *
 * v2.15.12 — Spotify embed support added alongside YouTube. Either
 * provider's parser failing returns null; the caller surfaces a
 * "couldn't parse" message in the UI.
 */

import type { SoundtrackTrack } from '../types.ts';
import { extractVideoId, extractPlaylistId } from './youtubePlayer.ts';

export function parseSoundtrackUrl(input: string): SoundtrackTrack | null {
  const s = input.trim();
  if (!s) return null;

  // Try Spotify first — its URLs have a distinct hostname so this is
  // unambiguous. If it doesn't match, fall back to YouTube parsing.
  const spotify = parseSpotifyUrl(s);
  if (spotify) return spotify;

  // YouTube. A URL can legitimately carry BOTH ?v=<videoId> AND
  // ?list=<listId> — pasting it from the YT Music app generally
  // includes both because the user opened a track inside a playlist.
  // Prefer the PLAYLIST in that case: a slot with the playlist plays
  // many tracks; a slot with one video plays only that one. The GM
  // can paste the bare watch URL if they want just the video.
  const playlist = extractPlaylistId(s);
  if (playlist) return { kind: 'youtube-playlist', listId: playlist };

  const yt = extractVideoId(s);
  if (yt) return { kind: 'youtube', videoId: yt };

  return null;
}

/** Spotify URL or URI parser. Handles:
 *    - https://open.spotify.com/track/<id>
 *    - https://open.spotify.com/album/<id>
 *    - https://open.spotify.com/playlist/<id>
 *    - https://open.spotify.com/episode/<id>
 *    - http variants
 *    - spotify:track:<id> URIs
 *  Returns a track ref with the canonical spotify:<kind>:<id> URI. */
function parseSpotifyUrl(input: string): SoundtrackTrack | null {
  // URI form: spotify:track:<id>, spotify:playlist:<id>, etc.
  const uriMatch = /^spotify:(track|album|playlist|episode):([A-Za-z0-9]+)/.exec(input);
  if (uriMatch) {
    return { kind: 'spotify', trackUri: `spotify:${uriMatch[1]}:${uriMatch[2]}` };
  }

  let url: URL;
  try { url = new URL(input); } catch { return null; }
  if (!/(^|\.)spotify\.com$/i.test(url.hostname)) return null;

  // Path shape: /track/<id> or /embed/track/<id> or with ?si=...
  const parts = url.pathname.split('/').filter(Boolean);
  // Drop a leading "embed" segment if present.
  const segs = parts[0] === 'embed' ? parts.slice(1) : parts;
  const kind = segs[0];
  const id   = segs[1];
  if (!kind || !id) return null;
  if (!['track', 'album', 'playlist', 'episode'].includes(kind)) return null;
  if (!/^[A-Za-z0-9]+$/.test(id)) return null;
  return { kind: 'spotify', trackUri: `spotify:${kind}:${id}` };
}

/** Parse a stored spotify:track:<id> URI back into its parts. Used
 *  by the embed engine to build the iframe src URL. */
export function parseSpotifyUri(uri: string): { kind: string; id: string } | null {
  const m = /^spotify:(track|album|playlist|episode):([A-Za-z0-9]+)$/.exec(uri);
  if (!m) return null;
  return { kind: m[1]!, id: m[2]! };
}

/** Human-readable label for a track when the user hasn't set one.
 *  Both providers render in the same shape so the UI looks identical
 *  regardless of source. We'll layer real track-title lookup on top
 *  later (YouTube oEmbed + Spotify API). */
export function defaultTrackLabel(track: SoundtrackTrack): string {
  if (track.kind === 'youtube')          return track.videoId;
  if (track.kind === 'youtube-playlist') return `Playlist · ${track.listId}`;
  if (track.kind === 'vamper')           return track.label ?? 'Local song';
  const parts = parseSpotifyUri(track.trackUri);
  if (!parts) return track.trackUri;
  return parts.id;
}
