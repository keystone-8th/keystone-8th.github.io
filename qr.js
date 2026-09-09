/* ============================================================
   Minimal QR encoder - byte mode, versions 1..10, ECC L/M/Q/H.
   Self-contained on purpose: a placard generator must not depend
   on a CDN, and the print sheet has to work offline.
   Structure follows the ISO/IEC 18004 reference algorithm.
   ============================================================ */

var QR = (function () {

  /* ---- ECC tables, indexed [level][version] ---- */
  var ECC_CW = {   // error-correction codewords per block
    L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
    M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
    Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
    H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28]
  };
  var ECC_BLOCKS = {  // number of RS blocks
    L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
    M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
    Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
    H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8]
  };
  var ECC_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  var MAX_VERSION = 10;

  /* ---- GF(256) ---- */
  var EXP = new Array(512), LOG = new Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  function gmul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  function rsGenerator(n) {
    var g = [1];
    for (var i = 0; i < n; i++) {
      var ng = [];
      for (var k = 0; k <= g.length; k++) ng.push(0);
      for (var j = 0; j < g.length; j++) {
        ng[j] ^= g[j];
        ng[j + 1] ^= gmul(g[j], EXP[i]);
      }
      g = ng;
    }
    return g;
  }

  function rsEncode(data, n) {
    var g = rsGenerator(n), res = data.slice(), i, j;
    for (i = 0; i < n; i++) res.push(0);
    for (i = 0; i < data.length; i++) {
      var c = res[i];
      if (c) for (j = 0; j < g.length; j++) res[i + j] ^= gmul(g[j], c);
    }
    return res.slice(data.length);
  }

  /* ---- capacity maths ---- */
  function rawDataModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var na = Math.floor(ver / 7) + 2;
      r -= (25 * na - 10) * na - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }
  function rawCodewords(ver) { return Math.floor(rawDataModules(ver) / 8); }
  function dataCodewords(ver, ecl) { return rawCodewords(ver) - ECC_CW[ecl][ver] * ECC_BLOCKS[ecl][ver]; }

  function alignPositions(ver) {
    if (ver === 1) return [];
    var size = ver * 4 + 17;
    var na = Math.floor(ver / 7) + 2;
    var step = Math.ceil((ver * 4 + 4) / (na * 2 - 2)) * 2;
    var res = [6];
    for (var pos = size - 7; res.length < na; pos -= step) res.splice(1, 0, pos);
    return res;
  }

  /* ---- bit helpers ---- */
  function getBit(v, i) { return ((v >>> i) & 1) !== 0; }

  function utf8Bytes(str) {
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) { out.push(0xC0 | (c >> 6), 0x80 | (c & 63)); }
      else { out.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
    }
    return out;
  }

  /* ---- codeword assembly ---- */
  function buildCodewords(bytes, ver, ecl) {
    var cciBits = ver < 10 ? 8 : 16;
    var bits = [];
    function put(v, n) { for (var i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); }

    put(4, 4);                    // byte mode
    put(bytes.length, cciBits);
    for (var i = 0; i < bytes.length; i++) put(bytes[i], 8);

    var capacity = dataCodewords(ver, ecl) * 8;
    put(0, Math.min(4, capacity - bits.length));   // terminator
    while (bits.length % 8 !== 0) bits.push(0);

    var cw = [];
    for (i = 0; i < bits.length; i += 8) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      cw.push(b);
    }
    var pad = [0xEC, 0x11], p = 0;
    while (cw.length < dataCodewords(ver, ecl)) cw.push(pad[p++ % 2]);
    return cw;
  }

  /* ---- ECC + interleave ---- */
  function interleave(data, ver, ecl) {
    var numBlocks = ECC_BLOCKS[ecl][ver], eccLen = ECC_CW[ecl][ver];
    var raw = rawCodewords(ver);
    var numShort = numBlocks - raw % numBlocks;
    var shortLen = Math.floor(raw / numBlocks);

    var blocks = [], k = 0;
    for (var i = 0; i < numBlocks; i++) {
      var len = shortLen - eccLen + (i < numShort ? 0 : 1);
      var dat = data.slice(k, k + len);
      k += len;
      var ecc = rsEncode(dat, eccLen);
      if (i < numShort) dat = dat.concat([0]);      // pad marker, skipped on output
      blocks.push(dat.concat(ecc));
    }

    var out = [];
    for (i = 0; i < blocks[0].length; i++) {
      for (var j = 0; j < blocks.length; j++) {
        if (i !== shortLen - eccLen || j >= numShort) out.push(blocks[j][i]);
      }
    }
    return out;
  }

  /* ---- matrix ---- */
  function makeMatrix(ver, ecl, codewords) {
    var size = ver * 4 + 17;
    var mod = [], fn = [], y, x;
    for (y = 0; y < size; y++) { mod.push(new Array(size).fill(false)); fn.push(new Array(size).fill(false)); }

    function setFn(x, y, dark) {
      if (x < 0 || x >= size || y < 0 || y >= size) return;
      mod[y][x] = dark; fn[y][x] = true;
    }
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy));
        setFn(cx + dx, cy + dy, d !== 2 && d !== 4);
      }
    }

    // Timing first: the finder patterns legitimately overwrite part of it.
    for (var i = 0; i < size; i++) { setFn(6, i, i % 2 === 0); setFn(i, 6, i % 2 === 0); }

    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

    var ap = alignPositions(ver);
    for (i = 0; i < ap.length; i++) for (var j = 0; j < ap.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0)) continue;
      for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++)
        setFn(ap[j] + dx, ap[i] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }

    // reserve format areas (values written after masking)
    for (i = 0; i <= 8; i++) { if (i === 6) continue; setFn(8, i, false); setFn(i, 8, false); }
    for (i = 0; i < 8; i++) { setFn(size - 1 - i, 8, false); setFn(8, size - 8 + i, false); }
    setFn(8, size - 8, true);   // permanent dark module

    if (ver >= 7) {
      var vd = ver << 12, rem = ver;
      for (i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
      var vbits = (vd | rem) >>> 0;
      for (i = 0; i < 18; i++) {
        var bit = getBit(vbits, i), a = size - 11 + i % 3, b = Math.floor(i / 3);
        setFn(a, b, bit); setFn(b, a, bit);
      }
    }

    /* data placement, zigzag from bottom-right */
    var bitIdx = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var jj = 0; jj < 2; jj++) {
          var xx = right - jj;
          var upward = ((right + 1) & 2) === 0;
          var yy = upward ? size - 1 - vert : vert;
          if (!fn[yy][xx] && bitIdx < codewords.length * 8) {
            mod[yy][xx] = getBit(codewords[bitIdx >>> 3], 7 - (bitIdx & 7));
            bitIdx++;
          }
        }
      }
    }
    return { size: size, mod: mod, fn: fn };
  }

  function applyMask(m, mask) {
    for (var y = 0; y < m.size; y++) for (var x = 0; x < m.size; x++) {
      if (m.fn[y][x]) continue;
      var inv;
      switch (mask) {
        case 0: inv = (x + y) % 2 === 0; break;
        case 1: inv = y % 2 === 0; break;
        case 2: inv = x % 3 === 0; break;
        case 3: inv = (x + y) % 3 === 0; break;
        case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
        case 5: inv = (x * y) % 2 + (x * y) % 3 === 0; break;
        case 6: inv = ((x * y) % 2 + (x * y) % 3) % 2 === 0; break;
        case 7: inv = ((x + y) % 2 + (x * y) % 3) % 2 === 0; break;
      }
      if (inv) m.mod[y][x] = !m.mod[y][x];
    }
  }

  function drawFormat(m, ecl, mask) {
    var data = (ECC_BITS[ecl] << 3) | mask, rem = data;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    var bits = ((data << 10) | rem) ^ 0x5412;

    for (i = 0; i <= 5; i++) m.mod[i][8] = getBit(bits, i);
    m.mod[7][8] = getBit(bits, 6);
    m.mod[8][8] = getBit(bits, 7);
    m.mod[8][7] = getBit(bits, 8);
    for (i = 9; i < 15; i++) m.mod[8][14 - i] = getBit(bits, i);

    for (i = 0; i < 8; i++) m.mod[8][m.size - 1 - i] = getBit(bits, i);
    for (i = 8; i < 15; i++) m.mod[m.size - 15 + i][8] = getBit(bits, i);
    m.mod[m.size - 8][8] = true;
  }

  function penalty(m) {
    var s = m.size, mod = m.mod, p = 0, x, y, i, run, dark = 0;

    for (y = 0; y < s; y++) {           // rule 1 - rows
      run = 1;
      for (x = 1; x < s; x++) {
        if (mod[y][x] === mod[y][x - 1]) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; }
        else run = 1;
      }
    }
    for (x = 0; x < s; x++) {           // rule 1 - columns
      run = 1;
      for (y = 1; y < s; y++) {
        if (mod[y][x] === mod[y - 1][x]) { run++; if (run === 5) p += 3; else if (run > 5) p += 1; }
        else run = 1;
      }
    }
    for (y = 0; y < s - 1; y++) for (x = 0; x < s - 1; x++) {   // rule 2
      var v = mod[y][x];
      if (v === mod[y][x + 1] && v === mod[y + 1][x] && v === mod[y + 1][x + 1]) p += 3;
    }
    var pat1 = [true, false, true, true, true, false, true, false, false, false, false];
    var pat2 = [false, false, false, false, true, false, true, true, true, false, true];
    function matches(get, len) {
      var n = 0;
      for (var a = 0; a + 11 <= len; a++) {
        var ok1 = true, ok2 = true;
        for (var b = 0; b < 11; b++) {
          if (get(a + b) !== pat1[b]) ok1 = false;
          if (get(a + b) !== pat2[b]) ok2 = false;
        }
        if (ok1) n++;
        if (ok2) n++;
      }
      return n;
    }
    for (y = 0; y < s; y++) p += 40 * matches(function (i) { return mod[y][i]; }, s);   // rule 3
    for (x = 0; x < s; x++) p += 40 * matches(function (i) { return mod[i][x]; }, s);

    for (y = 0; y < s; y++) for (x = 0; x < s; x++) if (mod[y][x]) dark++;              // rule 4
    var pct = dark * 100 / (s * s);
    p += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return p;
  }

  /* ---- public ---- */
  function encode(text, ecl, forceMask) {
    ecl = ecl || "M";
    var bytes = utf8Bytes(text), ver = 0;
    for (var v = 1; v <= MAX_VERSION; v++) {
      var cci = v < 10 ? 8 : 16;
      if (4 + cci + bytes.length * 8 <= dataCodewords(v, ecl) * 8) { ver = v; break; }
    }
    if (!ver) throw new Error("Payload too long for version <= " + MAX_VERSION + " at ECC " + ecl +
                              " (" + bytes.length + " bytes). Shorten the URL.");

    var cw = interleave(buildCodewords(bytes, ver, ecl), ver, ecl);

    var best = null, bestScore = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      if (forceMask !== undefined && forceMask !== null && mask !== forceMask) continue;
      var m = makeMatrix(ver, ecl, cw);
      applyMask(m, mask);
      drawFormat(m, ecl, mask);
      var sc = penalty(m);
      if (sc < bestScore) { bestScore = sc; best = m; best.mask = mask; best.score = sc; }
    }
    best.version = ver; best.ecl = ecl; best.bytes = bytes.length;
    return best;
  }

  /* SVG at 1 module = 1 unit; caller scales. quiet zone of 4 is mandatory. */
  function svg(text, opts) {
    opts = opts || {};
    var m = encode(text, opts.ecc || "M", opts.mask);
    var q = opts.quiet === undefined ? 4 : opts.quiet;
    var dim = m.size + q * 2;
    var d = [];
    for (var y = 0; y < m.size; y++) {
      for (var x = 0; x < m.size; x++) {
        if (m.mod[y][x]) d.push("M" + (x + q) + " " + (y + q) + "h1v1h-1z");
      }
    }
    return {
      version: m.version, ecl: m.ecl, mask: m.mask, size: m.size, bytes: m.bytes,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + dim + ' ' + dim + '" ' +
           'shape-rendering="crispEdges" role="img">' +
           '<rect width="' + dim + '" height="' + dim + '" fill="#fff"/>' +
           '<path d="' + d.join("") + '" fill="#000"/></svg>'
    };
  }

  return { encode: encode, svg: svg, dataCodewords: dataCodewords, MAX_VERSION: MAX_VERSION };
})();

if (typeof module !== "undefined" && module.exports) module.exports = QR;
