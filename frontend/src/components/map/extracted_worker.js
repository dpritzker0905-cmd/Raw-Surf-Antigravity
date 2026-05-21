/* eslint-disable */
(function() {
  "use strict";
  const SHIFT_LEFT_32 = (1 << 16) * (1 << 16);
  const SHIFT_RIGHT_32 = 1 / SHIFT_LEFT_32;
  const TEXT_DECODER_MIN_LENGTH = 12;
  const utf8TextDecoder = typeof TextDecoder === "undefined" ? null : new TextDecoder("utf-8");
  const PBF_VARINT = 0;
  const PBF_FIXED64 = 1;
  const PBF_BYTES = 2;
  const PBF_FIXED32 = 5;
  class Pbf {
    /**
     * @param {Uint8Array | ArrayBuffer} [buf]
     */
    constructor(buf = new Uint8Array(16)) {
      this.buf = ArrayBuffer.isView(buf) ? buf : new Uint8Array(buf);
      this.dataView = new DataView(this.buf.buffer);
      this.pos = 0;
      this.type = 0;
      this.length = this.buf.length;
    }
    // === READING =================================================================
    /**
     * @template T
     * @param {(tag: number, result: T, pbf: Pbf) => void} readField
     * @param {T} result
     * @param {number} [end]
     */
    readFields(readField, result, end = this.length) {
      while (this.pos < end) {
        const val = this.readVarint(), tag = val >> 3, startPos = this.pos;
        this.type = val & 7;
        readField(tag, result, this);
        if (this.pos === startPos) this.skip(val);
      }
      return result;
    }
    /**
     * @template T
     * @param {(tag: number, result: T, pbf: Pbf) => void} readField
     * @param {T} result
     */
    readMessage(readField, result) {
      return this.readFields(readField, result, this.readVarint() + this.pos);
    }
    readFixed32() {
      const val = this.dataView.getUint32(this.pos, true);
      this.pos += 4;
      return val;
    }
    readSFixed32() {
      const val = this.dataView.getInt32(this.pos, true);
      this.pos += 4;
      return val;
    }
    // 64-bit int handling is based on github.com/dpw/node-buffer-more-ints (MIT-licensed)
    readFixed64() {
      const val = this.dataView.getUint32(this.pos, true) + this.dataView.getUint32(this.pos + 4, true) * SHIFT_LEFT_32;
      this.pos += 8;
      return val;
    }
    readSFixed64() {
      const val = this.dataView.getUint32(this.pos, true) + this.dataView.getInt32(this.pos + 4, true) * SHIFT_LEFT_32;
      this.pos += 8;
      return val;
    }
    readFloat() {
      const val = this.dataView.getFloat32(this.pos, true);
      this.pos += 4;
      return val;
    }
    readDouble() {
      const val = this.dataView.getFloat64(this.pos, true);
      this.pos += 8;
      return val;
    }
    /**
     * @param {boolean} [isSigned]
     */
    readVarint(isSigned) {
      const buf = this.buf;
      let val, b;
      b = buf[this.pos++];
      val = b & 127;
      if (b < 128) return val;
      b = buf[this.pos++];
      val |= (b & 127) << 7;
      if (b < 128) return val;
      b = buf[this.pos++];
      val |= (b & 127) << 14;
      if (b < 128) return val;
      b = buf[this.pos++];
      val |= (b & 127) << 21;
      if (b < 128) return val;
      b = buf[this.pos];
      val |= (b & 15) << 28;
      return readVarintRemainder(val, isSigned, this);
    }
    readVarint64() {
      return this.readVarint(true);
    }
    readSVarint() {
      const num = this.readVarint();
      return num % 2 === 1 ? (num + 1) / -2 : num / 2;
    }
    readBoolean() {
      return Boolean(this.readVarint());
    }
    readString() {
      const end = this.readVarint() + this.pos;
      const pos = this.pos;
      this.pos = end;
      if (end - pos >= TEXT_DECODER_MIN_LENGTH && utf8TextDecoder) {
        return utf8TextDecoder.decode(this.buf.subarray(pos, end));
      }
      return readUtf8(this.buf, pos, end);
    }
    readBytes() {
      const end = this.readVarint() + this.pos, buffer = this.buf.subarray(this.pos, end);
      this.pos = end;
      return buffer;
    }
    // verbose for performance reasons; doesn't affect gzipped size
    /**
     * @param {number[]} [arr]
     * @param {boolean} [isSigned]
     */
    readPackedVarint(arr = [], isSigned) {
      const end = this.readPackedEnd();
      while (this.pos < end) arr.push(this.readVarint(isSigned));
      return arr;
    }
    /** @param {number[]} [arr] */
    readPackedSVarint(arr = []) {
      const end = this.readPackedEnd();
      while (this.pos < end) arr.push(this.readSVarint());
      return arr;
    }
    /** @param {boolean[]} [arr] */
    readPackedBoolean(arr = []) {
      const end = this.readPackedEnd();
      while (this.pos < end) arr.push(this.readBoolean());
      return arr;
    }
    /** @param {number[]} [arr] */
    readPackedFloat(arr = []) {
      const end = this.readPackedEnd();
      while (this.pos < end) arr.push(this.readFloat());
      return arr;
    }
    /** @param {number[]} [arr] */
    readPackedDouble(arr = []) {
      const end = this.readPackedEnd();
      while (this.pos < end) arr.push(this.readDouble());
      return arr;
    }
    /** @param {number[]} [arr] */
    readPackedFixed32(arr = []) {
      const end = this.readPackedEnd();
      while (this.pos < end) arr.push(this.readFixed32());
      return arr;
    }
    /** @param {number[]} [arr] */
    readPackedSFixed32(arr = []) {
      const end = this.readPackedEnd();
      while (this.pos < end) arr.push(this.readSFixed32());
      return arr;
    }
    /** @param {number[]} [arr] */
    readPackedFixed64(arr = []) {
      const end = this.readPackedEnd();
      while (this.pos < end) arr.push(this.readFixed64());
      return arr;
    }
    /** @param {number[]} [arr] */
    readPackedSFixed64(arr = []) {
      const end = this.readPackedEnd();
      while (this.pos < end) arr.push(this.readSFixed64());
      return arr;
    }
    readPackedEnd() {
      return this.type === PBF_BYTES ? this.readVarint() + this.pos : this.pos + 1;
    }
    /** @param {number} val */
    skip(val) {
      const type = val & 7;
      if (type === PBF_VARINT) while (this.buf[this.pos++] > 127) {
      }
      else if (type === PBF_BYTES) this.pos = this.readVarint() + this.pos;
      else if (type === PBF_FIXED32) this.pos += 4;
      else if (type === PBF_FIXED64) this.pos += 8;
      else throw new Error(`Unimplemented type: ${type}`);
    }
    // === WRITING =================================================================
    /**
     * @param {number} tag
     * @param {number} type
     */
    writeTag(tag, type) {
      this.writeVarint(tag << 3 | type);
    }
    /** @param {number} min */
    realloc(min) {
      let length = this.length || 16;
      while (length < this.pos + min) length *= 2;
      if (length !== this.length) {
        const buf = new Uint8Array(length);
        buf.set(this.buf);
        this.buf = buf;
        this.dataView = new DataView(buf.buffer);
        this.length = length;
      }
    }
    finish() {
      this.length = this.pos;
      this.pos = 0;
      return this.buf.subarray(0, this.length);
    }
    /** @param {number} val */
    writeFixed32(val) {
      this.realloc(4);
      this.dataView.setInt32(this.pos, val, true);
      this.pos += 4;
    }
    /** @param {number} val */
    writeSFixed32(val) {
      this.realloc(4);
      this.dataView.setInt32(this.pos, val, true);
      this.pos += 4;
    }
    /** @param {number} val */
    writeFixed64(val) {
      this.realloc(8);
      this.dataView.setInt32(this.pos, val & -1, true);
      this.dataView.setInt32(this.pos + 4, Math.floor(val * SHIFT_RIGHT_32), true);
      this.pos += 8;
    }
    /** @param {number} val */
    writeSFixed64(val) {
      this.realloc(8);
      this.dataView.setInt32(this.pos, val & -1, true);
      this.dataView.setInt32(this.pos + 4, Math.floor(val * SHIFT_RIGHT_32), true);
      this.pos += 8;
    }
    /** @param {number} val */
    writeVarint(val) {
      val = +val || 0;
      if (val > 268435455 || val < 0) {
        writeBigVarint(val, this);
        return;
      }
      this.realloc(4);
      this.buf[this.pos++] = val & 127 | (val > 127 ? 128 : 0);
      if (val <= 127) return;
      this.buf[this.pos++] = (val >>>= 7) & 127 | (val > 127 ? 128 : 0);
      if (val <= 127) return;
      this.buf[this.pos++] = (val >>>= 7) & 127 | (val > 127 ? 128 : 0);
      if (val <= 127) return;
      this.buf[this.pos++] = val >>> 7 & 127;
    }
    /** @param {number} val */
    writeSVarint(val) {
      this.writeVarint(val < 0 ? -val * 2 - 1 : val * 2);
    }
    /** @param {boolean} val */
    writeBoolean(val) {
      this.writeVarint(+val);
    }
    /** @param {string} str */
    writeString(str) {
      str = String(str);
      this.realloc(str.length * 4);
      this.pos++;
      const startPos = this.pos;
      this.pos = writeUtf8(this.buf, str, this.pos);
      const len = this.pos - startPos;
      if (len >= 128) makeRoomForExtraLength(startPos, len, this);
      this.pos = startPos - 1;
      this.writeVarint(len);
      this.pos += len;
    }
    /** @param {number} val */
    writeFloat(val) {
      this.realloc(4);
      this.dataView.setFloat32(this.pos, val, true);
      this.pos += 4;
    }
    /** @param {number} val */
    writeDouble(val) {
      this.realloc(8);
      this.dataView.setFloat64(this.pos, val, true);
      this.pos += 8;
    }
    /** @param {Uint8Array} buffer */
    writeBytes(buffer) {
      const len = buffer.length;
      this.writeVarint(len);
      this.realloc(len);
      for (let i = 0; i < len; i++) this.buf[this.pos++] = buffer[i];
    }
    /**
     * @template T
     * @param {(obj: T, pbf: Pbf) => void} fn
     * @param {T} obj
     */
    writeRawMessage(fn, obj) {
      this.pos++;
      const startPos = this.pos;
      fn(obj, this);
      const len = this.pos - startPos;
      if (len >= 128) makeRoomForExtraLength(startPos, len, this);
      this.pos = startPos - 1;
      this.writeVarint(len);
      this.pos += len;
    }
    /**
     * @template T
     * @param {number} tag
     * @param {(obj: T, pbf: Pbf) => void} fn
     * @param {T} obj
     */
    writeMessage(tag, fn, obj) {
      this.writeTag(tag, PBF_BYTES);
      this.writeRawMessage(fn, obj);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedVarint(tag, arr) {
      if (arr.length) this.writeMessage(tag, writePackedVarint, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedSVarint(tag, arr) {
      if (arr.length) this.writeMessage(tag, writePackedSVarint, arr);
    }
    /**
     * @param {number} tag
     * @param {boolean[]} arr
     */
    writePackedBoolean(tag, arr) {
      if (arr.length) this.writeMessage(tag, writePackedBoolean, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedFloat(tag, arr) {
      if (arr.length) this.writeMessage(tag, writePackedFloat, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedDouble(tag, arr) {
      if (arr.length) this.writeMessage(tag, writePackedDouble, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedFixed32(tag, arr) {
      if (arr.length) this.writeMessage(tag, writePackedFixed32, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedSFixed32(tag, arr) {
      if (arr.length) this.writeMessage(tag, writePackedSFixed32, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedFixed64(tag, arr) {
      if (arr.length) this.writeMessage(tag, writePackedFixed64, arr);
    }
    /**
     * @param {number} tag
     * @param {number[]} arr
     */
    writePackedSFixed64(tag, arr) {
      if (arr.length) this.writeMessage(tag, writePackedSFixed64, arr);
    }
    /**
     * @param {number} tag
     * @param {Uint8Array} buffer
     */
    writeBytesField(tag, buffer) {
      this.writeTag(tag, PBF_BYTES);
      this.writeBytes(buffer);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeFixed32Field(tag, val) {
      this.writeTag(tag, PBF_FIXED32);
      this.writeFixed32(val);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeSFixed32Field(tag, val) {
      this.writeTag(tag, PBF_FIXED32);
      this.writeSFixed32(val);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeFixed64Field(tag, val) {
      this.writeTag(tag, PBF_FIXED64);
      this.writeFixed64(val);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeSFixed64Field(tag, val) {
      this.writeTag(tag, PBF_FIXED64);
      this.writeSFixed64(val);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeVarintField(tag, val) {
      this.writeTag(tag, PBF_VARINT);
      this.writeVarint(val);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeSVarintField(tag, val) {
      this.writeTag(tag, PBF_VARINT);
      this.writeSVarint(val);
    }
    /**
     * @param {number} tag
     * @param {string} str
     */
    writeStringField(tag, str) {
      this.writeTag(tag, PBF_BYTES);
      this.writeString(str);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeFloatField(tag, val) {
      this.writeTag(tag, PBF_FIXED32);
      this.writeFloat(val);
    }
    /**
     * @param {number} tag
     * @param {number} val
     */
    writeDoubleField(tag, val) {
      this.writeTag(tag, PBF_FIXED64);
      this.writeDouble(val);
    }
    /**
     * @param {number} tag
     * @param {boolean} val
     */
    writeBooleanField(tag, val) {
      this.writeVarintField(tag, +val);
    }
  }
  function readVarintRemainder(l, s, p) {
    const buf = p.buf;
    let h, b;
    b = buf[p.pos++];
    h = (b & 112) >> 4;
    if (b < 128) return toNum(l, h, s);
    b = buf[p.pos++];
    h |= (b & 127) << 3;
    if (b < 128) return toNum(l, h, s);
    b = buf[p.pos++];
    h |= (b & 127) << 10;
    if (b < 128) return toNum(l, h, s);
    b = buf[p.pos++];
    h |= (b & 127) << 17;
    if (b < 128) return toNum(l, h, s);
    b = buf[p.pos++];
    h |= (b & 127) << 24;
    if (b < 128) return toNum(l, h, s);
    b = buf[p.pos++];
    h |= (b & 1) << 31;
    if (b < 128) return toNum(l, h, s);
    throw new Error("Expected varint not more than 10 bytes");
  }
  function toNum(low, high, isSigned) {
    return isSigned ? high * 4294967296 + (low >>> 0) : (high >>> 0) * 4294967296 + (low >>> 0);
  }
  function writeBigVarint(val, pbf) {
    let low, high;
    if (val >= 0) {
      low = val % 4294967296 | 0;
      high = val / 4294967296 | 0;
    } else {
      low = ~(-val % 4294967296);
      high = ~(-val / 4294967296);
      if (low ^ 4294967295) {
        low = low + 1 | 0;
      } else {
        low = 0;
        high = high + 1 | 0;
      }
    }
    if (val >= 18446744073709552e3 || val < -18446744073709552e3) {
      throw new Error("Given varint doesn't fit into 10 bytes");
    }
    pbf.realloc(10);
    writeBigVarintLow(low, high, pbf);
    writeBigVarintHigh(high, pbf);
  }
  function writeBigVarintLow(low, high, pbf) {
    pbf.buf[pbf.pos++] = low & 127 | 128;
    low >>>= 7;
    pbf.buf[pbf.pos++] = low & 127 | 128;
    low >>>= 7;
    pbf.buf[pbf.pos++] = low & 127 | 128;
    low >>>= 7;
    pbf.buf[pbf.pos++] = low & 127 | 128;
    low >>>= 7;
    pbf.buf[pbf.pos] = low & 127;
  }
  function writeBigVarintHigh(high, pbf) {
    const lsb = (high & 7) << 4;
    pbf.buf[pbf.pos++] |= lsb | ((high >>>= 3) ? 128 : 0);
    if (!high) return;
    pbf.buf[pbf.pos++] = high & 127 | ((high >>>= 7) ? 128 : 0);
    if (!high) return;
    pbf.buf[pbf.pos++] = high & 127 | ((high >>>= 7) ? 128 : 0);
    if (!high) return;
    pbf.buf[pbf.pos++] = high & 127 | ((high >>>= 7) ? 128 : 0);
    if (!high) return;
    pbf.buf[pbf.pos++] = high & 127 | ((high >>>= 7) ? 128 : 0);
    if (!high) return;
    pbf.buf[pbf.pos++] = high & 127;
  }
  function makeRoomForExtraLength(startPos, len, pbf) {
    const extraLen = len <= 16383 ? 1 : len <= 2097151 ? 2 : len <= 268435455 ? 3 : Math.floor(Math.log(len) / (Math.LN2 * 7));
    pbf.realloc(extraLen);
    for (let i = pbf.pos - 1; i >= startPos; i--) pbf.buf[i + extraLen] = pbf.buf[i];
  }
  function writePackedVarint(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeVarint(arr[i]);
  }
  function writePackedSVarint(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeSVarint(arr[i]);
  }
  function writePackedFloat(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeFloat(arr[i]);
  }
  function writePackedDouble(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeDouble(arr[i]);
  }
  function writePackedBoolean(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeBoolean(arr[i]);
  }
  function writePackedFixed32(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeFixed32(arr[i]);
  }
  function writePackedSFixed32(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeSFixed32(arr[i]);
  }
  function writePackedFixed64(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeFixed64(arr[i]);
  }
  function writePackedSFixed64(arr, pbf) {
    for (let i = 0; i < arr.length; i++) pbf.writeSFixed64(arr[i]);
  }
  function readUtf8(buf, pos, end) {
    let str = "";
    let i = pos;
    while (i < end) {
      const b0 = buf[i];
      let c = null;
      let bytesPerSequence = b0 > 239 ? 4 : b0 > 223 ? 3 : b0 > 191 ? 2 : 1;
      if (i + bytesPerSequence > end) break;
      let b1, b2, b3;
      if (bytesPerSequence === 1) {
        if (b0 < 128) {
          c = b0;
        }
      } else if (bytesPerSequence === 2) {
        b1 = buf[i + 1];
        if ((b1 & 192) === 128) {
          c = (b0 & 31) << 6 | b1 & 63;
          if (c <= 127) {
            c = null;
          }
        }
      } else if (bytesPerSequence === 3) {
        b1 = buf[i + 1];
        b2 = buf[i + 2];
        if ((b1 & 192) === 128 && (b2 & 192) === 128) {
          c = (b0 & 15) << 12 | (b1 & 63) << 6 | b2 & 63;
          if (c <= 2047 || c >= 55296 && c <= 57343) {
            c = null;
          }
        }
      } else if (bytesPerSequence === 4) {
        b1 = buf[i + 1];
        b2 = buf[i + 2];
        b3 = buf[i + 3];
        if ((b1 & 192) === 128 && (b2 & 192) === 128 && (b3 & 192) === 128) {
          c = (b0 & 15) << 18 | (b1 & 63) << 12 | (b2 & 63) << 6 | b3 & 63;
          if (c <= 65535 || c >= 1114112) {
            c = null;
          }
        }
      }
      if (c === null) {
        c = 65533;
        bytesPerSequence = 1;
      } else if (c > 65535) {
        c -= 65536;
        str += String.fromCharCode(c >>> 10 & 1023 | 55296);
        c = 56320 | c & 1023;
      }
      str += String.fromCharCode(c);
      i += bytesPerSequence;
    }
    return str;
  }
  function writeUtf8(buf, str, pos) {
    for (let i = 0, c, lead; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c > 55295 && c < 57344) {
        if (lead) {
          if (c < 56320) {
            buf[pos++] = 239;
            buf[pos++] = 191;
            buf[pos++] = 189;
            lead = c;
            continue;
          } else {
            c = lead - 55296 << 10 | c - 56320 | 65536;
            lead = null;
          }
        } else {
          if (c > 56319 || i + 1 === str.length) {
            buf[pos++] = 239;
            buf[pos++] = 191;
            buf[pos++] = 189;
          } else {
            lead = c;
          }
          continue;
        }
      } else if (lead) {
        buf[pos++] = 239;
        buf[pos++] = 191;
        buf[pos++] = 189;
        lead = null;
      }
      if (c < 128) {
        buf[pos++] = c;
      } else {
        if (c < 2048) {
          buf[pos++] = c >> 6 | 192;
        } else {
          if (c < 65536) {
            buf[pos++] = c >> 12 | 224;
          } else {
            buf[pos++] = c >> 18 | 240;
            buf[pos++] = c >> 12 & 63 | 128;
          }
          buf[pos++] = c >> 6 & 63 | 128;
        }
        buf[pos++] = c & 63 | 128;
      }
    }
    return pos;
  }
  const epsilon = 11102230246251565e-32;
  const splitter = 134217729;
  const resulterrbound = (3 + 8 * epsilon) * epsilon;
  function sum(elen, e, flen, f, h) {
    let Q, Qnew, hh, bvirt;
    let enow = e[0];
    let fnow = f[0];
    let eindex = 0;
    let findex = 0;
    if (fnow > enow === fnow > -enow) {
      Q = enow;
      enow = e[++eindex];
    } else {
      Q = fnow;
      fnow = f[++findex];
    }
    let hindex = 0;
    if (eindex < elen && findex < flen) {
      if (fnow > enow === fnow > -enow) {
        Qnew = enow + Q;
        hh = Q - (Qnew - enow);
        enow = e[++eindex];
      } else {
        Qnew = fnow + Q;
        hh = Q - (Qnew - fnow);
        fnow = f[++findex];
      }
      Q = Qnew;
      if (hh !== 0) {
        h[hindex++] = hh;
      }
      while (eindex < elen && findex < flen) {
        if (fnow > enow === fnow > -enow) {
          Qnew = Q + enow;
          bvirt = Qnew - Q;
          hh = Q - (Qnew - bvirt) + (enow - bvirt);
          enow = e[++eindex];
        } else {
          Qnew = Q + fnow;
          bvirt = Qnew - Q;
          hh = Q - (Qnew - bvirt) + (fnow - bvirt);
          fnow = f[++findex];
        }
        Q = Qnew;
        if (hh !== 0) {
          h[hindex++] = hh;
        }
      }
    }
    while (eindex < elen) {
      Qnew = Q + enow;
      bvirt = Qnew - Q;
      hh = Q - (Qnew - bvirt) + (enow - bvirt);
      enow = e[++eindex];
      Q = Qnew;
      if (hh !== 0) {
        h[hindex++] = hh;
      }
    }
    while (findex < flen) {
      Qnew = Q + fnow;
      bvirt = Qnew - Q;
      hh = Q - (Qnew - bvirt) + (fnow - bvirt);
      fnow = f[++findex];
      Q = Qnew;
      if (hh !== 0) {
        h[hindex++] = hh;
      }
    }
    if (Q !== 0 || hindex === 0) {
      h[hindex++] = Q;
    }
    return hindex;
  }
  function estimate(elen, e) {
    let Q = e[0];
    for (let i = 1; i < elen; i++) Q += e[i];
    return Q;
  }
  function vec(n) {
    return new Float64Array(n);
  }
  const ccwerrboundA = (3 + 16 * epsilon) * epsilon;
  const ccwerrboundB = (2 + 12 * epsilon) * epsilon;
  const ccwerrboundC = (9 + 64 * epsilon) * epsilon * epsilon;
  const B = vec(4);
  const C1 = vec(8);
  const C2 = vec(12);
  const D = vec(16);
  const u = vec(4);
  function orient2dadapt(ax, ay, bx, by, cx, cy, detsum) {
    let acxtail, acytail, bcxtail, bcytail;
    let bvirt, c, ahi, alo, bhi, blo, _i, _j, _0, s1, s0, t1, t0, u3;
    const acx = ax - cx;
    const bcx = bx - cx;
    const acy = ay - cy;
    const bcy = by - cy;
    s1 = acx * bcy;
    c = splitter * acx;
    ahi = c - (c - acx);
    alo = acx - ahi;
    c = splitter * bcy;
    bhi = c - (c - bcy);
    blo = bcy - bhi;
    s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
    t1 = acy * bcx;
    c = splitter * acy;
    ahi = c - (c - acy);
    alo = acy - ahi;
    c = splitter * bcx;
    bhi = c - (c - bcx);
    blo = bcx - bhi;
    t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
    _i = s0 - t0;
    bvirt = s0 - _i;
    B[0] = s0 - (_i + bvirt) + (bvirt - t0);
    _j = s1 + _i;
    bvirt = _j - s1;
    _0 = s1 - (_j - bvirt) + (_i - bvirt);
    _i = _0 - t1;
    bvirt = _0 - _i;
    B[1] = _0 - (_i + bvirt) + (bvirt - t1);
    u3 = _j + _i;
    bvirt = u3 - _j;
    B[2] = _j - (u3 - bvirt) + (_i - bvirt);
    B[3] = u3;
    let det = estimate(4, B);
    let errbound = ccwerrboundB * detsum;
    if (det >= errbound || -det >= errbound) {
      return det;
    }
    bvirt = ax - acx;
    acxtail = ax - (acx + bvirt) + (bvirt - cx);
    bvirt = bx - bcx;
    bcxtail = bx - (bcx + bvirt) + (bvirt - cx);
    bvirt = ay - acy;
    acytail = ay - (acy + bvirt) + (bvirt - cy);
    bvirt = by - bcy;
    bcytail = by - (bcy + bvirt) + (bvirt - cy);
    if (acxtail === 0 && acytail === 0 && bcxtail === 0 && bcytail === 0) {
      return det;
    }
    errbound = ccwerrboundC * detsum + resulterrbound * Math.abs(det);
    det += acx * bcytail + bcy * acxtail - (acy * bcxtail + bcx * acytail);
    if (det >= errbound || -det >= errbound) return det;
    s1 = acxtail * bcy;
    c = splitter * acxtail;
    ahi = c - (c - acxtail);
    alo = acxtail - ahi;
    c = splitter * bcy;
    bhi = c - (c - bcy);
    blo = bcy - bhi;
    s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
    t1 = acytail * bcx;
    c = splitter * acytail;
    ahi = c - (c - acytail);
    alo = acytail - ahi;
    c = splitter * bcx;
    bhi = c - (c - bcx);
    blo = bcx - bhi;
    t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
    _i = s0 - t0;
    bvirt = s0 - _i;
    u[0] = s0 - (_i + bvirt) + (bvirt - t0);
    _j = s1 + _i;
    bvirt = _j - s1;
    _0 = s1 - (_j - bvirt) + (_i - bvirt);
    _i = _0 - t1;
    bvirt = _0 - _i;
    u[1] = _0 - (_i + bvirt) + (bvirt - t1);
    u3 = _j + _i;
    bvirt = u3 - _j;
    u[2] = _j - (u3 - bvirt) + (_i - bvirt);
    u[3] = u3;
    const C1len = sum(4, B, 4, u, C1);
    s1 = acx * bcytail;
    c = splitter * acx;
    ahi = c - (c - acx);
    alo = acx - ahi;
    c = splitter * bcytail;
    bhi = c - (c - bcytail);
    blo = bcytail - bhi;
    s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
    t1 = acy * bcxtail;
    c = splitter * acy;
    ahi = c - (c - acy);
    alo = acy - ahi;
    c = splitter * bcxtail;
    bhi = c - (c - bcxtail);
    blo = bcxtail - bhi;
    t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
    _i = s0 - t0;
    bvirt = s0 - _i;
    u[0] = s0 - (_i + bvirt) + (bvirt - t0);
    _j = s1 + _i;
    bvirt = _j - s1;
    _0 = s1 - (_j - bvirt) + (_i - bvirt);
    _i = _0 - t1;
    bvirt = _0 - _i;
    u[1] = _0 - (_i + bvirt) + (bvirt - t1);
    u3 = _j + _i;
    bvirt = u3 - _j;
    u[2] = _j - (u3 - bvirt) + (_i - bvirt);
    u[3] = u3;
    const C2len = sum(C1len, C1, 4, u, C2);
    s1 = acxtail * bcytail;
    c = splitter * acxtail;
    ahi = c - (c - acxtail);
    alo = acxtail - ahi;
    c = splitter * bcytail;
    bhi = c - (c - bcytail);
    blo = bcytail - bhi;
    s0 = alo * blo - (s1 - ahi * bhi - alo * bhi - ahi * blo);
    t1 = acytail * bcxtail;
    c = splitter * acytail;
    ahi = c - (c - acytail);
    alo = acytail - ahi;
    c = splitter * bcxtail;
    bhi = c - (c - bcxtail);
    blo = bcxtail - bhi;
    t0 = alo * blo - (t1 - ahi * bhi - alo * bhi - ahi * blo);
    _i = s0 - t0;
    bvirt = s0 - _i;
    u[0] = s0 - (_i + bvirt) + (bvirt - t0);
    _j = s1 + _i;
    bvirt = _j - s1;
    _0 = s1 - (_j - bvirt) + (_i - bvirt);
    _i = _0 - t1;
    bvirt = _0 - _i;
    u[1] = _0 - (_i + bvirt) + (bvirt - t1);
    u3 = _j + _i;
    bvirt = u3 - _j;
    u[2] = _j - (u3 - bvirt) + (_i - bvirt);
    u[3] = u3;
    const Dlen = sum(C2len, C2, 4, u, D);
    return D[Dlen - 1];
  }
  function orient2d(ax, ay, bx, by, cx, cy) {
    const detleft = (ay - cy) * (bx - cx);
    const detright = (ax - cx) * (by - cy);
    const det = detleft - detright;
    const detsum = Math.abs(detleft + detright);
    if (Math.abs(det) >= ccwerrboundA * detsum) return det;
    return -orient2dadapt(ax, ay, bx, by, cx, cy, detsum);
  }
  function pointInPolygon(p, polygon) {
    var i;
    var ii;
    var k = 0;
    var f;
    var u1;
    var v1;
    var u2;
    var v2;
    var currentP;
    var nextP;
    var x = p[0];
    var y = p[1];
    var numContours = polygon.length;
    for (i = 0; i < numContours; i++) {
      ii = 0;
      var contour = polygon[i];
      var contourLen = contour.length - 1;
      currentP = contour[0];
      if (currentP[0] !== contour[contourLen][0] && currentP[1] !== contour[contourLen][1]) {
        throw new Error("First and last coordinates in a ring must be the same");
      }
      u1 = currentP[0] - x;
      v1 = currentP[1] - y;
      for (ii; ii < contourLen; ii++) {
        nextP = contour[ii + 1];
        u2 = nextP[0] - x;
        v2 = nextP[1] - y;
        if (v1 === 0 && v2 === 0) {
          if (u2 <= 0 && u1 >= 0 || u1 <= 0 && u2 >= 0) {
            return 0;
          }
        } else if (v2 >= 0 && v1 <= 0 || v2 <= 0 && v1 >= 0) {
          f = orient2d(u1, u2, v1, v2, 0, 0);
          if (f === 0) {
            return 0;
          }
          if (f > 0 && v2 > 0 && v1 <= 0 || f < 0 && v2 <= 0 && v1 > 0) {
            k++;
          }
        }
        currentP = nextP;
        v1 = v2;
        u1 = u2;
      }
    }
    if (k % 2 === 0) {
      return false;
    }
    return true;
  }
  const PI = Math.PI;
  const roundWithPrecision = (value, precision = 1e6) => {
    return Math.round((value + Number.EPSILON) * precision) / precision;
  };
  const degreesToRadians = (degree) => {
    return degree * (PI / 180);
  };
  const radiansToDegrees = (rad) => {
    return rad * (180 / PI);
  };
  const tile2lon = (x, z) => {
    return (x / Math.pow(2, z) * 360 + 360) % 360 - 180;
  };
  const tile2lat = (y, z) => {
    const n = PI - 2 * PI * y / Math.pow(2, z);
    return radiansToDegrees(Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))));
  };
  const lon2tile = (lon, z) => {
    return Math.pow(2, z) * ((lon + 180) / 360);
  };
  const lat2tile = (lat, z) => {
    return Math.pow(2, z) * (1 - Math.log(Math.tan(degreesToRadians(lat)) + 1 / Math.cos(degreesToRadians(lat))) / PI) / 2;
  };
  const modPositive = (n, m) => {
    return (n % m + m) % m;
  };
  const rotatePoint = (cx, cy, theta, x, y) => {
    const xt = Math.cos(theta) * (x - cx) - Math.sin(theta) * (y - cy) + cx;
    const yt = Math.sin(theta) * (x - cx) + Math.cos(theta) * (y - cy) + cy;
    return [xt, yt];
  };
  const sharedPolygonsRingCount = (sp) => sp.offsets.length - 1;
  const sharedPolygonsPolygonCount = (sp) => sp.polygonOffsets.length - 1;
  const sharedPolygonsRing = (sp, i) => {
    const start = sp.offsets[i];
    const end = sp.offsets[i + 1];
    const ring = [];
    for (let j = start; j < end; j += 2) {
      ring.push([sp.coordinates[j], sp.coordinates[j + 1]]);
    }
    return ring;
  };
  const createClippingTester = (clippingOptions) => {
    const sp = clippingOptions?.polygons;
    if (!sp || sp.polygonOffsets.length <= 1) return void 0;
    const polygons = [];
    const numPolygons = sharedPolygonsPolygonCount(sp);
    for (let p = 0; p < numPolygons; p++) {
      const firstRing = sp.polygonOffsets[p];
      const lastRing = sp.polygonOffsets[p + 1];
      const rings = [];
      for (let r = firstRing; r < lastRing; r++) {
        const geoRing = sharedPolygonsRing(sp, r);
        rings.push(geoRing.map(([lon, lat]) => [lon2tile(lon, 0), lat2tile(lat, 0)]));
      }
      polygons.push(rings);
    }
    const bounds = clippingOptions?.bounds;
    const point = [0, 0];
    const fillRule = clippingOptions?.fillRule ?? "nonzero";
    return (lon, lat) => {
      if (bounds) {
        const [minLon, minLat, maxLon, maxLat] = bounds;
        if (lat < minLat || lat > maxLat) return false;
        if (minLon <= maxLon) {
          if (lon < minLon || lon > maxLon) return false;
        } else {
          if (lon > maxLon && lon < minLon) return false;
        }
      }
      point[0] = lon2tile(lon, 0);
      point[1] = lat2tile(lat, 0);
      if (fillRule === "evenodd") {
        let count = 0;
        for (const polygon of polygons) {
          if (pointInPolygon(point, polygon)) count++;
        }
        return count % 2 === 1;
      }
      return polygons.some((polygon) => !!pointInPolygon(point, polygon));
    };
  };
  const clipRasterToPolygons = (canvas, tileSize, z, x, y, clippingOptions) => {
    const sp = clippingOptions.polygons;
    if (!sp) {
      return canvas.transferToImageBitmap();
    }
    const numRings = sharedPolygonsRingCount(sp);
    if (numRings === 0) {
      return canvas.transferToImageBitmap();
    }
    const clipCanvas = new OffscreenCanvas(tileSize, tileSize);
    const clipContext = clipCanvas.getContext("2d");
    if (!clipContext) {
      throw new Error("Could not initialise canvas context");
    }
    clipContext.beginPath();
    for (let r = 0; r < numRings; r++) {
      const ring = sharedPolygonsRing(sp, r);
      for (let i = 0; i < ring.length; i++) {
        const [polyX, polyY] = ring[i];
        const polyXtile = (lon2tile(polyX, z) - x) * tileSize;
        const polyYtile = (lat2tile(polyY, z) - y) * tileSize;
        if (i === 0) {
          clipContext.moveTo(polyXtile, polyYtile);
        } else {
          clipContext.lineTo(polyXtile, polyYtile);
        }
      }
      clipContext.closePath();
    }
    clipContext.clip(clippingOptions.fillRule);
    clipContext.drawImage(canvas, 0, 0);
    return clipCanvas.transferToImageBitmap();
  };
  const VECTOR_TILE_EXTENT = 4096;
  const writeLayer = (layer, pbf) => {
    pbf.writeVarintField(15, layer.version || 2);
    pbf.writeStringField(1, layer.name);
    pbf.writeVarintField(5, layer.extent);
    const context = {
      feature: void 0,
      keys: [],
      values: [],
      keycache: {},
      valuecache: {}
    };
    layer.features.forEach((feat) => {
      context.feature = feat;
      pbf.writeMessage(2, writeFeature, context);
    });
    const keys = context.keys;
    for (let i = 0; i < keys.length; i++) {
      pbf.writeStringField(3, keys[i]);
    }
    const values = context.values;
    for (let i = 0; i < values.length; i++) {
      pbf.writeMessage(4, writeValue, values[i]);
    }
  };
  const writeFeature = (context, pbf) => {
    const feature = context.feature;
    if (feature.id !== void 0) {
      pbf.writeVarintField(1, feature.id);
    }
    pbf.writeMessage(2, writeProperties, context);
    pbf.writeVarintField(3, feature.type);
    pbf.writePackedVarint(4, feature.geom);
  };
  const command = (cmd, length) => {
    return (length << 3) + (cmd & 7);
  };
  const zigzag = (n) => {
    return n << 1 ^ n >> 31;
  };
  const writeProperties = (context, pbf) => {
    const feature = context.feature;
    const keys = context.keys;
    const values = context.values;
    const keycache = context.keycache;
    const valuecache = context.valuecache;
    for (const key in feature.properties) {
      const raw = feature.properties[key];
      if (raw === null) continue;
      let keyIndex = keycache[key];
      if (typeof keyIndex === "undefined") {
        keys.push(key);
        keyIndex = keys.length - 1;
        keycache[key] = keyIndex;
      }
      pbf.writeVarint(keyIndex);
      let storedValue;
      if (typeof raw === "string" || typeof raw === "boolean" || typeof raw === "number") {
        storedValue = raw;
      } else {
        storedValue = JSON.stringify(raw);
      }
      const valueKey = typeof raw + ":" + storedValue;
      let valueIndex = valuecache[valueKey];
      if (typeof valueIndex === "undefined") {
        values.push(storedValue);
        valueIndex = values.length - 1;
        valuecache[valueKey] = valueIndex;
      }
      pbf.writeVarint(valueIndex);
    }
  };
  const writeValue = (value, pbf) => {
    const type = typeof value;
    if (type === "string") {
      pbf.writeStringField(1, value);
    } else if (type === "boolean") {
      pbf.writeBooleanField(7, value);
    } else if (type === "number") {
      const num = value;
      if (num % 1 !== 0) {
        pbf.writeDoubleField(3, num);
      } else if (num < 0) {
        pbf.writeSVarintField(6, num);
      } else {
        pbf.writeVarintField(5, num);
      }
    }
  };
  const generateArrows = (pbf, values, directions, grid, x, y, z, clippingOptions, extent = VECTOR_TILE_EXTENT, arrows = 25) => {
    if (z === 0) {
      arrows = 50;
    }
    if (z === 1) {
      arrows = 40;
    }
    const features = [];
    const size = extent / arrows;
    let cursor = [0, 0];
    const isInsideClip = createClippingTester(clippingOptions);
    for (let tileY = 0; tileY < extent + 1; tileY += size) {
      const lat = tile2lat(y + tileY / extent, z);
      for (let tileX = 0; tileX < extent + 1; tileX += size) {
        const lon = tile2lon(x + tileX / extent, z);
        const center = [tileX, tileY];
        const geom = [];
        if (isInsideClip && !isInsideClip(lon, lat)) {
          continue;
        }
        const speed = grid.getLinearInterpolatedValue(values, lat, lon);
        const direction = degreesToRadians(
          grid.getLinearInterpolatedValue(directions, lat, lon) + 180
        );
        const properties = {
          value: speed,
          direction
        };
        const rotation = direction;
        let length = 0.85;
        if (speed < 20) {
          length = 0.8;
        }
        if (speed < 10) {
          length = 0.75;
        }
        if (speed < 5) {
          length = 0.7;
        }
        if (speed < 3) {
          length = 0.6;
        }
        if (speed < 2) {
          length = 0.55;
        }
        if (speed < 1) {
          length = 0.5;
        }
        const [xt0, yt0] = rotatePoint(
          center[0],
          center[1],
          rotation,
          center[0] - 0.13 * size,
          center[1] - (size * length / 2 - size * 0.22)
        );
        geom.push(command(1, 1));
        geom.push(zigzag(xt0));
        geom.push(zigzag(yt0));
        cursor = [xt0, yt0];
        let [xt1, yt1] = rotatePoint(
          center[0],
          center[1],
          rotation,
          center[0],
          center[1] - size * length / 2
        );
        geom.push(command(2, 1));
        geom.push(zigzag(xt1 - cursor[0]));
        geom.push(zigzag(yt1 - cursor[1]));
        cursor = [xt1, yt1];
        [xt1, yt1] = rotatePoint(
          center[0],
          center[1],
          rotation,
          center[0] + 0.13 * size,
          center[1] - (size * length / 2 - size * 0.22)
        );
        geom.push(command(2, 1));
        geom.push(zigzag(xt1 - cursor[0]));
        geom.push(zigzag(yt1 - cursor[1]));
        cursor = [xt1, yt1];
        [xt1, yt1] = rotatePoint(
          center[0],
          center[1],
          rotation,
          center[0],
          center[1] - size * length / 2
        );
        geom.push(command(1, 1));
        geom.push(zigzag(xt1 - cursor[0]));
        geom.push(zigzag(yt1 - cursor[1]));
        cursor = [xt1, yt1];
        [xt1, yt1] = rotatePoint(
          center[0],
          center[1],
          rotation,
          center[0],
          center[1] + size * length / 2
        );
        geom.push(command(2, 1));
        geom.push(zigzag(xt1 - cursor[0]));
        geom.push(zigzag(yt1 - cursor[1]));
        cursor = [xt1, yt1];
        features.push({
          id: tileX + tileY,
          type: 2,
          // 2 = LineString
          properties,
          geom
        });
      }
    }
    pbf.writeMessage(3, writeLayer, {
      name: "wind-arrows",
      extent,
      features
    });
  };
  const checkAgainstBounds = (point, min, max) => {
    if (max < min) {
      if (point < min && point > max) {
        return true;
      } else {
        return false;
      }
    } else {
      if (point < min || point > max) {
        return true;
      } else {
        return false;
      }
    }
  };
  const CASES = [
    [],
    // 0
    [[[1, 2], [0, 1]]],
    // 1
    [[[2, 1], [1, 2]]],
    // 2
    [[[2, 1], [0, 1]]],
    // 3
    [[[1, 0], [2, 1]]],
    // 4
    [[[1, 2], [0, 1]], [[1, 0], [2, 1]]],
    // 5
    [[[1, 0], [1, 2]]],
    // 6
    [[[1, 0], [0, 1]]],
    // 7
    [[[0, 1], [1, 0]]],
    // 8
    [[[1, 2], [1, 0]]],
    // 9
    [[[0, 1], [1, 0]], [[2, 1], [1, 2]]],
    // 10
    [[[2, 1], [1, 0]]],
    // 11
    [[[0, 1], [2, 1]]],
    // 12
    [[[1, 2], [2, 1]]],
    // 13
    [[[0, 1], [1, 2]]],
    // 14
    []
    // 15
  ];
  class Fragment {
    start;
    end;
    points;
    constructor(start, end) {
      this.start = start;
      this.end = end;
      this.points = [];
      this.append = this.append.bind(this);
      this.prepend = this.prepend.bind(this);
    }
    append(x, y) {
      this.points.push(Math.round(x), Math.round(y));
    }
    prepend(x, y) {
      this.points.splice(0, 0, Math.round(x), Math.round(y));
    }
    lineString() {
      return this.toArray();
    }
    isEmpty() {
      return this.points.length < 2;
    }
    appendFragment(other) {
      this.points.push(...other.points);
      this.end = other.end;
    }
    toArray() {
      return this.points;
    }
  }
  const index = (width, x, y, point) => {
    x = x * 2 + point[0];
    y = y * 2 + point[1];
    return x + y * (width + 1) * 2;
  };
  function interpolate(x, y, point, threshold, multiplier, bld, tld, brd, trd, accept) {
    if (point[0] === 0) {
      accept(multiplier * (x - 1), multiplier * (y - ratio(bld, threshold, tld)));
    } else if (point[0] === 2) {
      accept(multiplier * x, multiplier * (y - ratio(brd, threshold, trd)));
    } else if (point[1] === 0) {
      accept(multiplier * (x - ratio(trd, threshold, tld)), multiplier * (y - 1));
    } else {
      accept(multiplier * (x - ratio(brd, threshold, bld)), multiplier * y);
    }
  }
  const ratio = (a, b, c) => {
    return (b - a) / (c - a);
  };
  const generateContours = (pbf, values, grid, x, y, z, tileSize, intervals, clippingOptions, extent = VECTOR_TILE_EXTENT) => {
    const features = [];
    let cursor = [0, 0];
    const buffer = 1;
    const width = tileSize;
    const height = tileSize;
    const multiplier = extent / width;
    let tld, bld;
    let i, j;
    const segments = {};
    const fragmentByStartByLevel = /* @__PURE__ */ new Map();
    const fragmentByEndByLevel = /* @__PURE__ */ new Map();
    const isInsideClip = createClippingTester(clippingOptions);
    for (i = 1 - buffer; i < height + buffer; i++) {
      const latTop = tile2lat(y + i / height, z);
      const latBottom = tile2lat(y + (i - 1) / height, z);
      const lonBottom = tile2lon(x + (i - 1) / width, z);
      let trd = grid.getLinearInterpolatedValue(values, latBottom, lonBottom);
      let brd = grid.getLinearInterpolatedValue(values, latTop, lonBottom);
      let minR = Math.min(trd, brd);
      let maxR = Math.max(trd, brd);
      for (j = 0 - buffer; j < width + buffer; j++) {
        const lon = tile2lon(x + j / width, z);
        tld = trd;
        bld = brd;
        trd = grid.getLinearInterpolatedValue(values, latBottom, lon);
        brd = grid.getLinearInterpolatedValue(values, latTop, lon);
        const minL = minR;
        const maxL = maxR;
        minR = Math.min(trd, brd);
        maxR = Math.max(trd, brd);
        if (isNaN(tld) || isNaN(trd) || isNaN(brd) || isNaN(bld)) {
          continue;
        }
        if (isInsideClip && !isInsideClip(lon, latBottom)) {
          continue;
        }
        let intervalList;
        if (intervals.length === 1) {
          const interval = intervals[0];
          const min = Math.min(minL, minR);
          const max = Math.max(maxL, maxR);
          const start = Math.ceil(min / interval) * interval;
          const end = Math.floor(max / interval) * interval;
          intervalList = Array.from(
            { length: 1 + (end - start) / interval },
            (_, i2) => start + interval * i2
          );
        } else {
          intervalList = intervals;
        }
        for (const threshold of intervalList) {
          const tl = tld >= threshold;
          const tr = trd >= threshold;
          const bl = bld >= threshold;
          const br = brd >= threshold;
          for (const segment of CASES[(tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0)]) {
            let fragmentByStart = fragmentByStartByLevel.get(threshold);
            if (!fragmentByStart)
              fragmentByStartByLevel.set(threshold, fragmentByStart = /* @__PURE__ */ new Map());
            let fragmentByEnd = fragmentByEndByLevel.get(threshold);
            if (!fragmentByEnd) fragmentByEndByLevel.set(threshold, fragmentByEnd = /* @__PURE__ */ new Map());
            const start = segment[0];
            const end = segment[1];
            const startIndex = index(width + buffer, j, i, start);
            const endIndex = index(width + buffer, j, i, end);
            let f, g;
            if (f = fragmentByEnd.get(startIndex)) {
              fragmentByEnd.delete(startIndex);
              if (g = fragmentByStart.get(endIndex)) {
                fragmentByStart.delete(endIndex);
                if (f === g) {
                  interpolate(j, i, end, threshold, multiplier, bld, tld, brd, trd, f.append);
                  if (!f.isEmpty()) {
                    let list = segments[threshold];
                    if (!list) {
                      segments[threshold] = list = [];
                    }
                    list.push(f.lineString());
                  }
                } else {
                  f.appendFragment(g);
                  fragmentByEnd.set(f.end = g.end, f);
                }
              } else {
                interpolate(j, i, end, threshold, multiplier, bld, tld, brd, trd, f.append);
                fragmentByEnd.set(f.end = endIndex, f);
              }
            } else if (f = fragmentByStart.get(endIndex)) {
              fragmentByStart.delete(endIndex);
              interpolate(j, i, start, threshold, multiplier, bld, tld, brd, trd, f.prepend);
              fragmentByStart.set(f.start = startIndex, f);
            } else {
              const newFrag = new Fragment(startIndex, endIndex);
              interpolate(j, i, start, threshold, multiplier, bld, tld, brd, trd, newFrag.append);
              interpolate(j, i, end, threshold, multiplier, bld, tld, brd, trd, newFrag.append);
              fragmentByStart.set(startIndex, newFrag);
              fragmentByEnd.set(endIndex, newFrag);
            }
          }
        }
      }
    }
    for (const [level, fragmentByStart] of fragmentByStartByLevel.entries()) {
      let list = null;
      for (const value of fragmentByStart.values()) {
        if (!value.isEmpty()) {
          if (list == null) {
            list = segments[level] || (segments[level] = []);
          }
          list.push(value.lineString());
        }
      }
    }
    const levels = segments;
    for (const [level, segments2] of Object.entries(levels)) {
      for (const line of segments2) {
        const geom = [];
        let xt1, yt1;
        geom.push(command(1, 1));
        const [xt0, yt0] = [line[0], line[1]];
        geom.push(zigzag(xt0));
        geom.push(zigzag(yt0));
        cursor = [xt0, yt0];
        for (let i2 = 2; i2 < line.length; i2 = i2 + 2) {
          xt1 = line[i2];
          yt1 = line[i2 + 1];
          geom.push(command(2, 1));
          geom.push(zigzag(xt1 - cursor[0]));
          geom.push(zigzag(yt1 - cursor[1]));
          cursor = [xt1, yt1];
        }
        features.push({
          id: 1e6 + Number(level),
          type: 2,
          // 2 = LineString
          properties: {
            value: level
          },
          geom
        });
      }
    }
    pbf.writeMessage(3, writeLayer, {
      name: "contours",
      extent,
      features
    });
  };
  const tile2lonUnwrapped = (x, z) => {
    return x / Math.pow(2, z) * 360 - 180;
  };
  const generateGridPoints = (pbf, grid, values, directions, x, y, z, clippingOptions, extent = VECTOR_TILE_EXTENT, margin = 0) => {
    const features = [];
    const isInsideClip = createClippingTester(clippingOptions);
    const tileOffsetX = x * extent;
    const tileOffsetY = y * extent;
    const marginFrac = margin / extent;
    const tileBounds = [
      tile2lonUnwrapped(x - marginFrac, z),
      tile2lat(y + 1 + marginFrac, z),
      tile2lonUnwrapped(x + 1 + marginFrac, z),
      tile2lat(y - marginFrac, z)
    ];
    const clippingBounds = clippingOptions?.bounds;
    const iterBounds = clippingBounds ? [
      Math.max(tileBounds[0], clippingBounds[0]),
      Math.max(tileBounds[1], clippingBounds[1]),
      Math.min(tileBounds[2], clippingBounds[2]),
      Math.min(tileBounds[3], clippingBounds[3])
    ] : tileBounds;
    if (iterBounds[0] > iterBounds[2] || iterBounds[1] > iterBounds[3]) {
      pbf.writeMessage(3, writeLayer, { name: "grid", extent, features });
      return;
    }
    grid.forEachPoint(({ index: index2, lat, lon }) => {
      const worldPx = Math.floor(lon2tile(lon, z) * extent);
      const worldPy = Math.floor(lat2tile(lat, z) * extent);
      const px = worldPx - tileOffsetX;
      const py = worldPy - tileOffsetY;
      if (px < -margin || px > extent + margin) return;
      if (py < -margin || py > extent + margin) return;
      const value = values[index2];
      if (isNaN(value)) return;
      if (isInsideClip && !isInsideClip(lon, lat)) {
        return;
      }
      const properties = {};
      properties.value = Number(value.toFixed(2));
      if (directions) {
        properties.direction = directions[index2];
      }
      features.push({
        id: index2,
        type: 1,
        // Point
        properties,
        geom: [command(1, 1), zigzag(px), zigzag(py)]
      });
    }, iterBounds);
    pbf.writeMessage(3, writeLayer, {
      name: "grid",
      extent,
      features
    });
  };
  const COLOR_SCALES = {
    convective_cloud_top: {
      type: "breakpoint",
      unit: "m",
      breakpoints: [0, 500, 1e3, 1500, 2e3, 2500, 3e3, 4e3, 5e3, 6200],
      colors: [
        [192, 57, 43, 0],
        [199, 61, 28, 0.15],
        [205, 70, 14, 0.3],
        [211, 83, 1, 0.375],
        [220, 115, 4, 0.45],
        [231, 152, 8, 0.525],
        [240, 189, 13, 0.6],
        [26, 193, 20, 0.725],
        [26, 166, 157, 0.85],
        [41, 128, 185, 1]
      ]
    },
    geopotential_height: {
      type: "breakpoint",
      unit: "m",
      breakpoints: [4600, 4800, 5e3, 5100, 5200, 5300, 5400, 5500, 5600, 5800, 6e3],
      colors: [
        [46, 139, 122, 0.7],
        [57, 63, 138, 0.7],
        [28, 28, 130, 0.7],
        [8, 42, 115, 0.7],
        [0, 73, 102, 0.7],
        [0, 101, 76, 0.7],
        [0, 100, 21, 0.7],
        [28, 117, 0, 0.7],
        [93, 146, 0, 0.7],
        [154, 97, 0, 0.7],
        [85, 0, 0, 0.7]
      ]
    },
    precipitation: {
      type: "breakpoint",
      unit: "mm",
      breakpoints: [0.01, 0.055, 0.11, 0.255, 0.45, 0.95, 2, 3, 4.95, 7.45, 10, 15, 20, 25, 30],
      colors: [
        [4, 59, 92, 0.091],
        [134, 205, 250, 0.5],
        [130, 203, 250, 0.7],
        [118, 197, 250, 0.717],
        [103, 188, 250, 0.74],
        [64, 161, 251, 0.8],
        [0, 96, 233, 0.814],
        [0, 177, 236, 0.827],
        [0, 241, 141, 0.851],
        [66, 248, 0, 0.879],
        [255, 221, 0, 0.905],
        [255, 111, 0, 0.947],
        [255, 0, 0, 0.976],
        [215, 0, 94, 0.994],
        [175, 0, 153, 1]
      ]
    },
    temperature: {
      type: "breakpoint",
      unit: "°C",
      breakpoints: [
        -80,
        -60,
        -50,
        -40,
        -37.5,
        -35,
        -32.5,
        -30,
        -27.5,
        -25,
        -22.5,
        -20,
        -17.5,
        -15,
        -12.5,
        -10,
        -8,
        -6,
        -4,
        -2,
        0,
        2,
        4,
        6,
        8,
        10,
        12,
        14,
        16,
        18,
        20,
        22,
        24,
        26,
        28,
        30,
        32,
        34,
        36,
        38,
        40,
        42,
        44,
        46,
        48,
        50
      ],
      colors: [
        [26, 242, 221, 1],
        [22, 147, 178, 1],
        [23, 101, 143, 1],
        [47, 17, 189, 1],
        [86, 15, 201, 1],
        [131, 13, 213, 1],
        [181, 10, 226, 1],
        [239, 7, 239, 1],
        [206, 6, 241, 1],
        [171, 5, 243, 1],
        [136, 4, 245, 1],
        [100, 4, 247, 1],
        [64, 3, 249, 1],
        [26, 2, 251, 1],
        [1, 14, 253, 1],
        [0, 52, 255, 1],
        [35, 110, 251, 1],
        [69, 156, 247, 1],
        [102, 192, 245, 1],
        [134, 219, 245, 1],
        [124, 245, 124, 1],
        [90, 244, 90, 1],
        [56, 244, 56, 1],
        [21, 245, 21, 1],
        [7, 224, 7, 1],
        [4, 193, 4, 1],
        [2, 161, 2, 1],
        [0, 128, 0, 1],
        [57, 170, 0, 1],
        [142, 213, 0, 1],
        [255, 255, 0, 1],
        [255, 233, 0, 1],
        [255, 210, 0, 1],
        [255, 188, 0, 1],
        [255, 165, 0, 1],
        [255, 141, 0, 1],
        [255, 118, 0, 1],
        [255, 94, 0, 1],
        [255, 71, 0, 1],
        [255, 47, 0, 1],
        [255, 24, 0, 1],
        [255, 0, 0, 1],
        [228, 0, 10, 1],
        [201, 0, 18, 1],
        [174, 0, 23, 1],
        [147, 0, 26, 1]
      ]
    }
  };
  function findLastIndexLE(arr, value) {
    let lo = 0, hi = arr.length - 1, res = -1;
    while (lo <= hi) {
      const mid = lo + hi >>> 1;
      if (arr[mid] <= value) {
        res = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return res;
  }
  const getColor = (colorScale, px) => {
    switch (colorScale.type) {
      case "rgba": {
        const deltaPerIndex = (colorScale.max - colorScale.min) / colorScale.colors.length;
        const index2 = Math.min(
          colorScale.colors.length - 1,
          Math.max(0, Math.floor((px - colorScale.min) / deltaPerIndex))
        );
        return colorScale.colors[index2];
      }
      case "breakpoint": {
        const index2 = Math.max(0, findLastIndexLE(colorScale.breakpoints, px));
        return colorScale.colors[index2];
      }
      default: {
        const _exhaustive = colorScale;
        throw new Error(`Unknown color scale: ${_exhaustive}`);
      }
    }
  };
  const transformScale = (scale, transform, maybeUnit) => {
    const breakpoints = scale.breakpoints.map(transform);
    const unit = maybeUnit || scale.unit;
    return {
      ...scale,
      breakpoints,
      unit
    };
  };
  ({
    boundary_layer_height: transformScale(
      COLOR_SCALES["convective_cloud_top"],
      (b) => b / 2
    ),
    freezing_level_height: transformScale(
      COLOR_SCALES["temperature"],
      (b) => (b + 20) * 80,
      "m"
    ),
    latent_heat_flux: {
      ...COLOR_SCALES["temperature"]
    },
    sensible_heat_flux: {
      ...COLOR_SCALES["temperature"]
    },
    snow_depth_water_equivalent: transformScale(
      COLOR_SCALES["precipitation"],
      (b) => b * 200
    ),
    visibility: {
      ...COLOR_SCALES["geopotential_height"]
    }
  });
  class GaussianGrid {
    // should always be 1 for gaussian grids!
    ny;
    // nx contains all grid points in a single dimension
    nx;
    // nxStart can be used to read partial data
    // it basically shifts the indices when accessing the data
    nxStart;
    latitudeLines;
    constructor(data, ranges = null) {
      this.latitudeLines = data.gaussianGridLatitudeLines;
      if (!ranges) {
        ranges = [
          { start: 0, end: data.ny },
          { start: 0, end: data.nx }
        ];
      }
      this.nx = data.nx;
      this.nxStart = ranges[1].start;
      this.ny = data.ny;
    }
    getBounds() {
      return [-180, -90, 180, 90];
    }
    getCenter() {
      return { lng: 0, lat: 0 };
    }
    getCoveringRanges(south, _west, north, _east) {
      const northY = this.yLower(north);
      const southY = this.yLower(south) + 2;
      let southX;
      const southIntegral = this.integral(southY);
      if (southY > this.latitudeLines * 2 || southIntegral >= this.nx) {
        southX = this.nx;
      } else {
        southX = this.integral(southY) % this.nx;
      }
      let northX;
      const moduloNorth = this.latitudeLines * 2 % northY;
      if (moduloNorth < 2) {
        northX = 0;
      } else {
        northX = this.integral(northY) % this.nx;
      }
      return [
        { start: 0, end: this.ny },
        { start: northX, end: southX }
      ];
    }
    /**
     * Number of points in the grid
     */
    get count() {
      return 4 * this.latitudeLines * (this.latitudeLines + 9);
    }
    /**
     * Get the number of points in a specific latitude line
     * @param y - The latitude line index
     */
    nxOf(y) {
      return y < this.latitudeLines ? 20 + y * 4 : (2 * this.latitudeLines - y - 1) * 4 + 20;
    }
    integral(y) {
      return y < this.latitudeLines ? 2 * y * y + 18 * y - this.nxStart : this.count - (2 * (2 * this.latitudeLines - y) * (2 * this.latitudeLines - y) + 18 * (2 * this.latitudeLines - y)) - this.nxStart;
    }
    /**
     * Get the latitude and longitude coordinates for a grid point
     */
    /*getCoordinates(gridpoint: number): { latitude: number; longitude: number } {
    		const { y: y, x: x, nx: nx } = this.getPos(gridpoint);
    
    		const dx = 360 / nx;
    		const dy = 180 / (2 * this.latitudeLines + 0.5);
    
    		const lon = x * dx;
    		const adjustedLon = lon >= 180 ? lon - 360 : lon;
    
    		return {
    			latitude: (this.latitudeLines - y - 1) * dy + dy / 2,
    			longitude: adjustedLon
    		};
    	}*/
    /**
     * Find the grid point index for given latitude and longitude
     */
    /*findPoint(lat: number, lon: number): number {
    		const dy = 180 / (2 * this.latitudeLines + 0.5);
    		const y =
    			(Math.round(this.latitudeLines - 1 - (lat - dy / 2) / dy) + 2 * this.latitudeLines) %
    			(2 * this.latitudeLines);
    
    		const nx = this.nxOf(y);
    		const dx = 360 / nx;
    
    		const x = (Math.round(lon / dx) + nx) % nx;
    		return this.integral(y) + x;
    	}*/
    /*getPos(gridpoint: number): { y: number; x: number; nx: number } {
    		const y =
    			gridpoint < this.count / 2
    				? Math.floor((Math.sqrt(2 * gridpoint + 81) - 9) / 2)
    				: 2 * this.latitudeLines -
    					1 -
    					Math.floor((Math.sqrt(2 * (this.count - gridpoint - 1) + 81) - 9) / 2);
    
    		const integral = this.integral(y);
    		const x = gridpoint - integral;
    		const nx = this.nxOf(y);
    
    		return { y, x, nx };
    	}*/
    /// Values is the 1D array of all HRES values (6 million something values)
    getLinearInterpolatedValue(values, lat, lon) {
      const latitudeLines = this.latitudeLines;
      const dy = 180 / (2 * latitudeLines + 0.5);
      const yLower = modPositive(
        Math.floor(latitudeLines - 1 - (lat - dy / 2) / dy),
        2 * latitudeLines
      );
      const yFraction = modPositive(latitudeLines - 1 - (lat - dy / 2) / dy, 1);
      const yUpper = yLower + 1;
      const nxLower = this.nxOf(yLower);
      const nxUpper = this.nxOf(yUpper);
      const dxLower = 360 / nxLower;
      const dxUpper = 360 / nxUpper;
      const xLower0 = modPositive(Math.floor(lon / dxLower), nxLower);
      const xUpper0 = modPositive(Math.floor(lon / dxUpper), nxUpper);
      const integralLower = this.integral(yLower);
      const integralUpper = this.integral(yUpper);
      const xFractionLower = modPositive(lon / dxLower, 1);
      const xFractionUpper = modPositive(lon / dxUpper, 1);
      const p0 = values[integralLower + xLower0];
      const p1 = values[integralLower + (xLower0 + 1) % nxLower];
      const p2 = values[integralUpper + xUpper0];
      const p3 = values[integralUpper + (xUpper0 + 1) % nxUpper];
      const w0 = (1 - xFractionLower) * (1 - yFraction);
      const w1 = xFractionLower * (1 - yFraction);
      const w2 = (1 - xFractionUpper) * yFraction;
      const w3 = xFractionUpper * yFraction;
      const n0 = !isFinite(p0);
      const n1 = !isFinite(p1);
      const n2 = !isFinite(p2);
      const n3 = !isFinite(p3);
      if (!n0 && !n1 && !n2 && !n3) {
        return roundWithPrecision(p0 * w0 + p1 * w1 + p2 * w2 + p3 * w3);
      }
      const xFraction = (1 - yFraction) * xFractionLower + yFraction * xFractionUpper;
      if (n0 && !n1 && !n2 && !n3) {
        if (xFractionLower < xFractionUpper || xFraction + yFraction < 1) return NaN;
        const ws = w1 + w2 + w3;
        return roundWithPrecision((p1 * w1 + p2 * w2 + p3 * w3) / ws);
      }
      if (!n0 && n1 && !n2 && !n3) {
        if (xFractionLower > xFractionUpper || xFraction + 1 - yFraction > 1) return NaN;
        const ws = w0 + w2 + w3;
        return roundWithPrecision((p0 * w0 + p2 * w2 + p3 * w3) / ws);
      }
      if (!n0 && !n1 && n2 && !n3) {
        if (xFractionLower > xFractionUpper || xFraction + 1 - yFraction < 1) return NaN;
        const ws = w0 + w1 + w3;
        return roundWithPrecision((p0 * w0 + p1 * w1 + p3 * w3) / ws);
      }
      if (!n0 && !n1 && !n2 && n3) {
        if (xFractionLower < xFractionUpper || xFraction + yFraction > 1) return NaN;
        const ws = w0 + w1 + w2;
        return roundWithPrecision((p0 * w0 + p1 * w1 + p2 * w2) / ws);
      }
      return NaN;
    }
    /// Values is the 1D array of all HRES values (6 million something values)
    getNearestNeighborValue(values, lat, lon) {
      const latitudeLines = this.latitudeLines;
      const dy = 180 / (2 * latitudeLines + 0.5);
      const y = modPositive(Math.round(latitudeLines - 1 - (lat - dy / 2) / dy), 2 * latitudeLines);
      const nx = this.nxOf(y);
      const dx = 360 / nx;
      const x = modPositive(Math.floor(lon / dx), nx);
      const integral = this.integral(y);
      const index2 = integral + x;
      return values[index2];
    }
    // FIXME: This function might not behave well at the poles!
    yLower(lat) {
      const latitudeLines = this.latitudeLines;
      const dy = 180 / (2 * latitudeLines + 0.5);
      return modPositive(Math.floor(latitudeLines - 1 - (lat - dy / 2) / dy), 2 * latitudeLines);
    }
    forEachPoint(callback, bounds) {
      const dy = 180 / (2 * this.latitudeLines + 0.5);
      for (let y = 0; y < 2 * this.latitudeLines; y++) {
        const lat = (this.latitudeLines - y - 1) * dy + dy / 2;
        if (bounds && (lat < bounds[1] || lat > bounds[3])) continue;
        const nx = this.nxOf(y);
        const dx = 360 / nx;
        const integralY = this.integral(y);
        for (let x = 0; x < nx; x++) {
          const lon = x * dx;
          const adjustedLon = lon >= 180 ? lon - 360 : lon;
          if (bounds && (adjustedLon < bounds[0] || adjustedLon > bounds[2])) continue;
          const index2 = integralY + x;
          const result = callback({ index: index2, lat, lon: adjustedLon });
          if (result === false) return;
        }
      }
    }
  }
  const interpolateLinear = (values, x, y, xFraction, yFraction, nx, longitudeWrap = false) => {
    const index2 = y * nx + x;
    let nextIndex;
    if (longitudeWrap) {
      nextIndex = y * nx + (x + 1) % nx;
    } else {
      nextIndex = index2 + 1;
      if (nextIndex % nx === 0) {
        return NaN;
      }
    }
    if (index2 + nx > values.length) {
      return NaN;
    }
    const p0 = values[index2];
    const p1 = values[nextIndex];
    const p2 = values[index2 + nx];
    const p3 = values[nextIndex + nx];
    const w0 = (1 - xFraction) * (1 - yFraction);
    const w1 = xFraction * (1 - yFraction);
    const w2 = (1 - xFraction) * yFraction;
    const w3 = xFraction * yFraction;
    const n0 = !isFinite(p0);
    const n1 = !isFinite(p1);
    const n2 = !isFinite(p2);
    const n3 = !isFinite(p3);
    if (!n0 && !n1 && !n2 && !n3) {
      return roundWithPrecision(p0 * w0 + p1 * w1 + p2 * w2 + p3 * w3);
    }
    if (n0 && !n1 && !n2 && !n3) {
      if (xFraction + yFraction < 1) return NaN;
      const ws = w1 + w2 + w3;
      return roundWithPrecision((p1 * w1 + p2 * w2 + p3 * w3) / ws);
    }
    if (!n0 && n1 && !n2 && !n3) {
      if (1 - xFraction + yFraction < 1) return NaN;
      const ws = w0 + w2 + w3;
      return roundWithPrecision((p0 * w0 + p2 * w2 + p3 * w3) / ws);
    }
    if (!n0 && !n1 && n2 && !n3) {
      if (xFraction + 1 - yFraction < 1) return NaN;
      const ws = w0 + w1 + w3;
      return roundWithPrecision((p0 * w0 + p1 * w1 + p3 * w3) / ws);
    }
    if (!n0 && !n1 && !n2 && n3) {
      if (1 - xFraction + 1 - yFraction < 1) return NaN;
      const ws = w0 + w1 + w2;
      return roundWithPrecision((p0 * w0 + p1 * w1 + p2 * w2) / ws);
    }
    return NaN;
  };
  function createProjection(opts) {
    switch (opts.name) {
      case "StereographicProjection":
        return new StereographicProjection(opts);
      case "RotatedLatLonProjection":
        return new RotatedLatLonProjection(opts);
      case "LambertConformalConicProjection":
        return new LambertConformalConicProjection(opts);
      case "LambertAzimuthalEqualAreaProjection":
        return new LambertAzimuthalEqualAreaProjection(opts);
      default: {
        const _exhaustive = opts;
        throw new Error(`Unknown projection: ${_exhaustive}`);
      }
    }
  }
  class RotatedLatLonProjection {
    θ;
    ϕ;
    constructor(projectionData) {
      this.θ = degreesToRadians(90 + projectionData.rotatedLat);
      this.ϕ = degreesToRadians(projectionData.rotatedLon);
    }
    forward(latitude, longitude) {
      const lon = degreesToRadians(longitude);
      const lat = degreesToRadians(latitude);
      const x1 = Math.cos(lon) * Math.cos(lat);
      const y1 = Math.sin(lon) * Math.cos(lat);
      const z1 = Math.sin(lat);
      const x2 = Math.cos(this.θ) * Math.cos(this.ϕ) * x1 + Math.cos(this.θ) * Math.sin(this.ϕ) * y1 + Math.sin(this.θ) * z1;
      const y2 = -Math.sin(this.ϕ) * x1 + Math.cos(this.ϕ) * y1;
      const z2 = -Math.sin(this.θ) * Math.cos(this.ϕ) * x1 - Math.sin(this.θ) * Math.sin(this.ϕ) * y1 + Math.cos(this.θ) * z1;
      const x = -1 * radiansToDegrees(Math.atan2(y2, x2));
      const y = -1 * radiansToDegrees(Math.asin(z2));
      return [x, y];
    }
    reverse(x, y) {
      const lon1 = degreesToRadians(x);
      const lat1 = degreesToRadians(y);
      const lat2 = -1 * Math.asin(
        Math.cos(this.θ) * Math.sin(lat1) - Math.cos(lon1) * Math.sin(this.θ) * Math.cos(lat1)
      );
      const lon2 = -1 * (Math.atan2(
        Math.sin(lon1),
        Math.tan(lat1) * Math.sin(this.θ) + Math.cos(lon1) * Math.cos(this.θ)
      ) - this.ϕ);
      const lon = (radiansToDegrees(lon2) + 180) % 360 - 180;
      const lat = radiansToDegrees(lat2);
      return [lat, lon];
    }
  }
  class LambertConformalConicProjection {
    ρ0;
    F;
    n;
    λ0;
    R = 6370.997;
    // Radius of the Earth
    constructor(projectionData) {
      const λ0_dec = projectionData.λ0;
      const ϕ0_dec = projectionData.ϕ0;
      const ϕ1_dec = projectionData.ϕ1;
      const ϕ2_dec = projectionData.ϕ2;
      const radius = projectionData.radius;
      this.λ0 = degreesToRadians((λ0_dec + 180) % 360 - 180);
      const ϕ0 = degreesToRadians(ϕ0_dec);
      const ϕ1 = degreesToRadians(ϕ1_dec);
      const ϕ2 = degreesToRadians(ϕ2_dec);
      if (ϕ1 == ϕ2) {
        this.n = Math.sin(ϕ1);
      } else {
        this.n = Math.log(Math.cos(ϕ1) / Math.cos(ϕ2)) / Math.log(Math.tan(Math.PI / 4 + ϕ2 / 2) / Math.tan(Math.PI / 4 + ϕ1 / 2));
      }
      this.F = Math.cos(ϕ1) * Math.pow(Math.tan(Math.PI / 4 + ϕ1 / 2), this.n) / this.n;
      this.ρ0 = this.F / Math.pow(Math.tan(Math.PI / 4 + ϕ0 / 2), this.n);
      if (radius) {
        this.R = radius;
      }
    }
    forward(latitude, longitude) {
      const ϕ = degreesToRadians(latitude);
      const λ = degreesToRadians(longitude);
      const θ = this.n * (λ - this.λ0);
      const p = this.F / Math.pow(Math.tan(Math.PI / 4 + ϕ / 2), this.n);
      const x = this.R * p * Math.sin(θ);
      const y = this.R * (this.ρ0 - p * Math.cos(θ));
      return [x, y];
    }
    reverse(x, y) {
      const x_scaled = x / this.R;
      const y_scaled = y / this.R;
      const θ = this.n >= 0 ? Math.atan2(x_scaled, this.ρ0 - y_scaled) : Math.atan2(-1 * x_scaled, y_scaled - this.ρ0);
      const ρ = (this.n > 0 ? 1 : -1) * Math.sqrt(Math.pow(x_scaled, 2) + Math.pow(this.ρ0 - y_scaled, 2));
      const ϕ_rad = 2 * Math.atan(Math.pow(this.F / ρ, 1 / this.n)) - Math.PI / 2;
      const λ_rad = this.λ0 + θ / this.n;
      const λ = radiansToDegrees(λ_rad);
      const lat = radiansToDegrees(ϕ_rad);
      const lon = λ > 180 ? λ - 360 : λ;
      return [lat, lon];
    }
  }
  class LambertAzimuthalEqualAreaProjection {
    λ0;
    ϕ1;
    R = 6371229;
    // Radius of the Earth
    constructor(projectionData) {
      const λ0_dec = projectionData.λ0;
      const ϕ1_dec = projectionData.ϕ1;
      const radius = projectionData.radius;
      this.λ0 = degreesToRadians(λ0_dec);
      this.ϕ1 = degreesToRadians(ϕ1_dec);
      if (radius) {
        this.R = radius;
      }
    }
    forward(latitude, longitude) {
      const λ = degreesToRadians(longitude);
      const ϕ = degreesToRadians(latitude);
      const k = Math.sqrt(
        2 / (1 + Math.sin(this.ϕ1) * Math.sin(ϕ) + Math.cos(this.ϕ1) * Math.cos(ϕ) * Math.cos(λ - this.λ0))
      );
      const x = this.R * k * Math.cos(ϕ) * Math.sin(λ - this.λ0);
      const y = this.R * k * (Math.cos(this.ϕ1) * Math.sin(ϕ) - Math.sin(this.ϕ1) * Math.cos(ϕ) * Math.cos(λ - this.λ0));
      return [x, y];
    }
    reverse(x, y) {
      x = x / this.R;
      y = y / this.R;
      const ρ = Math.sqrt(x * x + y * y);
      const c = 2 * Math.asin(0.5 * ρ);
      const ϕ = Math.asin(
        Math.cos(c) * Math.sin(this.ϕ1) + y * Math.sin(c) * Math.cos(this.ϕ1) / ρ
      );
      const λ = this.λ0 + Math.atan(
        x * Math.sin(c) / (ρ * Math.cos(this.ϕ1) * Math.cos(c) - y * Math.sin(this.ϕ1) * Math.sin(c))
      );
      const lat = radiansToDegrees(ϕ);
      const lon = radiansToDegrees(λ);
      return [lat, lon];
    }
  }
  class StereographicProjection {
    λ0;
    // Central longitude
    sinϕ1;
    // Sinus of central latitude
    cosϕ1;
    // Cosine of central latitude
    R = 6371229;
    // Radius of Earth
    constructor(projectionData) {
      this.λ0 = degreesToRadians(projectionData.longitude);
      this.sinϕ1 = Math.sin(degreesToRadians(projectionData.latitude));
      this.cosϕ1 = Math.cos(degreesToRadians(projectionData.latitude));
      if (projectionData.radius) {
        this.R = projectionData.radius;
      }
    }
    forward(latitude, longitude) {
      const ϕ = degreesToRadians(latitude);
      const λ = degreesToRadians(longitude);
      const k = 2 * this.R / (1 + this.sinϕ1 * Math.sin(ϕ) + this.cosϕ1 * Math.cos(ϕ) * Math.cos(λ - this.λ0));
      const x = k * Math.cos(ϕ) * Math.sin(λ - this.λ0);
      const y = k * (this.cosϕ1 * Math.sin(ϕ) - this.sinϕ1 * Math.cos(ϕ) * Math.cos(λ - this.λ0));
      return [x, y];
    }
    reverse(x, y) {
      const p = Math.sqrt(x * x + y * y);
      const c = 2 * Math.atan2(p, 2 * this.R);
      const ϕ = Math.asin(Math.cos(c) * this.sinϕ1 + y * Math.sin(c) * this.cosϕ1 / p);
      const λ = this.λ0 + Math.atan2(x * Math.sin(c), p * this.cosϕ1 * Math.cos(c) - y * this.sinϕ1 * Math.sin(c));
      const lat = radiansToDegrees(ϕ);
      const lon = radiansToDegrees(λ);
      return [lat, lon];
    }
  }
  class ProjectionGrid {
    projection;
    // origin in projected coordinates
    origin;
    dx;
    //meters
    dy;
    //meters
    // minX and minY are the same as origin[0] and origin[1], if the grid is not "reduced" via the ranges
    minX;
    minY;
    nx;
    ny;
    bounds;
    center;
    constructor(data, ranges = null) {
      if (!ranges) {
        ranges = [
          { start: 0, end: data.ny },
          { start: 0, end: data.nx }
        ];
      }
      this.nx = ranges[1].end - ranges[1].start;
      this.ny = ranges[0].end - ranges[0].start;
      switch (data.type) {
        case "projectedFromBounds": {
          this.projection = createProjection(data.projection);
          const sw = this.projection.forward(data.latitudeBounds[0], data.longitudeBounds[0]);
          const ne = this.projection.forward(data.latitudeBounds[1], data.longitudeBounds[1]);
          this.origin = sw;
          this.dx = (ne[0] - sw[0]) / (data.nx - 1);
          this.dy = (ne[1] - sw[1]) / (data.ny - 1);
          break;
        }
        case "projectedFromGeographicOrigin": {
          this.projection = createProjection(data.projection);
          this.origin = this.projection.forward(data.latitude, data.longitude);
          this.dx = data.dx;
          this.dy = data.dy;
          break;
        }
        case "projectedFromProjectedOrigin": {
          this.projection = createProjection(data.projection);
          this.origin = [data.projectedLongitudeOrigin, data.projectedLatitudeOrigin];
          this.dx = data.dx;
          this.dy = data.dy;
          break;
        }
        default: {
          const _exhaustive = data;
          throw new Error(`Unknown projection: ${_exhaustive}`);
        }
      }
      this.minX = this.origin[0] + this.dx * ranges[1].start;
      this.minY = this.origin[1] + this.dy * ranges[0].start;
    }
    getLinearInterpolatedValue(values, lat, lon) {
      const idx = this.findPointInterpolated(lat, lon);
      return interpolateLinear(values, idx.x, idx.y, idx.xFraction, idx.yFraction, this.nx);
    }
    getBounds() {
      if (!this.bounds) {
        const borderPoints = this.getProjectedBorderPoints();
        this.bounds = this.calculateGeographicBounds(borderPoints);
      }
      return this.bounds;
    }
    getCenter() {
      if (!this.center) {
        const bounds = this.getBounds();
        this.center = this.getCenterFromBounds(bounds);
      }
      return this.center;
    }
    getCoveringRanges(south, west, north, east) {
      const dx = this.dx;
      const dy = this.dy;
      const nx = this.nx;
      const ny = this.ny;
      let xPrecision, yPrecision;
      if (String(dx).split(".")[1]) {
        xPrecision = String(dx).split(".")[1].length;
        yPrecision = String(dy).split(".")[1].length;
      } else {
        xPrecision = 2;
        yPrecision = 2;
      }
      let [s, w, n, e] = getProjectedBounds(this.projection, [south, west, north, east]);
      s = Number((s - s % dy).toFixed(yPrecision));
      w = Number((w - w % dx).toFixed(xPrecision));
      n = Number((n - n % dy + dy).toFixed(yPrecision));
      e = Number((e - e % dx + dx).toFixed(xPrecision));
      const originX = this.origin[0];
      const originY = this.origin[1];
      let minX, minY, maxX, maxY;
      if (dx > 0) {
        minX = Math.min(Math.max(Math.floor((w - originX) / dx - 1), 0), nx);
        maxX = Math.max(Math.min(Math.ceil((e - originX) / dx + 1), nx), 0);
      } else {
        minX = Math.min(Math.max(Math.floor((e - originX) / dx - 1), 0), nx);
        maxX = Math.max(Math.min(Math.ceil((w - originX) / dx + 1), nx), 0);
      }
      if (dy > 0) {
        minY = Math.min(Math.max(Math.floor((s - originY) / dy - 1), 0), ny);
        maxY = Math.max(Math.min(Math.ceil((n - originY) / dy + 1), ny), 0);
      } else {
        minY = Math.min(Math.max(Math.floor((n - originY) / dy - 1), 0), ny);
        maxY = Math.max(Math.min(Math.ceil((s - originY) / dy + 1), ny), 0);
      }
      const ranges = [
        { start: minY, end: maxY },
        { start: minX, end: maxX }
      ];
      return ranges;
    }
    findPointInterpolated(lat, lon) {
      const [xPos, yPos] = this.projection.forward(lat, lon);
      const x = (xPos - this.minX) / this.dx;
      const y = (yPos - this.minY) / this.dy;
      const xFraction = x - Math.floor(x);
      const yFraction = y - Math.floor(y);
      if (x < 0 || x >= this.nx || y < 0 || y >= this.ny) {
        return { x: NaN, y: NaN, xFraction: 0, yFraction: 0 };
      }
      return { x: Math.floor(x), y: Math.floor(y), xFraction, yFraction };
    }
    getProjectedBorderPoints() {
      const points = [];
      for (let i = 0; i < this.ny; i++) {
        points.push([this.minX, this.minY + i * this.dy]);
      }
      for (let i = 0; i < this.nx; i++) {
        points.push([this.minX + i * this.dx, this.minY + this.ny * this.dy]);
      }
      for (let i = this.ny; i >= 0; i--) {
        points.push([this.minX + this.nx * this.dx, this.minY + i * this.dy]);
      }
      for (let i = this.nx; i >= 0; i--) {
        points.push([this.minX + i * this.dx, this.minY]);
      }
      return points;
    }
    calculateGeographicBounds(borderPoints) {
      let minLon = 180;
      let minLat = 90;
      let maxLon = -180;
      let maxLat = -90;
      for (const borderPoint of borderPoints) {
        const borderPointLatLon = this.projection.reverse(borderPoint[0], borderPoint[1]);
        const lon = (borderPointLatLon[1] + 180) % 360 - 180;
        const lat = borderPointLatLon[0];
        if (lat < minLat) {
          minLat = lat;
        }
        if (lat > maxLat) {
          maxLat = lat;
        }
        if (lon < minLon) {
          minLon = lon;
        }
        if (lon > maxLon) {
          maxLon = lon;
        }
      }
      return [minLon, minLat, maxLon, maxLat];
    }
    getCenterFromBounds(bounds) {
      return {
        lng: (bounds[2] - bounds[0]) / 2 + bounds[0],
        lat: (bounds[3] - bounds[1]) / 2 + bounds[1]
      };
    }
    forEachPoint(callback, bounds) {
      for (let j = 0; j < this.ny; j++) {
        const projY = this.minY + this.dy * j;
        for (let i = 0; i < this.nx; i++) {
          const projX = this.minX + this.dx * i;
          const [lat, lon] = this.projection.reverse(projX, projY);
          if (bounds) {
            if (lat < bounds[1] || lat > bounds[3] || lon < bounds[0] || lon > bounds[2]) continue;
          }
          const result = callback({ index: j * this.nx + i, lat, lon });
          if (result === false) return;
        }
      }
    }
  }
  const getProjectedBounds = (projection, [south, west, north, east], resolution = 0.01) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const updateBounds = (lat, lon) => {
      const [x, y] = projection.forward(lat, lon);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    };
    const stepsLat = Math.ceil((north - south) / resolution);
    const stepsLon = Math.ceil((east - west) / resolution);
    for (let i = 0; i <= stepsLat; i++) {
      updateBounds(north - i * resolution, east);
      updateBounds(south + i * resolution, west);
    }
    for (let i = 0; i <= stepsLon; i++) {
      updateBounds(north, west + i * resolution);
      updateBounds(south, east - i * resolution);
    }
    return [minY, minX, maxY, maxX];
  };
  class RegularGrid {
    nx;
    ny;
    dx;
    dy;
    bounds;
    longitudeWrap;
    center;
    constructor(data, ranges = null) {
      this.dx = data.dx;
      this.dy = data.dy;
      if (!ranges) {
        ranges = [
          { start: 0, end: data.ny },
          { start: 0, end: data.nx }
        ];
      } else {
        if (ranges[0].start < 0 || ranges[0].start > data.ny || ranges[0].end < 0 || ranges[0].end > data.ny) {
          throw new Error("Invalid y range");
        }
        if (ranges[1].start < 0 || ranges[1].start > data.nx || ranges[1].end < 0 || ranges[1].end > data.nx) {
          throw new Error("Invalid x range");
        }
      }
      this.nx = ranges[1].end - ranges[1].start;
      this.ny = ranges[0].end - ranges[0].start;
      const lonMin = data.lonMin + this.dx * ranges[1].start;
      const latMin = data.latMin + this.dy * ranges[0].start;
      const lonMax = data.lonMin + this.dx * ranges[1].end;
      const latMax = data.latMin + this.dy * ranges[0].end;
      this.bounds = [lonMin, latMin, lonMax, latMax];
      this.longitudeWrap = lonMax - lonMin >= 359.875 ? true : false;
    }
    getLinearInterpolatedValue(values, lat, lon) {
      if (!this.longitudeWrap) {
        if (lon < this.bounds[0] || lon > this.bounds[2]) {
          return NaN;
        }
      }
      if (lat < this.bounds[1] || lat >= this.bounds[3]) {
        return NaN;
      }
      const y = Math.floor((lat - this.bounds[1]) / this.dy);
      const yFraction = (lat - this.bounds[1]) % this.dy / this.dy;
      const x = Math.min(Math.floor((lon - this.bounds[0]) / this.dx), this.nx - 1);
      const dx = this.longitudeWrap && lon >= this.bounds[2] - this.dx ? this.dx * 2 : this.dx;
      const xFraction = (lon - this.bounds[0]) % dx / dx;
      return interpolateLinear(values, x, y, xFraction, yFraction, this.nx, this.longitudeWrap);
    }
    getBounds() {
      return this.bounds;
    }
    getCenter() {
      if (!this.center) {
        this.center = {
          lng: this.bounds[0] + this.dx * (this.nx * 0.5),
          lat: this.bounds[1] + this.dy * (this.ny * 0.5)
        };
      }
      return this.center;
    }
    getCoveringRanges(south, west, north, east) {
      const dx = this.dx;
      const dy = this.dy;
      const nx = this.nx;
      const ny = this.ny;
      let xPrecision, yPrecision;
      if (String(dx).split(".")[1]) {
        xPrecision = String(dx).split(".")[1].length;
        yPrecision = String(dy).split(".")[1].length;
      } else {
        xPrecision = 2;
        yPrecision = 2;
      }
      const originX = this.bounds[0];
      const originY = this.bounds[1];
      const s = Number((south - south % dy).toFixed(yPrecision));
      const w = Number((west - west % dx).toFixed(xPrecision));
      const n = Number((north - north % dy + dy).toFixed(yPrecision));
      const e = Number((east - east % dx + dx).toFixed(xPrecision));
      let minX, minY, maxX, maxY;
      if (s - originY < 0) {
        minY = 0;
      } else {
        minY = Math.floor(Math.max((s - originY) / dy - 1, 0));
      }
      if (w - originX < 0) {
        minX = 0;
      } else {
        minX = Math.floor(Math.max((w - originX) / dx - 1, 0));
      }
      if (n - originY < 0) {
        maxY = ny;
      } else {
        maxY = Math.ceil(Math.min((n - originY) / dy + 1, ny));
      }
      if (e - originX < 0) {
        maxX = nx;
      } else {
        maxX = Math.ceil(Math.min((e - originX) / dx + 1, nx));
      }
      const ranges = [
        { start: minY, end: maxY },
        { start: minX, end: maxX }
      ];
      return ranges;
    }
    forEachPoint(callback, bounds) {
      let jStart = 0, jEnd = this.ny, iStart = 0, iEnd = this.nx;
      if (bounds) {
        const [minLon, minLat, maxLon, maxLat] = bounds;
        jStart = Math.max(0, Math.floor((minLat - this.bounds[1]) / this.dy));
        jEnd = Math.min(this.ny, Math.ceil((maxLat - this.bounds[1]) / this.dy) + 1);
        if (!this.longitudeWrap) {
          iStart = Math.max(0, Math.floor((minLon - this.bounds[0]) / this.dx));
          iEnd = Math.min(this.nx, Math.ceil((maxLon - this.bounds[0]) / this.dx) + 1);
        }
      }
      for (let j = jStart; j < jEnd; j++) {
        const lat = this.bounds[1] + this.dy * j;
        for (let i = iStart; i < iEnd; i++) {
          const lon = this.bounds[0] + this.dx * i;
          const result = callback({ index: j * this.nx + i, lat, lon });
          if (result === false) return;
        }
      }
    }
  }
  class GridFactory {
    static create(data, ranges = null) {
      switch (data.type) {
        case "gaussian":
          return new GaussianGrid(data, ranges);
        case "projectedFromBounds":
        case "projectedFromProjectedOrigin":
        case "projectedFromGeographicOrigin":
          return new ProjectionGrid(data, ranges);
        case "regular":
          return new RegularGrid(data, ranges);
        default: {
          const _exhaustive = data;
          throw new Error(`Unknown grid type: ${_exhaustive}`);
        }
      }
    }
  }
  self.onmessage = async (message) => {
    const key = message.data.key;
    if (message.data.type === "cancel") {
      postMessage({ type: "cancelled", key });
      return;
    }
    const { z, x, y } = message.data.tileIndex;
    const values = message.data.data.values;
    const ranges = message.data.ranges;
    const domain = message.data.dataOptions.domain;
    const tileSize = message.data.renderOptions.tileSize;
    const colorScale = message.data.renderOptions.colorScale;
    const clippingOptions = message.data.clippingOptions;
    if (!values) {
      throw new Error("No values provided");
    }
    if (message.data.type == "getImage") {
      const pixels = tileSize * tileSize;
      const rgba = new Uint8ClampedArray(pixels * 4);
      const grid = GridFactory.create(domain.grid, ranges);
      for (let i = 0; i < tileSize; i++) {
        const lat = tile2lat(y + i / tileSize, z);
        if (clippingOptions?.bounds) {
          if (checkAgainstBounds(lat, clippingOptions.bounds[1], clippingOptions.bounds[3])) continue;
        }
        for (let j = 0; j < tileSize; j++) {
          const ind = j + i * tileSize;
          const lon = tile2lon(x + j / tileSize, z);
          if (clippingOptions?.bounds) {
            if (checkAgainstBounds(lon, clippingOptions.bounds[0], clippingOptions.bounds[2]))
              continue;
          }
          const px = grid.getLinearInterpolatedValue(values, lat, lon);
          if (isFinite(px)) {
            const color = getColor(colorScale, px);
            rgba[4 * ind] = color[0];
            rgba[4 * ind + 1] = color[1];
            rgba[4 * ind + 2] = color[2];
            rgba[4 * ind + 3] = 255 * color[3];
          }
        }
      }
      const imageData = new ImageData(rgba, tileSize, tileSize);
      const canvas = new OffscreenCanvas(tileSize, tileSize);
      const context = canvas.getContext("2d");
      if (!context) {
        throw new Error("Could not initialise canvas context");
      }
      context.putImageData(imageData, 0, 0);
      let imageBitmap;
      if (clippingOptions?.polygons) {
        imageBitmap = clipRasterToPolygons(canvas, tileSize, z, x, y, clippingOptions);
      } else {
        imageBitmap = canvas.transferToImageBitmap();
      }
      postMessage({ type: "returnImage", tile: imageBitmap, key }, { transfer: [imageBitmap] });
    } else if (message.data.type == "getArrayBuffer") {
      const directions = message.data.data.directions;
      const pbf = new Pbf();
      const grid = GridFactory.create(domain.grid, ranges);
      if (message.data.renderOptions.drawGrid) {
        generateGridPoints(pbf, grid, values, directions, x, y, z, clippingOptions);
      }
      if (message.data.renderOptions.drawArrows && directions) {
        generateArrows(pbf, values, directions, grid, x, y, z, clippingOptions);
      }
      if (message.data.renderOptions.drawContours) {
        const intervals = message.data.renderOptions.intervals;
        generateContours(pbf, values, grid, x, y, z, tileSize, intervals, clippingOptions);
      }
      const arrayBuffer = pbf.finish();
      postMessage(
        { type: "returnArrayBuffer", tile: arrayBuffer.buffer, key },
        { transfer: [arrayBuffer.buffer] }
      );
    }
  };
})();
