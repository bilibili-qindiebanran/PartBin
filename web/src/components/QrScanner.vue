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
    <p class="scanner__tip">把立创标签上的二维码放进方框，识别成功后自动进入预览</p>
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

let stream = null;
let timer = null;
let finished = false;

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
  for (const track of stream?.getTracks() ?? []) track.stop();
  stream = null;
  if (videoRef.value) videoRef.value.srcObject = null;
}

function scanFrame() {
  if (finished) return;
  timer = setTimeout(scanFrame, 150);

  const video = videoRef.value;
  const canvas = canvasRef.value;
  if (!video || !canvas || video.readyState < 2 || !video.videoWidth) return;

  // 缩到 640px 以内再解码，移动端帧率更稳
  const width = Math.min(640, video.videoWidth);
  const height = Math.round((video.videoHeight * width) / video.videoWidth);
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(video, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  const result = jsQR(image.data, width, height, {
    inversionAttempts: 'dontInvert',
  });

  if (result?.data) {
    stop();
    status.value = 'found';
    emit('detected', result.data);
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
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    });
    if (finished) {
      stop();
      return;
    }
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
