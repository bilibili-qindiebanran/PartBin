<template>
  <div class="scanner">
    <div class="scanner__stage">
      <video ref="videoRef" class="scanner__video" playsinline muted autoplay />
      <div class="scanner__reticle" aria-hidden="true" />
      <p v-if="status === 'starting'" class="scanner__hint">正在启动摄像头…</p>
      <p v-else-if="status === 'error'" class="scanner__hint scanner__hint--error">
        {{ errorText }}
      </p>
    </div>
    <p class="scanner__tip">
      二维码放进方框即可自动识别；识别不到时稍微移远或移近一点，会自动换倍率重试
    </p>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { createQrDecoder, WIDTH_LADDER } from '@/lib/qr-decode';

const emit = defineEmits(['detected']);

const videoRef = ref(null);
const status = ref('starting');
const errorText = ref('');

/** 取景框在容器里的内缩比例，必须与 .scanner__reticle 的 inset 保持一致 */
const RETICLE_INSET = 0.12;
/** 每帧间隔。解码要跑多个倍率，比 jsQR 单次略重，120ms 在手机上仍然流畅 */
const FRAME_INTERVAL = 120;
/**
 * 每帧尝试的倍率个数，按实测耗时自适应。
 * 一帧内试得越多收敛越快，但会拖慢渲染；用时间预算把它控在 25ms 左右。
 */
const DECODE_BUDGET_MS = 25;
/** 全画面兜底：二维码跑出取景框时多探一步，每隔几帧做一次 */
const WIDE_INTERVAL = 3;
const WIDE_WIDTHS = [320, 220];

const decoder = createQrDecoder();

let stream = null;
let timer = null;
let finished = false;
let frameTick = 0;
let ladderCursor = 0;
let widthsPerFrame = 2;

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
 * 把视频里「容器坐标系中的一个矩形」映射回原始像素。
 * video 用 object-fit: cover 展示，会等比放大并裁掉溢出部分，
 * 所以这里必须按 cover 的缩放关系反算，才能做到「框内所见即所解」。
 */
function sourceRect(video, box) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const cw = video.clientWidth || 1;
  const ch = video.clientHeight || 1;

  const scale = Math.max(cw / vw, ch / vh);
  const offsetX = (vw * scale - cw) / 2;
  const offsetY = (vh * scale - ch) / 2;

  const x = clamp((box.x + offsetX) / scale, 0, vw - 1);
  const y = clamp((box.y + offsetY) / scale, 0, vh - 1);
  return {
    x,
    y,
    w: clamp(box.w / scale, 1, vw - x),
    h: clamp(box.h / scale, 1, vh - y),
  };
}

/** 从宽度阶梯里取本帧要试的几个倍率，跨帧轮转避免每帧都跑满 */
function pickWidths(count) {
  const picked = [];
  for (let i = 0; i < count; i++) {
    picked.push(WIDTH_LADDER[(ladderCursor + i) % WIDTH_LADDER.length]);
  }
  ladderCursor = (ladderCursor + count) % WIDTH_LADDER.length;
  return picked;
}

function scanFrame() {
  if (finished) return;
  timer = setTimeout(scanFrame, FRAME_INTERVAL);

  const video = videoRef.value;
  if (!video || video.readyState < 2 || !video.videoWidth) return;

  const cw = video.clientWidth || 1;
  const ch = video.clientHeight || 1;
  const reticle = {
    x: cw * RETICLE_INSET,
    y: ch * RETICLE_INSET,
    w: cw * (1 - RETICLE_INSET * 2),
    h: ch * (1 - RETICLE_INSET * 2),
  };

  // 主路径：只解取景框内的像素，倍率跨帧轮转
  const box = sourceRect(video, reticle);
  const startedAt = performance.now();
  let text = decoder.decode(video, box, pickWidths(widthsPerFrame));

  // 按实际耗时调下一帧的采样档数，让单帧解码开销稳定在预算附近
  const cost = performance.now() - startedAt;
  if (cost < DECODE_BUDGET_MS * 0.5) widthsPerFrame = Math.min(6, widthsPerFrame + 1);
  else if (cost > DECODE_BUDGET_MS * 1.2) widthsPerFrame = Math.max(1, widthsPerFrame - 1);

  // 兜底：二维码略偏出框时，隔几帧扫一次全画面（低倍率，便宜）
  if (!text && ++frameTick % WIDE_INTERVAL === 0) {
    text = decoder.decode(
      video,
      { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight },
      WIDE_WIDTHS,
    );
  }

  if (text) {
    stop();
    status.value = 'found';
    emit('detected', text);
  }
}

/** 读取设备的对焦/曝光能力；不支持就静默跳过 */
async function prepareTrack(track) {
  // 连续自动对焦：手机上近距离扫码成败的关键
  try {
    await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
  } catch {
    // 绝大多数桌面摄像头没有 focusMode，忽略
  }
  // 手动曝光时画面容易忽明忽暗，能自动就交给自动
  try {
    const capabilities = track.getCapabilities?.() ?? {};
    if (capabilities.exposureMode?.includes('continuous')) {
      await track.applyConstraints({ advanced: [{ exposureMode: 'continuous' }] });
    }
  } catch {
    // 忽略
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
        // 取高分辨率：解码时会自己降采样，源图更细才能扛住失焦和塑料袋反光
        width: { ideal: 1920 },
        height: { ideal: 1440 },
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
