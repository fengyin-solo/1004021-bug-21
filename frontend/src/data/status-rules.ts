import type { ModuleMeta } from './types'

// 状态口径集中在这里：pending / abnormal 不再随记录存储，一律由当前 status 派生，
// 列表、详情、运营概览共用同一份规则，避免各页面各算各的。
// - closed：流程已闭环、不需要再处理的状态（其余一律算待处理）
// - abnormal：业务上属于异常/风险/退回/停用的状态（即使已闭环，如已封堵、已超标）
export type StatusRule = {
  closed: string[]
  abnormal: string[]
}

export const STATUS_RULES: Record<string, StatusRule> = {
  pipeline: { closed: ['已停用'], abnormal: ['已停用'] },
  inspection: { closed: ['已完成'], abnormal: [] },
  defect: { closed: ['已修复', '已忽略'], abnormal: ['已确认'] },
  out_repair: { closed: ['已返回'], abnormal: [] },
  repair_accept: { closed: ['已通过'], abnormal: ['需返修'] },
  pipe_detect: { closed: ['已完成'], abnormal: ['需复测'] },
  manhole: { closed: ['正常', '已更换'], abnormal: [] },
  pump_station: { closed: ['已停机'], abnormal: ['故障中'] },
  drain_network: { closed: ['正常', '已封堵'], abnormal: ['淤积预警', '溢流风险', '已封堵'] },
  water_quality: { closed: ['已出结果', '已超标'], abnormal: ['已超标'] },
  flow_monitor: { closed: ['在线', '已校准'], abnormal: ['离线', '数据异常'] },
  emergency: { closed: ['已处置'], abnormal: [] },
  leak_detect: { closed: ['已修复'], abnormal: [] },
  trenchless: { closed: ['已完成'], abnormal: ['待复检'] },
  pipe_cleaning: { closed: ['已完成'], abnormal: ['需复查'] },
  facility_archive: { closed: ['已归档', '已作废'], abnormal: ['已作废'] },
  monitor_device: { closed: ['运行中'], abnormal: ['已故障'] },
  contractor: { closed: ['已备案', '已清退'], abnormal: ['已清退'] },
}

function ruleOf(meta: ModuleMeta): StatusRule {
  // 未登记规则的模块兜底：只有最后一个状态算闭环，不预判异常。
  return STATUS_RULES[meta.key] ?? { closed: [meta.statuses[meta.statuses.length - 1]], abnormal: [] }
}

export type StatusFlags = { pending: boolean; abnormal: boolean }

export function deriveFlags(meta: ModuleMeta, status: string): StatusFlags {
  const rule = ruleOf(meta)
  return {
    pending: !rule.closed.includes(status),
    abnormal: rule.abnormal.includes(status),
  }
}

export function isAbnormalStatus(meta: ModuleMeta, status: string): boolean {
  return ruleOf(meta).abnormal.includes(status)
}
