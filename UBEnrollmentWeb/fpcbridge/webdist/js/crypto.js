// DES / 2-key 3DES (EDE) and the GlobalPlatform SCP02 helpers ported from UBScp02.cs.
// WebCrypto has no DES, so it is implemented here (bit-array based; speed is irrelevant
// for the handful of blocks SCP02 needs).
'use strict';

const DES = (() => {
  const IP = [58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,
              57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7];
  const FP = [40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,
              36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25];
  const E  = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,
              22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1];
  const P  = [16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25];
  const PC1 = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,
               63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4];
  const PC2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,
               41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32];
  const SHIFTS = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
  const S = [
    [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7, 0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,
     4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0, 15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
    [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10, 3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,
     0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15, 13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
    [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8, 13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,
     13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7, 1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
    [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15, 13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,
     10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4, 3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
    [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9, 14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,
     4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14, 11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
    [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11, 10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,
     9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6, 4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
    [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1, 13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,
     1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2, 6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
    [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7, 1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,
     7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8, 2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11],
  ];

  const toBits = (bytes) => {
    const bits = new Array(bytes.length * 8);
    for (let i = 0; i < bits.length; i++) bits[i] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
    return bits;
  };
  const fromBits = (bits) => {
    const out = new Uint8Array(bits.length / 8);
    for (let i = 0; i < bits.length; i++) if (bits[i]) out[i >> 3] |= 0x80 >> (i & 7);
    return out;
  };
  const perm = (bits, table) => table.map((p) => bits[p - 1]);
  const rotl = (bits, n) => bits.slice(n).concat(bits.slice(0, n));

  function subkeys(key8) {
    const k = perm(toBits(key8), PC1);
    let c = k.slice(0, 28);
    let d = k.slice(28);
    const keys = [];
    for (let r = 0; r < 16; r++) {
      c = rotl(c, SHIFTS[r]);
      d = rotl(d, SHIFTS[r]);
      keys.push(perm(c.concat(d), PC2));
    }
    return keys;
  }

  function crypt(block8, key8, decrypt) {
    const ks = subkeys(key8);
    const b = perm(toBits(block8), IP);
    let l = b.slice(0, 32);
    let r = b.slice(32);
    for (let round = 0; round < 16; round++) {
      const k = ks[decrypt ? 15 - round : round];
      const x = perm(r, E).map((v, i) => v ^ k[i]);
      const s = [];
      for (let j = 0; j < 8; j++) {
        const o = j * 6;
        const row = (x[o] << 1) | x[o + 5];
        const col = (x[o + 1] << 3) | (x[o + 2] << 2) | (x[o + 3] << 1) | x[o + 4];
        const v = S[j][row * 16 + col];
        s.push((v >> 3) & 1, (v >> 2) & 1, (v >> 1) & 1, v & 1);
      }
      const f = perm(s, P);
      const nr = l.map((v, i) => v ^ f[i]);
      l = r;
      r = nr;
    }
    return fromBits(perm(r.concat(l), FP));
  }

  const encryptBlock = (block8, key8) => crypt(block8, key8, false);
  const decryptBlock = (block8, key8) => crypt(block8, key8, true);

  // 3DES EDE. A 16-byte key is 2-key 3DES (K1,K2,K1) as in .NET TripleDES.
  function tdesEncryptBlock(block8, key) {
    const k1 = key.slice(0, 8);
    const k2 = key.slice(8, 16);
    const k3 = key.length >= 24 ? key.slice(16, 24) : k1;
    return encryptBlock(decryptBlock(encryptBlock(block8, k1), k2), k3);
  }

  // CBC with zero IV and no padding (data length must be a multiple of 8).
  function cbc(data, blockFn) {
    if (data.length % 8 !== 0) throw new Error('CBC data length must be a multiple of 8');
    const out = new Uint8Array(data.length);
    let prev = new Uint8Array(8);
    for (let o = 0; o < data.length; o += 8) {
      const x = new Uint8Array(8);
      for (let i = 0; i < 8; i++) x[i] = data[o + i] ^ prev[i];
      prev = blockFn(x);
      out.set(prev, o);
    }
    return out;
  }

  return {
    encryptBlock,
    tdesEncryptBlock,
    desCbc: (data, key8) => cbc(data, (b) => encryptBlock(b, key8)),
    tdesCbc: (data, key) => cbc(data, (b) => tdesEncryptBlock(b, key)),
  };
})();

// Port of UBScp02.cs
class UBScp02 {
  static DEFAULT_KEY = new Uint8Array([0x40,0x41,0x42,0x43,0x44,0x45,0x46,0x47,0x48,0x49,0x4A,0x4B,0x4C,0x4D,0x4E,0x4F]);

  constructor(encKey, macKey, dekKey) {
    this.encKey = encKey || UBScp02.DEFAULT_KEY;
    this.macKey = macKey || UBScp02.DEFAULT_KEY;
    this.dekKey = dekKey || UBScp02.DEFAULT_KEY;
    this.sessionEncrypt = new Uint8Array(16);
    this.sessionMac = new Uint8Array(16);
    this.sessionDek = new Uint8Array(16);
  }

  // cardRandom = sequence counter (2) + card challenge (6)
  makeSessionKeys(cardRandom) {
    const derive = (c0, c1, key) => {
      const d = new Uint8Array(16);
      d[0] = c0; d[1] = c1; d[2] = cardRandom[0]; d[3] = cardRandom[1];
      return DES.tdesCbc(d, key);
    };
    this.sessionEncrypt = derive(0x01, 0x82, this.encKey);
    this.sessionMac = derive(0x01, 0x01, this.macKey);
    this.sessionDek = derive(0x01, 0x81, this.dekKey);
  }

  // Returns the full EXTERNAL AUTHENTICATE APDU (84 82 00 00 10 | host cryptogram | C-MAC)
  makeExternalAuthData(cardRandom, hostRandom) {
    const t24 = new Uint8Array(24);
    t24.set(cardRandom.slice(0, 8), 0);
    t24.set(hostRandom.slice(0, 8), 8);
    t24[16] = 0x80;
    const hostCrypto = DES.tdesCbc(t24, this.sessionEncrypt).slice(16, 24);

    const exAuth = new Uint8Array(21);
    exAuth.set([0x84, 0x82, 0x00, 0x00, 0x10], 0);
    exAuth.set(hostCrypto, 5);

    // Retail MAC (ISO 9797-1 alg. 3, method 2 padding) over the 13-byte header+cryptogram
    const padded = new Uint8Array(16);
    padded.set(exAuth.slice(0, 13), 0);
    padded[13] = 0x80;

    const first = DES.desCbc(padded.slice(0, 8), this.sessionMac.slice(0, 8));
    const x = new Uint8Array(8);
    for (let i = 0; i < 8; i++) x[i] = first[i] ^ padded[8 + i];
    const mac = DES.tdesCbc(x, this.sessionMac);
    exAuth.set(mac, 13);
    return exAuth;
  }
}
