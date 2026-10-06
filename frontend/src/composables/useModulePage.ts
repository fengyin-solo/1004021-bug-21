import { computed, onMounted, onUnmounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  moduleMetrics,
  runAction as applyAction,
} from '@/api/local-service'
import { subscribeStorage } from '@/data/local-store'
import type { EntryRow, MetricValue } from '@/data/types'

/**
 * 各业务模块列表页的统一数据口径：
 * - 指标卡、状态分布、列表全部在每次数据变更后重新读取，动作成功即同步；
 * - 订阅本地存储变更（含其他标签页落库），返回工作台再进来或跨标签页并发操作后口径一致；
 * - 读取失败时清空列表与指标，显示零值与错误信息，绝不保留旧值冒充新值。
 */
export function useModulePage(key: string) {
  const meta = moduleMeta(key)
  const rows = ref<EntryRow[]>([])
  const total = ref(0)
  const errorMessage = ref('')
  const filters = ref<Record<string, string>>({})

  const filterFields = meta.fields.slice(0, 3)

  const stats = computed<MetricValue[]>(() => {
    try {
      return moduleMetrics(key)
    } catch {
      // 读取失败：指标卡显示零值，绝不保留上一次统计。
      return meta.metricRules.map((rule) => ({ label: rule.label, value: 0 }))
    }
  })

  const statusSummary = computed(() =>
    meta.statuses.map((status) => ({
      status,
      count: rows.value.filter((row) => String(row.status) === status).length,
    })),
  )

  function reload() {
    try {
      const payload = listEntries(key, filters.value)
      rows.value = payload.items
      total.value = payload.total
      errorMessage.value = ''
    } catch (error) {
      rows.value = []
      total.value = 0
      errorMessage.value = error instanceof Error ? error.message : `${meta.name}列表读取失败`
    }
  }

  function resetFilters() {
    filters.value = {}
    reload()
  }

  function exportRows() {
    try {
      downloadEntries(key)
    } catch (error) {
      errorMessage.value = error instanceof Error ? error.message : `${meta.name}清单导出失败`
    }
  }

  function openCreate() {
    errorMessage.value = `${meta.name}登记入口尚未接入审批流`
  }

  function runAction(action: string, row: EntryRow) {
    errorMessage.value = ''
    // 落库成功后订阅回调会自动 reload；这里不再手动读取，避免读到写入前的旧值。
    const result = applyAction(key, Number(row.id), action)
    if (!result.ok) {
      errorMessage.value = result.message
      reload()
    }
  }

  let unsubscribe: (() => void) | undefined
  onMounted(() => {
    reload()
    unsubscribe = subscribeStorage(reload)
  })
  onUnmounted(() => unsubscribe?.())

  return {
    meta,
    rows,
    total,
    errorMessage,
    filters,
    filterFields,
    stats,
    statusSummary,
    reload,
    resetFilters,
    exportRows,
    openCreate,
    runAction,
  }
}
