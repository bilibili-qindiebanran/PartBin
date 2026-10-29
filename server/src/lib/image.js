/** 允许的图片类型；按魔数校验，不信任 multipart 的 Content-Type */
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const SIGNATURES = [
  {
    mime: 'image/jpeg',
    ext: '.jpg',
    test: (buffer) => buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff,
  },
  {
    mime: 'image/png',
    ext: '.png',
    test: (buffer) =>
      buffer.length > 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47,
  },
  {
    mime: 'image/webp',
    ext: '.webp',
    test: (buffer) =>
      buffer.length > 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP',
  },
];

export function detectImageType(buffer) {
  return SIGNATURES.find((signature) => signature.test(buffer)) ?? null;
}
