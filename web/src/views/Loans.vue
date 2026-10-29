<template>
  <div class="page">
    <PageHeader title="借出" :subtitle="`共 ${total} 条记录`" />

    <div class="tabs">
      <el-radio-group v-model="status">
        <el-radio-button value="open">未还</el-radio-button>
        <el-radio-button value="overdue">逾期</el-radio-button>
        <el-radio-button value="closed">已还</el-radio-button>
      </el-radio-group>
    </div>

    <div v-if="isMobile" v-loading="loading" class="cards">
      <article v-for="loan in loans" :key="loan.id" class="loan-card card">
        <div class="loan-card__head">
          <strong>{{ loan.itemName }}</strong>
          <el-tag v-if="loan.overdue" size="small" type="danger" round>逾期</el-tag>
          <el-tag v-else-if="loan.remaining > 0" size="small" type="primary" round effect="plain">
            未还
          </el-tag>
          <el-tag v-else size="small" type="success" round effect="plain">已还</el-tag>
        </div>
        <p class="loan-card__meta">
          借用人 {{ loan.borrower }} · 未还
          <strong class="num">{{ loan.remaining }}</strong> / {{ loan.quantity }}
          {{ loan.unit }}
        </p>
        <p class="loan-card__meta">
          借出 {{ formatDate(loan.borrowedAt) }}
          <span v-if="loan.dueAt"> · 应还 {{ formatDate(loan.dueAt) }}</span>
        </p>
        <p v-if="loan.note" class="loan-card__note">{{ loan.note }}</p>
        <div v-if="loan.remaining > 0 || loan.returnedQuantity === 0" class="loan-card__actions">
          <el-button v-if="loan.remaining > 0" size="small" type="primary" @click="openReturn(loan)">
            归还
          </el-button>
          <el-button
            v-if="loan.returnedQuantity === 0"
            size="small"
            text
            type="danger"
            @click="cancelLoan(loan)"
          >
            撤销
          </el-button>
        </div>
      </article>
    </div>

    <div v-else class="table-wrap card">
      <el-table v-loading="loading" :data="loans" empty-text="暂无记录">
        <el-table-column prop="borrower" label="借用人" width="110" />
        <el-table-column label="物料" min-width="180">
          <template #default="{ row }">
            <div class="item-name">
              <span>{{ row.itemName }}</span>
              <small v-if="row.instanceAssetNo">{{ row.instanceAssetNo }}</small>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="未还 / 总数" width="120" align="right">
          <template #default="{ row }">
            <strong class="num">{{ row.remaining }}</strong>
            <span class="muted"> / {{ row.quantity }} {{ row.unit }}</span>
          </template>
        </el-table-column>
        <el-table-column label="借出时间" width="120">
          <template #default="{ row }">{{ formatDate(row.borrowedAt) }}</template>
        </el-table-column>
        <el-table-column label="预计归还" width="120">
          <template #default="{ row }">
            <span :class="{ overdue: row.overdue }">{{ formatDate(row.dueAt) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.overdue" size="small" type="danger" round>逾期</el-tag>
            <el-tag v-else-if="row.remaining > 0" size="small" type="primary" round effect="plain">
              未还
            </el-tag>
            <el-tag v-else size="small" type="success" round effect="plain">已还</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="160" align="right">
          <template #default="{ row }">
            <el-button v-if="row.remaining > 0" text size="small" type="primary" @click="openReturn(row)">
              归还
            </el-button>
            <el-button
              v-if="row.returnedQuantity === 0"
              text
              size="small"
              type="danger"
              @click="cancelLoan(row)"
            >
              撤销
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <EmptyState
      v-if="!loading && loans.length === 0"
      :title="status === 'closed' ? '还没有归还记录' : '没有待还记录'"
      description="在物料详情页点「借出」即可登记借用人、数量与预计归还日期。"
    >
      <template #icon><Document /></template>
    </EmptyState>

    <div v-if="total > pageSize" class="pager">
      <el-pagination
        v-model:current-page="page"
        :page-size="pageSize"
        :total="total"
        layout="prev, pager, next, total"
        background
        @current-change="load"
      />
    </div>

    <el-dialog v-model="returnDialog.visible" title="归还" width="min(400px, 92vw)" align-center>
      <p class="return-hint">
        {{ returnDialog.loan?.itemName }} · {{ returnDialog.loan?.borrower }} 未还
        <strong>{{ returnDialog.loan?.remaining }}</strong>
        {{ returnDialog.loan?.unit }}
      </p>
      <label class="return-field">
        <span>本次归还数量</span>
        <el-input-number
          v-model="returnDialog.quantity"
          :min="1"
          :max="returnDialog.loan?.remaining ?? 1"
          controls-position="right"
          class="control"
        />
      </label>
      <template #footer>
        <el-button @click="returnDialog.visible = false">取消</el-button>
        <el-button type="primary" :loading="returnDialog.saving" @click="submitReturn">
          确认归还
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Document } from '@element-plus/icons-vue';
import PageHeader from '@/components/PageHeader.vue';
import EmptyState from '@/components/EmptyState.vue';
import { useBreakpoint } from '@/composables/useBreakpoint';
import { api } from '@/api/client';
import { formatDate } from '@/lib/format';

const { isMobile } = useBreakpoint();
const status = ref('open');
const loans = ref([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(false);
const returnDialog = reactive({ visible: false, saving: false, loan: null, quantity: 1 });

async function load() {
  loading.value = true;
  try {
    const params = new URLSearchParams({
      status: status.value,
      page: String(page.value),
      pageSize: String(pageSize),
    });
    const data = await api(`/api/loans?${params.toString()}`);
    loans.value = data.data;
    total.value = data.total;
    if (loans.value.length === 0 && page.value > 1) {
      page.value = 1;
      await load();
    }
  } catch (error) {
    ElMessage.error(error.message || '加载借出记录失败');
  } finally {
    loading.value = false;
  }
}

function openReturn(loan) {
  returnDialog.loan = loan;
  returnDialog.quantity = loan.remaining;
  returnDialog.visible = true;
}

async function submitReturn() {
  returnDialog.saving = true;
  try {
    const data = await api(`/api/loans/${returnDialog.loan.id}/return`, {
      method: 'POST',
      body: { quantity: returnDialog.quantity },
    });
    ElMessage.success(data.remaining > 0 ? `已归还，剩余 ${data.remaining}` : '已全部归还');
    returnDialog.visible = false;
    load();
  } catch (error) {
    ElMessage.error(error.message || '归还失败');
  } finally {
    returnDialog.saving = false;
  }
}

async function cancelLoan(loan) {
  try {
    await ElMessageBox.confirm(
      `撤销后「${loan.itemName}」的这次借出记录会被删除。`,
      '撤销借出',
      { type: 'warning', confirmButtonText: '撤销', cancelButtonText: '取消' },
    );
    await api(`/api/loans/${loan.id}`, { method: 'DELETE' });
    ElMessage.success('已撤销');
    load();
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    ElMessage.error(error.message || '撤销失败');
  }
}

watch(status, () => {
  page.value = 1;
  load();
});

onMounted(load);
</script>

<style scoped>
.tabs {
  margin-bottom: var(--space-4);
}

.table-wrap {
  overflow: hidden;
  border: 1px solid var(--line);
}

.item-name {
  display: flex;
  flex-direction: column;
  line-height: 1.35;
}

.item-name small {
  color: var(--ink-400);
  font-size: 11px;
}

.overdue {
  color: var(--danger);
  font-weight: 600;
}

.cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.loan-card {
  padding: 14px;
}

.loan-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.loan-card__meta {
  margin-top: 6px;
  color: var(--ink-600);
  font-size: 12px;
}

.loan-card__note {
  margin-top: 6px;
  color: var(--ink-400);
  font-size: 12px;
}

.loan-card__actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 8px;
}

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: var(--space-4);
}

.return-hint {
  margin-bottom: var(--space-3);
  color: var(--ink-600);
  font-size: 13px;
}

.return-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--ink-600);
  font-size: 12px;
}

.control {
  width: 100%;
}

@media (max-width: 767px) {
  .pager {
    justify-content: center;
  }
}
</style>
