import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { deriveFlags } from '@/data/status-rules'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

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
    return { ok: false, message: error instanceof Error ? error.message : '数据读取失败，状态未变更' }
  }
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  // 待处理/异常以流转后的状态为准：标记修复、确认完成会同步清掉异常与待处理；
  // 上报故障、退回返修等会同步进入异常。
  const flags = deriveFlags(meta, target)
  const updated: EntryRow = { ...rows[index], status: target, ...flags }
  const next = [...rows]
  next[index] = updated
  try {
    saveRows(key, next)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '状态保存失败，未生效' }
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// 模块口径汇总：与运营概览里每一行的算法完全一致，列表页统计卡直接复用，
// 保证模块页与概览永远是同一组数字。
export function moduleSummary(key: string): { created: number; pending: number; abnormal: number } {
  const meta = moduleMeta(key)
  const entries = listRows(key)
  return {
    created: entries.length,
    pending: entries.filter((row) => deriveFlags(meta, String(row.status)).pending).length,
    abnormal: entries.filter((row) => deriveFlags(meta, String(row.status)).abnormal).length,
  }
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `﻿${lines.join('\n')}` }
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

export function emptyOverview(): OverviewResult {
  const modules = [...MODULE_BY_KEY.values()].map((meta) => ({
    key: meta.key,
    name: meta.name,
    created: 0,
    pending: 0,
    abnormal: 0,
  }))
  return { cards: buildCards(modules), modules }
}

function buildCards(modules: OverviewResult['modules']) {
  return [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      key: meta.key,
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => deriveFlags(meta, String(row.status)).pending).length,
      abnormal: entries.filter((row) => deriveFlags(meta, String(row.status)).abnormal).length,
    }
  })
  return { cards: buildCards(modules), modules }
}
