<template>
  <section class="page" data-module="monitor_device">
    <header class="page-head">
      <div>
        <h2>监测设备管理</h2>
        <p class="page-desc">维护监测设备，围绕设备编号、设备类型、安装位置、监测参数做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记监测设备</button>
        <button class="btn" type="button" @click="exportRows">导出监测设备清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无监测设备数据，可先登记监测设备</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条监测设备记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  moduleSummary,
  runAction as applyAction,
} from '@/api/local-service'
import { subscribe } from '@/data/local-store'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('monitor_device')
const columns = ["设备编号", "设备类型", "安装位置", "监测参数", "安装日期", "校准周期", "最近校准", "设备状态"]
const actions = ["确认安装", "申请校准", "上报故障"]
const statuses = ["待安装", "运行中", "待校准", "已故障"]
const stats = ref([{ label: '登记总量', value: 0 }, { label: '待处理', value: 0 }, { label: '异常量', value: 0 }])

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  try {
    downloadEntries(meta.key)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '清单导出失败'
  }
}

function openCreate() {
  errorMessage.value = '监测设备登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    const summary = moduleSummary(meta.key)
    stats.value = [
      { label: '登记总量', value: summary.created },
      { label: '待处理', value: summary.pending },
      { label: '异常量', value: summary.abnormal },
    ]
  } catch (error) {
    // 读取失败：列表、总数、统计卡全部清零，绝不用上次的旧值冒充新数据。
    rows.value = []
    total.value = 0
    stats.value = [
      { label: '登记总量', value: 0 },
      { label: '待处理', value: 0 },
      { label: '异常量', value: 0 },
    ]
    errorMessage.value = error instanceof Error ? error.message : '列表读取失败'
  }
}

let unsubscribe: (() => void) | undefined

onMounted(() => {
  reload()
  // 其他标签页的状态落库后同步重算，保证并发操作下始终以最后成功落库的状态为准。
  unsubscribe = subscribe(reload)
})

onUnmounted(() => unsubscribe?.())
</script>
