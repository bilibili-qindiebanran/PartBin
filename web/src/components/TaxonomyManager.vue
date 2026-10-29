<template>
  <div class="taxonomy">
    <div class="taxonomy__bar">
      <span class="taxonomy__hint">
        {{ kind === 'categories' ? '分类用于筛选与组织物料' : '位置按柜 / 层 / 盒组织' }}
      </span>
      <el-button size="small" type="primary" plain @click="openCreate(null)">
        <el-icon><Plus /></el-icon>
        新增根节点
      </el-button>
    </div>

    <div v-loading="loading" class="taxonomy__body">
      <el-tree
        v-if="nodes.length > 0"
        :data="nodes"
        node-key="id"
        default-expand-all
        :expand-on-click-node="false"
        :indent="18"
      >
        <template #default="{ data }">
          <div class="node">
            <span class="node__label">
              {{ data.name }}
              <small v-if="data.code">{{ data.code }}</small>
            </span>
            <span class="node__actions">
              <el-button text size="small" @click.stop="openCreate(data)">子级</el-button>
              <el-button text size="small" @click.stop="openEdit(data)">编辑</el-button>
              <el-button text size="small" type="danger" @click.stop="remove(data)">删除</el-button>
            </span>
          </div>
        </template>
      </el-tree>
      <p v-else class="taxonomy__empty">还没有{{ label }}，先新增一个根节点。</p>
    </div>

    <el-dialog v-model="dialog.visible" :title="dialogTitle" width="min(440px, 92vw)" align-center>
      <div class="stack">
        <p v-if="dialog.parentName" class="parent-hint">上级：{{ dialog.parentName }}</p>
        <el-input
          v-model="dialog.name"
          size="large"
          maxlength="60"
          show-word-limit
          :placeholder="`${label}名称`"
        />
        <template v-if="kind === 'locations'">
          <el-input
            v-model="dialog.code"
            size="large"
            maxlength="40"
            placeholder="位置编号（可选，如 A-3-12）"
          />
          <el-input
            v-model="dialog.note"
            type="textarea"
            :rows="2"
            maxlength="500"
            placeholder="备注（可选）"
          />
        </template>
      </div>
      <template #footer>
        <el-button @click="dialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Plus } from '@element-plus/icons-vue';
import { api } from '@/api/client';
import { useDictionaryStore } from '@/stores/dictionary';

const props = defineProps({
  kind: { type: String, default: 'categories' },
});

const dictionary = useDictionaryStore();
const label = computed(() => (props.kind === 'categories' ? '分类' : '位置'));
const base = computed(() => (props.kind === 'categories' ? '/api/categories' : '/api/locations'));

const nodes = ref([]);
const loading = ref(false);
const saving = ref(false);
const dialog = reactive({
  visible: false,
  mode: 'create',
  id: null,
  parentId: null,
  parentName: '',
  name: '',
  code: '',
  note: '',
});

const dialogTitle = computed(() => {
  if (dialog.mode === 'edit') return `编辑${label.value}`;
  return dialog.parentId ? `新增子${label.value}` : `新增${label.value}`;
});

async function load() {
  loading.value = true;
  try {
    const data = await api(base.value);
    nodes.value = data.data;
  } catch (error) {
    ElMessage.error(error.message || `加载${label.value}失败`);
  } finally {
    loading.value = false;
  }
}

function resetDialog() {
  dialog.id = null;
  dialog.parentId = null;
  dialog.parentName = '';
  dialog.name = '';
  dialog.code = '';
  dialog.note = '';
}

function openCreate(parent) {
  resetDialog();
  dialog.mode = 'create';
  dialog.parentId = parent?.id ?? null;
  dialog.parentName = parent?.path ?? parent?.name ?? '';
  dialog.visible = true;
}

function openEdit(node) {
  resetDialog();
  dialog.mode = 'edit';
  dialog.id = node.id;
  dialog.parentName = node.path;
  dialog.name = node.name;
  dialog.code = node.code ?? '';
  dialog.note = node.note ?? '';
  dialog.visible = true;
}

async function submit() {
  const name = dialog.name.trim();
  if (!name) {
    ElMessage.warning(`请输入${label.value}名称`);
    return;
  }

  const payload = { name };
  if (props.kind === 'locations') {
    payload.code = dialog.code.trim() || null;
    payload.note = dialog.note.trim() || null;
  }

  saving.value = true;
  try {
    if (dialog.mode === 'edit') {
      await api(`${base.value}/${dialog.id}`, { method: 'PATCH', body: payload });
    } else {
      payload.parentId = dialog.parentId;
      await api(base.value, { method: 'POST', body: payload });
    }
    ElMessage.success(dialog.mode === 'edit' ? '已保存' : '已创建');
    dialog.visible = false;
    await load();
    await dictionary.refresh();
  } catch (error) {
    ElMessage.error(error.message || '保存失败');
  } finally {
    saving.value = false;
  }
}

async function remove(node) {
  try {
    await ElMessageBox.confirm(
      props.kind === 'categories'
        ? '删除后，引用它的物料会变为未分类，子分类会变成根节点。'
        : '删除后，引用它的物料会变为无位置，子位置会变成根节点。',
      `删除${label.value}「${node.name}」`,
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );

    const result = await api(`${base.value}/${node.id}`, { method: 'DELETE' });
    ElMessage.success(`已删除，影响物料 ${result.detachedItems} 个`);
    await load();
    await dictionary.refresh();
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    ElMessage.error(error.message || '删除失败');
  }
}

onMounted(load);
</script>

<style scoped>
.taxonomy__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  margin-bottom: var(--space-3);
}

.taxonomy__hint {
  color: var(--ink-400);
  font-size: 12px;
}

.taxonomy__body {
  min-height: 72px;
  padding: var(--space-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  background: #fbfdfd;
}

.taxonomy__empty {
  padding: var(--space-4);
  color: var(--ink-400);
  font-size: 13px;
  text-align: center;
}

.node {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  width: 100%;
  padding: 2px 4px;
}

.node__label {
  min-width: 0;
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.node__label small {
  margin-left: 6px;
  color: var(--ink-400);
  font-size: 11px;
}

.node__actions {
  flex-shrink: 0;
  opacity: 0.55;
  transition: opacity var(--dur-fast) var(--ease-out);
}

.node:hover .node__actions {
  opacity: 1;
}

.stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}

.parent-hint {
  color: var(--ink-600);
  font-size: 12px;
}

@media (max-width: 767px) {
  .taxonomy__bar {
    align-items: flex-start;
    flex-direction: column;
  }

  .node__actions {
    opacity: 1;
  }
}
</style>
