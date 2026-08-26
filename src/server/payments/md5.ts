/**
 * Minimal MD5.
 *
 * MD5 is not used anywhere in this application for security of our own data —
 * passwords use PBKDF2 and sessions use SHA-256. It exists solely because the
 * SSLCOMMERZ IPN signature scheme (`verify_sign` / `verify_key`) is specified
 * in MD5, and WebCrypto deliberately does not implement MD5. Treat the
 * signature it verifies as a cheap first filter: the authoritative check is
 * always the Order Validation API call in sslcommerz.ts.
 */

function toWords(input: Uint8Array): number[] {
  const words: number[] = [];
  for (let i = 0; i < input.length; i++) {
    words[i >> 2] = (words[i >> 2] ?? 0) | (input[i] << ((i % 4) * 8));
  }
  return words;
}

const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const K = Array.from({ length: 64 }, (_, i) =>
  Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296),
);

function rotl(x: number, c: number): number {
  return (x << c) | (x >>> (32 - c));
}

export function md5Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;

  const words = toWords(bytes);
  words[bytes.length >> 2] = (words[bytes.length >> 2] ?? 0) | (0x80 << ((bytes.length % 4) * 8));
  const paddedLength = (((bytes.length + 8) >> 6) + 1) * 16;
  for (let i = words.length; i < paddedLength; i++) words[i] = words[i] ?? 0;
  for (let i = 0; i < paddedLength; i++) words[i] = words[i] ?? 0;
  words[paddedLength - 2] = bitLen >>> 0;
  words[paddedLength - 1] = Math.floor(bitLen / 4294967296);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  for (let chunk = 0; chunk < paddedLength; chunk += 16) {
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const tmp = d;
      d = c;
      c = b;
      const sum = (a + f + K[i] + (words[chunk + g] ?? 0)) | 0;
      b = (b + rotl(sum, S[i])) | 0;
      a = tmp;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  return [a0, b0, c0, d0].map(wordToHex).join("");
}

function wordToHex(value: number): string {
  let out = "";
  for (let i = 0; i < 4; i++) {
    out += ((value >> (i * 8)) & 0xff).toString(16).padStart(2, "0");
  }
  return out;
}
