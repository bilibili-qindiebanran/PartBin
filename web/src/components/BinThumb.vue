<template>
  <div
    class="bin-thumb"
    :class="[`bin-thumb--${size}`, { 'bin-thumb--interactive': interactive }]"
    :style="gridStyle"
    role="img"
    :aria-label="ariaLabel"
  >
    <template v-for="cell in gridCells" :key="`${cell.row}-${cell.col}`">
      <el-tooltip
        v-if="interactive && cell.item"
        :content="cell.title"
        placement="top"
        :show-after="120"
      >
        <span class="bin-thumb__cell is-filled" :class="cellClass(cell)" @click="handleClick(cell, $event)">
          <span v-if="showLetter" class="bin-thumb__letter">{{ cell.label }}</span>
        </span>
      </el-tooltip>
      <span v-else class="bin-thumb__cell" :class="cellClass(cell)" @click="handleClick(cell, $event)">
        <span v-if="showLetter && cell.item" class="bin-thumb__letter">{{ cell.label }}</span>
      </span>
    </template>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  rows: { type: Number, default: 0 },
  cols: { type: Number, default: 0 },
  /** [{ row, col, item }] */
  cells: { type: Array, default: () => [] },
  highlight: { type: Object, default: null },
  size: { type: String, default: 'xs' },
  interactive: { type: Boolean, default: false },
  showLetter: { type: Boolean, default: false },
});

const emit = defineEmits(['cell-click']);

function rowLetter(row) {
  let value = Number(row);
  let text = '';
  while (value > 0) {
    const rest = (value - 1) % 26;
    text = String.fromCharCode(65 + rest) + text;
    value = Math.floor((value - 1) / 26);
  }
  return text;
}

const gridStyle = computed(() => ({
  '--cols': Math.max(1, Number(props.cols) || 1),
  '--rows': Math.max(1, Number(props.rows) || 1),
}));

const cellMap = computed(() => {
  const map = new Map();
  for (const cell of props.cells) {
    if (cell?.row && cell?.col) map.set(`${cell.row}-${cell.col}`, cell);
  }
  return map;
});

const gridCells = computed(() => {
  const rows = Math.max(0, Number(props.rows) || 0);
  const cols = Math.max(0, Number(props.cols) || 0);
  const list = [];
  for (let row = 1; row <= rows; row += 1) {
    for (let col = 1; col <= cols; col += 1) {
      const hit = cellMap.value.get(`${row}-${col}`);
      const item = hit?.item ?? null;
      list.push({
        row,
        col,
        item,
        lowStock: Boolean(item?.lowStock) || Number(item?.quantity ?? 0) === 0,
        label: `${rowLetter(row)}${col}`,
        title: item
          ? `${rowLetter(row)}${col} · ${item.name} · ${item.quantity}${item.unit ?? ''}`
          : `${rowLetter(row)}${col} · 空位`,
      });
    }
  }
  return list;
});

const ariaLabel = computed(() => `${props.rows} 行 ${props.cols} 列元件盒`);

/** 交互模式下自己处理点击，避免同时触发外层「打开盒页」 */
function handleClick(cell, event) {
  if (props.interactive) event.stopPropagation();
  emit('cell-click', cell);
}

function cellClass(cell) {  const classes = {
    'is-empty': !cell.item,
    'is-low': Boolean(cell.item) && cell.lowStock,
  };
  if (
    props.highlight &&
    Number(props.highlight.row) === cell.row &&
    Number(props.highlight.col) === cell.col
  ) {
    classes['is-highlight'] = true;
  }
  return classes;
}
</script>

<style scoped>
.bin-thumb {
  display: grid;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  gap: 2px;
  width: 100%;
}

.bin-thumb__cell {
  position: relative;
  display: block;
  padding-top: 100%;
  border: 1px solid var(--line);
  border-radius: 3px;
  background: #fbfdfd;
}

.bin-thumb__cell.is-filled {
  border-color: rgba(10, 122, 122, 0.35);
  background: rgba(10, 122, 122, 0.18);
}

.bin-thumb__cell.is-low {
  border-color: rgba(214, 154, 21, 0.55);
  background: rgba(214, 154, 21, 0.24);
}

.bin-thumb__cell.is-highlight {
  border-color: var(--primary);
  background: var(--primary);
  box-shadow: 0 0 0 2px rgba(10, 122, 122, 0.28);
}

.bin-thumb__letter {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: var(--primary);
  font-size: 7px;
  font-weight: 600;
  line-height: 1;
}

.bin-thumb__cell.is-highlight .bin-thumb__letter {
  color: #fff;
}

.bin-thumb--xs {
  gap: 1px;
}

.bin-thumb--xs .bin-thumb__cell {
  border-radius: 2px;
}

.bin-thumb--sm {
  max-width: 96px;
}

.bin-thumb--md {
  max-width: 150px;
  gap: 3px;
}

.bin-thumb--md .bin-thumb__cell {
  border-radius: 4px;
}

.bin-thumb--md .bin-thumb__letter {
  font-size: 9px;
}

.bin-thumb--lg {
  gap: 4px;
}

.bin-thumb--lg .bin-thumb__cell {
  border-radius: 5px;
}

.bin-thumb--lg .bin-thumb__letter {
  font-size: 10px;
}

.bin-thumb--interactive .bin-thumb__cell {
  cursor: pointer;
  transition: transform var(--dur-fast) var(--ease-out);
}

.bin-thumb--interactive .bin-thumb__cell:hover {
  transform: scale(1.08);
  z-index: 1;
}
</style>
