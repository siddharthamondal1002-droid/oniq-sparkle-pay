// Pure validation for admin scene-still uploads. No I/O, no secrets — safe to
// import from either side of the boundary, and the server re-runs every check
// regardless of what the client did.

export const MAX_STILL_BYTES = 15 * 1024 * 1024; // 15 MB

/** Only real image types. The list is a whitelist, never a blacklist. */
export const ALLOWED_STILL_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;

/**
 * Leading signatures for the three formats we accept.
 *
 * Content, not extension. Renaming payload.txt to holiday.png defeats an
 * extension check completely, and an extension check is worse than none
 * because it looks like protection.
 */
const IMAGE_MAGIC: { mime: string; test: (h: Uint8Array) => boolean }[] = [
  {
    mime: 'image/png',
    test: (h) =>
      h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47 && h[4] === 0x0d &&
      h[5] === 0x0a && h[6] === 0x1a && h[7] === 0x0a,
  },
  { mime: 'image/jpeg', test: (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff },
  {
    mime: 'image/webp',
    test: (h) =>
      h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 &&
      h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50,
  },
];

/** Bytes needed to identify every format above (WEBP needs 12). */
export const STILL_MAGIC_BYTES = 12;

/** The real type of these bytes, or null if it is not an image we accept. */
export function sniffImageMime(head: Uint8Array): string | null {
  for (const sig of IMAGE_MAGIC) {
    if (head.length >= STILL_MAGIC_BYTES && sig.test(head)) return sig.mime;
  }
  return null;
}

/**
 * A filename safe to concatenate into a storage path.
 *
 * Rejects rather than rewrites: silently "cleaning" a/../b into ab hides an
 * attempt to escape the prefix, and the admin should see that it was refused.
 */
export function validateStillName(raw: string): string | null {
  const name = String(raw ?? '');
  if (!name) return 'filename required';
  if (name.length > 128) return 'filename too long (max 128)';
  if (name.includes('/') || name.includes('\\')) return 'filename may not contain a path separator';
  if (name.startsWith('.')) return 'filename may not start with a dot';
  if (name.includes('..')) return 'filename may not contain ".."';
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return 'filename may only use letters, numbers, . _ -';
  if (!/\.(png|jpe?g|webp)$/i.test(name)) return 'filename must end in .png, .jpg or .webp';
  return null;
}

export function validateStillSize(size: number): string | null {
  if (!Number.isFinite(size) || size <= 0) return 'file is empty';
  if (size > MAX_STILL_BYTES) return `file is too large (max ${MAX_STILL_BYTES / (1024 * 1024)}MB)`;
  return null;
}
