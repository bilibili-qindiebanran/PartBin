<template>
  <div class="scanner">
    <div class="scanner__stage">
      <video ref="videoRef" class="scanner__video" playsinline muted autoplay />
      <canvas ref="canvasRef" class="scanner__canvas" />
      <div class="scanner__reticle" aria-hidden="true" />
      <p v-if="status === 'starting'" class="scanner__hint">正在启动摄像头…</p>
      <p v-else-if="status === 'error'" class="scanner__hint scanner__hint--error">
        {{ errorText }}
      </p>
    </div>
    <p class="scanner__tip">二维码放进方框即可，方框内就是识别区域</p>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import jsQR from 'jsqr';

const emit = defineEmits(['detected']);

const videoRef = ref(null);
const canvasRef = ref(null);
const status = ref('starting');
const errorText = ref('');

/** 取景框在容器里的内缩比例，必须与 .scanner__reticle 的 inset 保持一致 */
const RETICLE_INSET = 0.12;
/** 解码画面上限：分辨率再高也不会让 jsQR 更准，只会更慢 */
const MAX_DECODE_WIDTH = 960;

let stream = null;
let timer = null;
let finished = false;
let frameTick = 0;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** getUserMedia 的常见失败原因 → 中文提示 */
function describeError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return '摄像头权限被拒绝，请在浏览器里允许后重试';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return '没有找到可用的摄像头';
    case 'NotReadableError':
      return '摄像头被其他应用占用，请关闭后重试';
    default:
      return '无法启动摄像头，可以改用手动输入';
  }
}

function stop() {
  finished = true;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  for (const item of stream?.getTracks() ?? []) item.stop();
  stream = null;
  if (videoRef.value) videoRef.value.srcObject = null;
}

/**
 * 把视频里「容器坐标系中的一个矩形」映射回原始像素并画到 canvas。
 * video 用 object-fit: cover 展示，会等比放大并裁掉溢出部分，
 * 所以这里必须按 cover 的缩放关系反算，才能做到「框内所见即所解」。
 */
function drawRegion(video, canvas, box) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const cw = video.clientWidth || 1;
  const ch = video.clientHeight || 1;

  const scale = Math.max(cw / vw, ch / vh);
  const offsetX = (vw * scale - cw) / 2;
  const offsetY = (vh * scale - ch) / 2;

  const sx = clamp((box.x + offsetX) / scale, 0, vw - 1);
  const sy = clamp((box.y + offsetY) / scale, 0, vh - 1);
  const sw = clamp(box.w / scale, 1, vw - sx);
  const sh = clamp(box.h / scale, 1, vh - sy);

  const outW = Math.max(1, Math.round(Math.min(sw, MAX_DECODE_WIDTH)));
  const outH = Math.max(1, Math.round((sh * outW) / sw));

  if (canvas.width !== outW || canvas.height !== outH) {
    canvas.width = outW;
    canvas.height = outH;
  }
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(video, sx, sy, sw, sh, 0, 0, outW, outH);
  return context.getImageData(0, 0, outW, outH);
}

function scanFrame() {
  if (finished) return;
  timer = setTimeout(scanFrame, 150);

  const video = videoRef.value;
  const canvas = canvasRef.value;
  if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return;

  const cw = video.clientWidth || 1;
  const ch = video.clientHeight || 1;
  const inner = {
    x: cw * RETICLE_INSET,
    y: ch * RETICLE_INSET,
    w: cw * (1 - RETICLE_INSET * 2),
    h: ch * (1 - RETICLE_INSET * 2),
  };

  // 主路径：只解码取景框内的原始像素，等效放大，近距离也能出结果
  const image = drawRegion(video, canvas, inner);
  let result = jsQR(image.data, image.width, image.height, {
    inversionAttempts: 'attemptBoth',
  });

  // 兜底：二维码略偏出框时，每 4 帧扫一次全画面（降采样，便宜）
  if (!result && ++frameTick % 4 === 0) {
    const full = drawRegion(video, canvas, { x: 0, y: 0, w: cw, h: ch });
    result = jsQR(full.data, full.width, full.height, {
      inversionAttempts: 'dontInvert',
    });
  }

  if (result?.data) {
    stop();
    status.value = 'found';
    emit('detected', result.data);
  }
}

/** 读取设备的对焦能力；不支持就静默跳过 */
async function prepareTrack(videoTrack) {
  // 连续自动对焦：手机上近距离扫码成败的关键
  try {
    await videoTrack.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
  } catch {
    // 绝大多数桌面摄像头没有 focusMode，忽略
  }
}

async function start() {
  if (!navigator.mediaDevices?.getUserMedia) {
    status.value = 'error';
    errorText.value = '当前浏览器不支持摄像头扫码（需要 HTTPS 访问）';
    return;
  }

  status.value = 'starting';
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        // 与 4:3 的取景框保持一致，避免 object-fit: cover 裁切导致显示与解码错位
        aspectRatio: { ideal: 4 / 3 },
        width: { ideal: 1280 },
        height: { ideal: 960 },
      },
    });
    if (finished) {
      stop();
      return;
    }
    const track = stream.getVideoTracks()[0];
    if (track) prepareTrack(track);

    const video = videoRef.value;
    if (!video) return;
    video.srcObject = stream;
    await video.play().catch(() => {});
    if (finished) return;
    status.value = 'scanning';
    scanFrame();
  } catch (error) {
    status.value = 'error';
    errorText.value = describeError(error);
  }
}

onMounted(start);
onBeforeUnmount(stop);
</script>

<style scoped>
.scanner {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.scanner__stage {
  position: relative;
  overflow: hidden;
  border-radius: 12px;
  background: #0b0f14;
  aspect-ratio: 4 / 3;
}

.scanner__video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.scanner__canvas {
  display: none;
}

.scanner__reticle {
  position: absolute;
  inset: 12%;
  border: 2px solid rgba(255, 255, 255, 0.85);
  border-radius: 12px;
  box-shadow: 0 0 0 999px rgba(0, 0, 0, 0.25);
  pointer-events: none;
}

.scanner__hint {
  position: absolute;
  inset: auto 12px 12px 12px;
  margin: 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 13px;
  text-align: center;
}

.scanner__hint--error {
  background: rgba(190, 30, 45, 0.85);
}

.scanner__tip {
  margin: 0;
  color: var(--ink-600);
  font-size: 12px;
  text-align: center;
}
</style>
