/**
 * Deterministic 53-bit hash generator (cyrb53)
 * Highly collision-resistant, 100% synchronous, and pure JS.
 * 
 * @param {string} str - The string to hash
 * @param {number} seed - Optional seed value
 * @returns {string} - A 16-character hex hash
 */
export function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}

/**
 * Generates a unique Jenne Asset ID from a file's relative path.
 * 
 * @param {string} relativePath - File path relative to User Data
 * @returns {string} - The unique ID prefixed with 'jenne-'
 */
export function generateAssetId(relativePath) {
  if (!relativePath) return "";
  // Normalize path separators to ensure consistent hashes across OS platforms
  const normalizedPath = relativePath.replace(/\\/g, "/").toLowerCase().trim();
  const hash = cyrb53(normalizedPath);
  return `jenne-${hash}`;
}
