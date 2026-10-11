/**
 * Key generation + normalization.
 * The normalization MUST stay identical to web/lib/key.ts (both have a test for "k7rm-qx4p 9wab").
 */
var KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 chars: no 0, O, 1, I, L
var KEY_LENGTH = 12;

/** Remove all spaces and dashes, uppercase. The result is the Supabase Auth password. */
function normalizeKey(input) {
  return String(input === null || input === undefined ? '' : input).replace(/[\s-]/g, '').toUpperCase();
}

/** XXXX-XXXX-XXXX for display in the email. */
function formatKey(normalized) {
  return normalized.replace(/(.{4})(?=.)/g, '$1-');
}

/**
 * Cryptographically random key. Utilities.getUuid() is a random (v4) UUID from a secure source;
 * we use only its fully-random hex digits (dropping the version and variant nibbles) and
 * rejection-sample bytes so every alphabet character is equally likely (no modulo bias).
 */
function generateKey() {
  var out = '';
  while (out.length < KEY_LENGTH) {
    var hex = Utilities.getUuid().replace(/-/g, '');
    hex = hex.slice(0, 12) + hex.slice(13, 16) + hex.slice(17); // 30 random hex digits = 15 bytes
    for (var i = 0; i + 1 < hex.length && out.length < KEY_LENGTH; i += 2) {
      var b = parseInt(hex.substr(i, 2), 16);
      if (b < 248) out += KEY_ALPHABET.charAt(b % 31); // 248 = 31 * 8
    }
  }
  return out;
}
