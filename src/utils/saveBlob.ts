/**
 * Save a Blob to disk. Tries the File System Access API first
 * (`window.showSaveFilePicker`) so the user gets a real OS save dialog with a
 * location picker. Falls back to the classic hidden-anchor download if the
 * API is unavailable (e.g., Firefox, Safari) — the browser's own download
 * UI takes over from there.
 *
 * Returns `'saved'` on success, `'cancelled'` if the user dismissed the
 * native picker. Anchor-download path always returns `'saved'` because
 * cancellation isn't observable through the DOM API.
 */
export interface SaveBlobOptions {
  blob:           Blob;
  suggestedName:  string;
  /** Description shown in the picker's file-type dropdown (FS Access only). */
  description?:   string;
  /** MIME type → list of extensions for the picker. Defaults to a generic
   *  binary type accepting just the extension on `suggestedName`. */
  accept?:        Record<string, string[]>;
}

interface FilePickerOptions {
  suggestedName?: string;
  types?: Array<{
    description?: string;
    accept: Record<string, string[]>;
  }>;
}
interface FileSystemFileHandle {
  createWritable(): Promise<FileSystemWritableFileStream>;
}
interface FileSystemWritableFileStream {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}
type ShowSaveFilePicker = (opts?: FilePickerOptions) => Promise<FileSystemFileHandle>;

export async function saveBlob(opts: SaveBlobOptions): Promise<'saved' | 'cancelled'> {
  const picker = (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker;
  const ext = opts.suggestedName.includes('.')
    ? opts.suggestedName.slice(opts.suggestedName.lastIndexOf('.'))
    : '';
  // Use a custom MIME by default so the OS picker doesn't auto-extend the
  // filter to other binary extensions (Chrome does this for octet-stream,
  // pulling in .exe/.com/.bin which looks alarming next to your file type).
  const accept = opts.accept ?? (ext ? { 'application/x-binary-blob': [ext] } : {});

  if (typeof picker === 'function') {
    try {
      const handle = await picker({
        suggestedName: opts.suggestedName,
        types: [{
          ...(opts.description ? { description: opts.description } : {}),
          accept,
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(opts.blob);
      await writable.close();
      return 'saved';
    } catch (err) {
      // AbortError = user cancelled the picker
      if ((err as Error).name === 'AbortError') return 'cancelled';
      throw err;
    }
  }

  // Fallback: anchor download. Browser's own UI handles location.
  const url = URL.createObjectURL(opts.blob);
  const a   = document.createElement('a');
  a.href     = url;
  a.download = opts.suggestedName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return 'saved';
}
