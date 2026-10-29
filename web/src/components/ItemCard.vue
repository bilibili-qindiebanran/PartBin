<template>
  <article
    class="item-card"
    :class="{ 'is-low': item.lowStock && !item.isArchived, 'is-archived': item.isArchived }"
    @click="emit('open', item)"
  >
    <div class="item-card__head">
      <span class="thumb"><el-icon><Box /></el-icon></span>
      <div class="item-card__title">
        <strong>{{ item.name }}</strong>
        <small>{{ item.model || item.code || '—' }}</small>
      </div>
      <span class="qty num">
        {{ item.quantity }}
        <small>{{ item.unit }}</small>
      </span>
    </div>

    <p class="item-card__path">
      {{ item.locationPath || '未指定位置' }} · {{ item.categoryPath || '未分类' }}
    </p>

    <div class="item-card__foot">
      <span class="tags">
        <el-tag v-if="item.isArchived" size="small" type="info" round>已归档</el-tag>
        <el-tag v-else-if="item.quantity === 0" size="small" type="danger" round>缺货</el-tag>
        <el-tag v-else-if="item.lowStock" size="small" type="warning" round>低库存</el-tag>
        <el-tag v-if="item.lentQuantity > 0" size="small" type="primary" effect="plain" round>
          借出 {{ item.lentQuantity }}
        </el-tag>
      </span>

      <span v-if="canWrite" class="actions">
        <el-button text size="small" @click.stop="emit('edit', item)">编辑</el-button>
        <el-button
          v-if="item.isArchived"
          text
          size="small"
          @click.stop="emit('restore', item)"
        >
          恢复
        </el-button>
        <el-button v-else text size="small" type="danger" @click.stop="emit('archive', item)">
          归档
        </el-button>
      </span>
    </div>
  </article>
</template>

<script setup>
import { Box } from '@element-plus/icons-vue';

defineProps({
  item: { type: Object, required: true },
  canWrite: { type: Boolean, default: false },
});

const emit = defineEmits(['open', 'edit', 'archive', 'restore']);
</script>

<style scoped>
.item-card {
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  background: #fff;
  box-shadow: var(--shadow-1);
  cursor: pointer;
}

.item-card.is-low {
  box-shadow: inset 3px 0 0 var(--warning);
}

.item-card.is-archived {
  opacity: 0.65;
}

.item-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.thumb {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  background: var(--primary-soft);
  color: var(--primary);
  font-size: 22px;
}

.item-card__title {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  line-height: 1.35;
}

.item-card__title strong {
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-card__title small {
  overflow: hidden;
  color: var(--ink-400);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.qty {
  flex-shrink: 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 1;
}

.qty small {
  color: var(--ink-400);
  font-size: 11px;
  font-weight: 400;
}

.item-card__path {
  margin-top: 10px;
  overflow: hidden;
  color: var(--ink-600);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
  min-height: 26px;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.actions {
  display: flex;
  flex-shrink: 0;
}
</style>
