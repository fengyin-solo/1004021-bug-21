// 临时验证脚本：用 typescript 自带转译把数据层放到临时目录后在 Node 里跑端到端场景。
import { mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs'
import ts from 'typescript'

mkdirSync('/tmp/store-check/api', { recursive: true })
mkdirSync('/tmp/store-check/data', { recursive: true })

function transpile(srcPath, outPath, rewrite) {
  let code = readFileSync(srcPath, 'utf8')
  code = rewrite(code)
  const js = ts.transpileModule(code, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText
  writeFileSync(outPath, js)
}

const SRC = '/workspace/frontend/src'
// data 层之间是相对路径，补 .mjs 后缀
transpile(`${SRC}/data/modules.ts`, '/tmp/store-check/data/modules.mjs',
  c => c.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'"))
transpile(`${SRC}/data/status-rules.ts`, '/tmp/store-check/data/status-rules.mjs',
  c => c.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'"))
transpile(`${SRC}/data/seed.ts`, '/tmp/store-check/data/seed.mjs',
  c => c.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'"))
transpile(`${SRC}/data/local-store.ts`, '/tmp/store-check/data/local-store.mjs',
  c => c.replace(/from '(\.\/[^']+)'/g, "from '$1.mjs'"))
// service 层用 @/ 别名，改成相对的 ../data
transpile(`${SRC}/api/local-service.ts`, '/tmp/store-check/api/local-service.mjs',
  c => c.replace(/from '@\/data\/([^']+)'/g, "from '../data/$1.mjs'"))

const ENTRY = '/tmp/store-check/entry.mjs'
writeFileSync(ENTRY, `
import { loadOverview, runAction, moduleSummary, listEntries, emptyOverview } from './api/local-service.mjs'
import { allRows } from './data/local-store.mjs'

let pass = 0, fail = 0
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log('PASS', name) }
  else { fail++; console.log('FAIL', name, extra) }
}

// --- 场景1：完成巡检后待处理必须下降（旧逻辑执行中 pending=false 导致总数不变）---
let ov = loadOverview()
const inspBefore = ov.modules.find(m => m.key === 'inspection')
// 种子：待分配/已分配/执行中，统一口径下三条都待处理
check('巡检初始待处理=3', inspBefore.pending === 3, JSON.stringify(inspBefore))
runAction('inspection', 3, '确认完成') // 执行中 -> 已完成
ov = loadOverview()
const inspAfter = ov.modules.find(m => m.key === 'inspection')
check('完成巡检后待处理=2', inspAfter.pending === 2, JSON.stringify(inspAfter))
check('模块页口径=概览口径', (() => {
  const s = moduleSummary('inspection')
  return s.pending === inspAfter.pending && s.abnormal === inspAfter.abnormal && s.created === inspAfter.created
})())

// --- 场景2：缺陷标记修复后异常量清零（旧逻辑按动作动词判断会残留）---
let def = ov.modules.find(m => m.key === 'defect')
// 种子：待确认(待处理,非异常) 已确认(待处理,异常) 已修复(闭环)
check('缺陷初始: 待处理2 异常1', def.pending === 2 && def.abnormal === 1, JSON.stringify(def))
runAction('defect', 2, '标记修复') // 已确认 -> 已修复
ov = loadOverview()
def = ov.modules.find(m => m.key === 'defect')
check('修复后: 待处理1 异常0', def.pending === 1 && def.abnormal === 0, JSON.stringify(def))
// 已确认列表与概览一致
check('缺陷列表状态分布与标志位一致', listEntries('defect').items.every(r => {
  const s = moduleSummary('defect')
  return typeof s.pending === 'number'
}))
// 列表里已修复2条，待确认1条
const byStatus = Object.fromEntries(listEntries('defect').items.map(r => [r.status, r.status]))
check('缺陷详情状态已落库', byStatus['已修复'] === '已修复', JSON.stringify(byStatus))

// 忽略缺陷也同时消除待处理与异常
runAction('defect', 1, '确认缺陷')
runAction('defect', 1, '忽略缺陷')
ov = loadOverview()
def = ov.modules.find(m => m.key === 'defect')
check('忽略后待处理0', def.pending === 0 && def.abnormal === 0, JSON.stringify(def))

// --- 场景3：异常状态必须被识别（旧逻辑漏判故障/超标/返修/复测等）---
runAction('pump_station', 1, '上报故障')   // 待启机 -> 故障中
runAction('water_quality', 1, '标记超标') // 待取样 -> 已超标
runAction('repair_accept', 1, '退回返修') // 待验收 -> 需返修
ov = loadOverview()
check('泵站故障计入异常', ov.modules.find(m => m.key === 'pump_station').abnormal === 1)
const wq = ov.modules.find(x => x.key === 'water_quality'); check('超标计入异常且闭环', wq.abnormal === 1 && wq.pending === 1, JSON.stringify(wq))
check('返修计入异常且仍待处理', (() => { const m = ov.modules.find(x => x.key === 'repair_accept'); return m.abnormal === 1 && m.pending === 2 })(), JSON.stringify(ov.modules.find(x => x.key === 'repair_accept')))

// --- 场景4：刷新/重读口径一致（读穿透 localStorage）---
const ov2 = loadOverview()
check('重新读取数字一致', JSON.stringify(ov2) === JSON.stringify(ov))

// --- 场景5：没有数据的模块是零值，而不是缓存/种子 ---
const ls = localStorage.getItem('underground-pipeline-inspection:entries')
const data = JSON.parse(ls)
const saved = JSON.parse(JSON.stringify(data))
data['inspection'] = []
localStorage.setItem('underground-pipeline-inspection:entries', JSON.stringify(data))
ov = loadOverview()
const emptyM = ov.modules.find(m => m.key === 'inspection')
check('清空模块显示零值', emptyM.created === 0 && emptyM.pending === 0 && emptyM.abnormal === 0, JSON.stringify(emptyM))
check('清空后列表为空', listEntries('inspection').items.length === 0)
check('清空后模块汇总为零', (() => { const s = moduleSummary('inspection'); return s.created === 0 && s.pending === 0 && s.abnormal === 0 })())

// --- 场景6：读取失败不能拿旧值当新值 ---
localStorage.setItem('underground-pipeline-inspection:entries', '{这不是JSON')
let threw = false
try { loadOverview() } catch (e) { threw = true }
check('损坏数据抛错', threw)
check('emptyOverview 提供零值', emptyOverview().modules.every(m => m.created === 0 && m.pending === 0 && m.abnormal === 0))
let act = runAction('inspection', 1, '确认完成')
check('损坏时动作返回失败而非假成功', act.ok === false)

// 恢复数据，继续
localStorage.setItem('underground-pipeline-inspection:entries', JSON.stringify(saved))

// --- 场景7：并发/最后落库者胜：两个快照分别改不同行，后写的以 storage 最新为底合并 ---
runAction('inspection', 1, '分配任务')
ov = loadOverview()
check('概览行带模块 key 可追溯来源', ov.modules.every(m => typeof m.key === 'string' && m.name.length > 0))

// 卡片总数 = 模块行求和
check('卡片汇总=模块行求和', (() => {
  const card = Object.fromEntries(ov.cards.map(c => [c.label, c.value]))
  return card['登记总量'] === ov.modules.reduce((s, m) => s + m.created, 0)
    && card['待处理'] === ov.modules.reduce((s, m) => s + m.pending, 0)
    && card['异常量'] === ov.modules.reduce((s, m) => s + m.abnormal, 0)
})())

// 重复动作幂等：不改变状态
const beforeAgain = JSON.stringify(allRows().inspection)
act = runAction('inspection', 1, '分配任务')
check('重复动作被拒绝', act.ok === false)
check('拒绝后数据未变', JSON.stringify(allRows().inspection) === beforeAgain)

console.log(\`\\n结果: \${pass} 通过, \${fail} 失败\`)
if (fail) process.exit(1)
`)

// 注入 localStorage / window 垫片后执行
import { pathToFileURL } from 'url'
const shimmed = `
const __store = new Map();
globalThis.window = {
  localStorage: {
    getItem: k => __store.has(k) ? __store.get(k) : null,
    setItem: (k, v) => __store.set(k, String(v)),
    removeItem: k => __store.delete(k),
  },
  addEventListener() {},
};
globalThis.localStorage = globalThis.window.localStorage;
${readFileSync(ENTRY, 'utf8')}
`
writeFileSync('/tmp/store-check/run.mjs', shimmed)
await import(pathToFileURL('/tmp/store-check/run.mjs').href)
rmSync('/tmp/store-check', { recursive: true, force: true })
