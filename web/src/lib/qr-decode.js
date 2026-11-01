/**
 * 二维码解码：ZXing + 局部自适应二值化 + 多尺度。
 *
 * 为什么不用 jsQR：
 * 实拍标签常隔着塑料袋，会出现「黑模块发灰、光照不均、高光与阴影并存、轻微失焦」，
 * jsQR 只用一次全局灰度阈值，亮区被判成白、暗区被判成黑，定位角直接丢失。
 * ZXing 的 HybridBinarizer 按 8×8 分块求局部阈值，配合 TRY_HARDER，
 * 对这类图的成功率明显更高。
 *
 * 为什么必须多尺度：
 * 手机摄像头的原始帧里二维码往往偏高分辨率，过采样 + 轻微失焦会让模块边缘糊成
 * 灰过渡带，直接解反而失败；把画面缩到 200~500 px 恰好让每个模块落到
 * 2~6 px 这个解码器最舒服的区间。实测同一张图在原始尺寸下失败、缩到 0.3 倍
 * 却能一次成功，所以这里按宽度阶梯逐级尝试。
 *
 * 为什么加静区：
 * ZXing 需要二维码四周有一圈空白（quiet zone）才能定位。取景框常常贴得很紧，
 * 这里在缩放时统一补一圈白边。
 */

import {
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from '@zxing/library';

/**
 * 逐级尝试的宽度（像素）。
 *
 * 取等比而非等差：解码成败实际取决于「每个模块落到几个像素」，
 * 只有模块被采样到接近整数格时定位角的 1:1:3:1:1 才对得上，所以成功窗口很窄，
 * 大约只有 ±7%。等比 5% 的步长既能保证相邻两档总有落进窗口的，又不会太密。
 * 下限 170 对应「二维码占满取景框」远距离，上限 790 对应近距离。
 */
function buildLadder(min, max, ratio) {
  const widths = [];
  for (let width = min; width <= max; width *= ratio) widths.push(Math.round(width));
  if (widths[widths.length - 1] !== max) widths.push(max);
  return widths;
}

/** 最常见的扫码距离下，二维码在取景框里大约占到的画布宽度 */
const PIVOT_WIDTH = 420;

/**
 * 从 {@link PIVOT_WIDTH} 向两头交替扩散。
 * 常规距离下前几档就能命中，只有贴近或拉远时才需要走到两端。
 */
export const WIDTH_LADDER = buildLadder(170, 790, 1.05).sort(
  (a, b) => Math.abs(a - PIVOT_WIDTH) - Math.abs(b - PIVOT_WIDTH),
);

/** 缩放时四周补的白边比例，用来模拟二维码的静区 */
const QUIET_ZONE_RATIO = 0.06;

/**
 * 创建解码器。
 * 内部持有一个离屏 canvas 与复用的亮度缓冲，避免每帧重新分配。
 */
export function createQrDecoder() {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });

  const reader = new QRCodeReader();
  const hints = new Map();
  hints.set(DecodeHintType.TRY_HARDER, true);
  // 部分标签是深底浅码，必须两种极性都试
  hints.set(DecodeHintType.ALSO_INVERTED, true);

  let luminance = new Int32Array(0);

  /**
   * 把 `source` 上的一块矩形缩放到 `width` 宽，四周补白边后转成 ZXing 需要的亮度数组。
   * 缩放后画布总宽正好等于 `width`，内容占中间的 (1 - 2 * QUIET_ZONE_RATIO)。
   */
  function renderLuminance(source, box, width) {
    const contentWidth = Math.max(1, Math.round(width * (1 - QUIET_ZONE_RATIO * 2)));
    const contentHeight = Math.max(1, Math.round((box.h / box.w) * contentWidth));
    const pad = Math.max(1, Math.round(width * QUIET_ZONE_RATIO));

    canvas.width = contentWidth + pad * 2;
    canvas.height = contentHeight + pad * 2;

    // 先铺白，再居中画缩小的画面 —— 白边就是静区
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      source,
      box.x,
      box.y,
      box.w,
      box.h,
      pad,
      pad,
      contentWidth,
      contentHeight,
    );

    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = canvas.width * canvas.height;
    if (luminance.length !== pixels) luminance = new Int32Array(pixels);
    for (let i = 0, p = 0; i < data.length; i += 4, p++) {
      luminance[p] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
    }
    return { luminance, width: canvas.width, height: canvas.height };
  }

  /** 在给定亮度数组上跑一次 ZXing，成功返回文本，失败返回 null */
  function run(frame, invert) {
    let source = frame.luminance;
    if (invert) {
      source = new Int32Array(frame.luminance.length);
      for (let i = 0; i < source.length; i++) source[i] = 255 - frame.luminance[i];
    }
    try {
      const luminanceSource = new RGBLuminanceSource(source, frame.width, frame.height);
      const bitmap = new BinaryBitmap(new HybridBinarizer(luminanceSource));
      return reader.decode(bitmap, hints).getText() || null;
    } catch {
      // NotFoundException / ChecksumException / FormatException 都属正常失败
      return null;
    }
  }

  /**
   * 在 `source` 的 `box` 区域内，按 `widths` 逐级解码。
   *
   * @param {CanvasImageSource} source 视频帧或 canvas
   * @param {{x:number,y:number,w:number,h:number}} box 源图上的采样矩形（像素）
   * @param {number[]} [widths] 宽度阶梯，默认 {@link WIDTH_LADDER}
   * @returns {string|null} 二维码原文
   */
  function decode(source, box, widths = WIDTH_LADDER) {
    const safeBox = {
      x: Math.max(0, Math.round(box.x)),
      y: Math.max(0, Math.round(box.y)),
      w: Math.max(1, Math.round(box.w)),
      h: Math.max(1, Math.round(box.h)),
    };
    for (const width of widths) {
      const frame = renderLuminance(source, safeBox, width);
      const text = run(frame, false) ?? run(frame, true);
      if (text) return text;
    }
    return null;
  }

  return { decode };
}
