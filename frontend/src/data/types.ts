/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  /** 模块指标卡规则：列表页与概览共用同一套口径。 */
  metricRules: MetricRule[]
  /** 计入「异常量」的状态：由业务语义显式声明，不靠动作名猜。 */
  abnormalStatuses: string[]
}

/** 模块指标卡的计算规则，三种口径互斥：总数 / 某状态数量 / 异常数量 / 数值字段求和。 */
export type MetricRule =
  | { label: string; kind: 'total' }
  | { label: string; kind: 'status'; status: string }
  | { label: string; kind: 'abnormal' }
  | { label: string; kind: 'sum'; field: string }

export type MetricValue = { label: string; value: number }

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewModule = {
  key: string
  name: string
  created: number
  pending: number
  abnormal: number
}

export type OverviewAbnormal = {
  /** 来源模块 key，用于跳转定位 */
  moduleKey: string
  moduleName: string
  id: number
  status: string
  /** 列表里用于辨认记录的业务编号（任务编号、缺陷编号等） */
  code: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: OverviewModule[]
  abnormalRecords: OverviewAbnormal[]
}
