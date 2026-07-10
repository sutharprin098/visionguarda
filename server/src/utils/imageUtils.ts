/**
 * Convert a Buffer to a JPEG Buffer, normalising various input formats.
 * Falls back to returning the original buffer if sharp is unavailable.
 */
export async function normaliseToJpeg(input: Buffer): Promise<Buffer> {
  try {
    // Dynamically require sharp (optional dependency) to avoid crash if not installed
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any
    const sharpModule = require('sharp') as any;
    return await sharpModule(input).jpeg({ quality: 85 }).toBuffer();
  } catch {
    return input;
  }
}

/**
 * Strip the "data:<mime>;base64," prefix and return raw base64 string.
 */
export function stripDataUri(dataUri: string): string {
  const idx = dataUri.indexOf(',');
  return idx >= 0 ? dataUri.slice(idx + 1) : dataUri;
}

/**
 * Build a data URI from a raw base64 string and mime type.
 */
export function buildDataUri(base64: string, mimeType = 'image/jpeg'): string {
  return `data:${mimeType};base64,${base64}`;
}

/**
 * Estimate the byte size of a multipart upload in a human-readable form.
 */
export function humanBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
