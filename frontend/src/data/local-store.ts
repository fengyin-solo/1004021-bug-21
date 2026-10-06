import { MODULE_BY_KEY } from './modules'
import { SEED_ROWS } from './seed'
import { deriveFlags } from './status-rules'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'underground-pipeline-inspection:entries'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 归一化：pending/abnormal 只由当前 status 派生，旧缓存里写死的标志位读出来即自愈，
// 保证列表、详情、概览任何时候都走同一口径。
function normalizeAll(data: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const result: Record<string, EntryRow[]> = {}
  for (const [key, rows] of Object.entries(data)) {
    const meta = MODULE_BY_KEY.get(key)
    result[key] = meta
      ? rows.map((row) => ({ ...row, ...deriveFlags(meta, String(row.status)) }))
      : rows
  }
  return result
}

function seedStorage(): Record<string, EntryRow[]> {
  const seeded = normalizeAll(clone(SEED_ROWS))
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded))
  }
  return seeded
}

// 直接读 localStorage，不做长期内存缓存：其他标签页的落库结果每次都能读到，
// 避免「刷新后又是另一组数字」。读失败直接抛出，由调用方清零并提示，
// 绝不拿上次缓存或示例数据冒充新值。
export function readAll(): Record<string, EntryRow[]> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return normalizeAll(clone(SEED_ROWS))
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (raw === null) {
    return seedStorage()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('本地数据已损坏，无法读取；请检查浏览器存储后重试')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('本地数据格式不正确，无法读取')
  }
  // 缺失的模块即零数据，不用示例数据补齐，也不残留上次缓存。
  return normalizeAll(parsed as Record<string, EntryRow[]>)
}

export function allRows(): Record<string, EntryRow[]> {
  return readAll()
}

export function listRows(key: string): EntryRow[] {
  return readAll()[key] ?? []
}

// 写前重新读取最新全量再合并本模块：多标签并发操作时，最后成功落库的状态生效，
// 不会用自己手里的旧快照把别的模块/标签的更新覆盖掉。
export function saveRows(key: string, rows: EntryRow[]): void {
  const latest = readAll()
  const next = { ...latest, [key]: rows }
  if (typeof window === 'undefined' || !window.localStorage) {
    throw new Error('当前环境不支持本地存储，状态无法保存')
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    throw new Error('本地数据写入失败，请检查浏览器存储空间')
  }
  emitChange()
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  const meta = MODULE_BY_KEY.get(key)
  saveRows(key, meta ? rows.map((row) => ({ ...row, ...deriveFlags(meta, String(row.status)) })) : rows)
  return rows
}

// 数据变更订阅：本标签页写库后主动通知；其他标签页通过 storage 事件通知。
type Listener = () => void
const listeners = new Set<Listener>()
let storageBound = false

function emitChange() {
  listeners.forEach((listener) => listener())
}

function bindStorageEvent() {
  if (storageBound || typeof window === 'undefined' || !window.addEventListener) {
    return
  }
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY) {
      emitChange()
    }
  })
  storageBound = true
}

export function subscribe(listener: Listener): () => void {
  bindStorageEvent()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function storageKey(): string {
  return STORAGE_KEY
}
