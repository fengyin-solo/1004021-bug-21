import { MODULE_BY_KEY, MODULES } from '@/data/modules'
import { listRows, resetRows, saveRows } from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  MetricValue,
  ModuleMeta,
  OverviewResult,
  PageResult,
} from '@/data/types'

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

/** 模块指标卡：与概览共用 pending/abnormal/状态同一口径，页面不再各自写死零值。 */
export function moduleMetrics(key: string): MetricValue[] {
  const meta = moduleMeta(key)
  const rows = listRows(key)
  return meta.metricRules.map((rule) => {
    if (rule.kind === 'total') {
      return { label: rule.label, value: rows.length }
    }
    if (rule.kind === 'status') {
      return {
        label: rule.label,
        value: rows.filter((row) => String(row.status) === rule.status).length,
      }
    }
    if (rule.kind === 'abnormal') {
      return { label: rule.label, value: rows.filter((row) => row.abnormal).length }
    }
    const total = rows.reduce((sum, row) => {
      const num = Number(row[rule.field])
      return Number.isFinite(num) ? sum + num : sum
    }, 0)
    return { label: rule.label, value: total }
  })
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  let rows: EntryRow[]
  try {
    rows = listRows(key)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : `${meta.entity}数据读取失败，状态未变更` }
  }
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const updated: EntryRow = { ...rows[index], status: target }
  const next = [...rows]
  next[index] = updated
  try {
    // saveRows 会按新状态统一重算 pending/abnormal，落库并校验成功才算操作成功。
    saveRows(key, next)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '状态保存失败' }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

/** 记录的业务编号字段约定：每个模块 fields 的第一列（任务编号、缺陷编号等）。 */
function rowCode(meta: ModuleMeta, row: EntryRow): string {
  return String(row[meta.fields[0]] ?? row.id)
}

export function loadOverview(): OverviewResult {
  const modules = MODULES.map((meta) => {
    const entries = listRows(meta.key)
    return {
      key: meta.key,
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const abnormalRecords = MODULES.flatMap((meta) =>
    listRows(meta.key)
      .filter((row) => row.abnormal)
      .map((row) => ({
        moduleKey: meta.key,
        moduleName: meta.name,
        id: Number(row.id),
        status: String(row.status),
        code: rowCode(meta, row),
      })),
  )
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: abnormalRecords.length },
  ]
  return { cards, modules, abnormalRecords }
}
