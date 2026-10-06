import { SEED_ROWS } from './seed'
import { MODULE_BY_KEY } from './modules'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'underground-pipeline-inspection:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/**
 * 统一口径：pending / abnormal 只由当前 status 推导，不再相信行内可能过期的旧标志。
 * - pending：状态不是模块的最后一个（终态）状态
 * - abnormal：状态命中模块显式声明的 abnormalStatuses（修复/恢复后自动摘帽）
 */
export function deriveFlags(key: string, status: string): { pending: boolean; abnormal: boolean } {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    return { pending: false, abnormal: false }
  }
  return {
    pending: status !== meta.statuses[meta.statuses.length - 1],
    abnormal: meta.abnormalStatuses.includes(status),
  }
}

/** 读出来的行统一按当前状态重算标志，保证刷新/重进后口径一致，旧缓存不会污染统计。 */
function normalizeRow(key: string, row: EntryRow): EntryRow {
  const { pending, abnormal } = deriveFlags(key, String(row.status))
  return { ...row, pending, abnormal }
}

function storage(): Storage {
  if (typeof window === 'undefined' || !window.localStorage) {
    throw new Error('当前环境不支持本地存储，数据无法读取')
  }
  return window.localStorage
}

/**
 * 从持久化层读取全量数据。
 * 关键约定：
 * - 没有存储（首次使用）才播种示例数据，并立即落库。
 * - 存储里缺失的模块一律按空数组处理（显示零值），绝不用种子数据悄悄补上。
 * - 解析失败直接抛错，由调用方展示「读取失败」，绝不把种子/旧值当成新值返回。
 */
function readStorage(): Record<string, EntryRow[]> {
  const store = storage()
  const raw = store.getItem(STORAGE_KEY)
  if (raw === null) {
    // 播种同样走规范化：首次进入就与后续刷新保持同一口径，不把种子里的旧标志带出来。
    const seeded: Record<string, EntryRow[]> = {}
    for (const [key, rows] of Object.entries(clone(SEED_ROWS))) {
      seeded[key] = rows.map((row) => normalizeRow(key, row))
    }
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(seeded))
    } catch (error) {
      throw new Error(`初始化示例数据失败：${(error as Error).message}`)
    }
    return seeded
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    throw new Error(`本地数据已损坏，读取失败：${(error as Error).message}`)
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('本地数据格式不正确，读取失败')
  }
  const result: Record<string, EntryRow[]> = {}
  for (const [key, rows] of Object.entries(parsed as Record<string, unknown>)) {
    if (!MODULE_BY_KEY.has(key)) {
      continue
    }
    if (!Array.isArray(rows)) {
      throw new Error(`模块「${key}」的本地数据格式不正确，读取失败`)
    }
    result[key] = (rows as EntryRow[]).map((row) => normalizeRow(key, row))
  }
  return result
}

/** 不做任何模块级缓存：每次读取都以最后一次成功落库的内容为准，跨标签页也能看到最新值。 */
function allRows(): Record<string, EntryRow[]> {
  return readStorage()
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

type StorageListener = () => void
const listeners = new Set<StorageListener>()

/** 订阅数据变更（含其他标签页的落库），视图据此重新统计。 */
export function subscribeStorage(listener: StorageListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

if (typeof window !== 'undefined') {
  // 其他标签页成功落库后，本页重新读取，保证多端口径一致（最后成功落库者为准）。
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      listeners.forEach((listener) => listener())
    }
  })
}

/**
 * 原子化落库一个模块：
 * 1. 先从持久化层重新读取最新全量（不依赖任何内存快照），避免覆盖其他页面刚写入的模块；
 * 2. 写入 localStorage 后立即读回校验，确认真正落库才算成功；
 * 3. 落库失败抛错，调用方提示失败、保留旧数据，绝不在未持久化时假装成功；
 * 4. 成功后通知本页所有订阅者重新统计。
 */
export function saveRows(key: string, rows: EntryRow[]): void {
  const store = storage()
  const normalized = rows.map((row) => normalizeRow(key, row))
  let next: Record<string, EntryRow[]>
  try {
    next = { ...readStorage(), [key]: normalized }
  } catch (error) {
    throw new Error(`保存前读取最新数据失败，已放弃本次写入：${(error as Error).message}`)
  }
  const serialized = JSON.stringify(next)
  try {
    store.setItem(STORAGE_KEY, serialized)
  } catch (error) {
    throw new Error(`数据落库失败：${(error as Error).message}`)
  }
  // 写后校验：存储驱动可能因配额/隐私模式静默丢写，必须确认最后状态确实是本次写入。
  if (store.getItem(STORAGE_KEY) !== serialized) {
    throw new Error('数据落库后校验失败，当前状态可能不是最新')
  }
  listeners.forEach((listener) => listener())
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
