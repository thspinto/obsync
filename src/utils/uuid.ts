/**
 * Generate a UUIDv7 string.
 * UUIDv7 embeds a Unix timestamp (milliseconds) in the first 48 bits,
 * making them time-sortable while remaining globally unique.
 *
 * Format: xxxxxxxx-xxxx-7xxx-yxxx-xxxxxxxxxxxx
 * - First 48 bits: Unix timestamp in milliseconds
 * - 4 bits: version (7)
 * - 12 bits: random
 * - 2 bits: variant (10)
 * - 62 bits: random
 */
export function uuidv7(): string {
  const timestamp = Date.now();

  // Get random bytes
  const randomBytes = new Uint8Array(10);
  crypto.getRandomValues(randomBytes);

  // Build the UUID bytes (16 bytes total)
  const bytes = new Uint8Array(16);

  // Bytes 0-5: timestamp (48 bits, big-endian)
  bytes[0] = (timestamp / 0x10000000000) & 0xff;
  bytes[1] = (timestamp / 0x100000000) & 0xff;
  bytes[2] = (timestamp / 0x1000000) & 0xff;
  bytes[3] = (timestamp / 0x10000) & 0xff;
  bytes[4] = (timestamp / 0x100) & 0xff;
  bytes[5] = timestamp & 0xff;

  // Bytes 6-7: version (7) + 12 random bits
  bytes[6] = 0x70 | (randomBytes[0]! & 0x0f); // version 7
  bytes[7] = randomBytes[1]!;

  // Bytes 8-9: variant (10) + 14 random bits
  bytes[8] = 0x80 | (randomBytes[2]! & 0x3f); // variant 10
  bytes[9] = randomBytes[3]!;

  // Bytes 10-15: 48 random bits
  bytes[10] = randomBytes[4]!;
  bytes[11] = randomBytes[5]!;
  bytes[12] = randomBytes[6]!;
  bytes[13] = randomBytes[7]!;
  bytes[14] = randomBytes[8]!;
  bytes[15] = randomBytes[9]!;

  // Convert to hex string with dashes
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
