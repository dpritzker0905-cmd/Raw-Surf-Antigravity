// Test fixture (not shipped: nothing in the app imports it). See staticFrameCodec.test.js.
// The SAME bytes backend/tests/test_frame_binary.py pins as encode_frame(GOLDEN_PRODUCT): the two codecs cannot drift.
export const GOLDEN_B64 =
  'UlNXRgEAAQAEAAMADwAAAAAABACoAAAAAAAAAAAAWUAAAAAAAAAkwAAAAAAA4FpAAAAAAAAAAAAAAADAq7XaQQAAAKiWtdpBAAIBAAAAAAD8qfHSTWJQP/yp'
  + '8dJNYlC/AQIBAP////97FK5H4XqEPwAAAAAAAAAAAgIBAP//AAB7FK5H4XqEPwAAAAAAAAAAAwEAAP8AAAAIBAKBQCBwPwAAAAAAAAAAz+MAAwEABukA0gEA'
  + 'AQQAMAAADf0ABwAAT58AUAAAWpEA0jAAEYwARgAAI2kABHUAF0IA2v8AwwEAeCsAAQQAB/8AAgAABQIA/X////7/QAD/vh//';
// The source product's values (height m, direction deg, period s, dir_confidence), row 0 = south; null = land.
export const SOURCE = [
  [0.4617, 44.31, 2.79, 0.9971], [1.25, 359.99, 10.9, 0.5], null, [12.2905, 180.0, 20.1, null],
  [0.0, 0.0, null, 1.0], null, [3.3333, 90.5, 7.07, 0.25], [65.0, 270.25, 0.01, 0.0],
  null, [2.0005, 12.34, 14.0, 0.75], [0.0004, 300.0, 5.55, 0.123], null,
];

export function goldenBuffer(validIso) {
  const bytes = Uint8Array.from(Buffer.from(GOLDEN_B64, 'base64'));
  if (validIso) new DataView(bytes.buffer).setFloat64(56, Date.parse(validIso) / 1000, true);
  return bytes.buffer;
}

