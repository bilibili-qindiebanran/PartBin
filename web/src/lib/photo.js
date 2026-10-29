/** 上传前在浏览器里压缩，最长边 1600px，顺带去掉 EXIF */
export async function compressImage(file, { maxEdge = 1600, quality = 0.8 } = {}) {
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件');

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('图片压缩失败');
  return blob;
}
