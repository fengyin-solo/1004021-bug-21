const assert = require('assert')

// ---- 极简 localStorage 垫片 ----
function makeMemoryStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem(k, v) { map.set(k, String(v)) },
    removeItem(k) { map.delete(k) },
    clear() { map.clear() },
    _raw: () => (map.has('underground-pipeline-inspection:entries') ? map.get('underground-pipeline-inspection:entries') : null),
  }
}

async function loadApp(storage) {
  globalThis.window = { localStorage: storage, addEventListener() {} }
  globalThis.localStorage = storage
  const res = await esbuild.build({
    entryPoints: ['/workspace/frontend/src/api/local-service.ts'],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    alias: { '@': '/workspace/frontend/src' },
  })
  const code = res.outputFiles[0].text
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', code)(mod, mod.exports, require)
  return mod.exports
}

const esbuild = require('esbuild')

;(async () => {
  // 1. 首屏：概览、列表指标卡、行状态三者一致
  let storage = makeMemoryStorage()
  let svc = await loadApp(storage)
  const ov0 = svc.loadOverview()
  const inspPending = ov0.modules.find((m) => m.key === 'inspection').pending
  const inspRows = svc.listEntries('inspection').items
  const terminal = '已完成'
  assert.strictEqual(
    inspPending,
    inspRows.filter((r) => r.status !== terminal).length,
    '概览待处理 = 列表非终态行数',
  )
  // 2. 完成巡检：待处理 -1，登记总量不变；再次确认完成幂等失败
  const before = svc.loadOverview().modules.find((m) => m.key === 'inspection')
  const r1 = svc.runAction('inspection', 1, '确认完成')
  assert.ok(r1.ok, r1.message)
  const after = svc.loadOverview().modules.find((m) => m.key === 'inspection')
  assert.strictEqual(after.created, before.created, '完成巡检不改变总数')
  assert.strictEqual(after.pending, before.pending - 1, '完成巡检待处理-1')
  const rDup = svc.runAction('inspection', 1, '确认完成')
  assert.ok(!rDup.ok, '重复动作应失败')

  // 3. 标记缺陷已修复：异常摘帽（旧种子里 id2 是脏 abnormal=true/已确认，先确认再修复）
  svc.runAction('defect', 1, '标记修复')
  svc.runAction('defect', 2, '标记修复')
  const def = svc.loadOverview().modules.find((m) => m.key === 'defect')
  assert.strictEqual(def.abnormal, 0, '全部修复后异常量为零')
  const fixedRow = svc.listEntries('defect').items.find((r) => r.id === 2)
  assert.strictEqual(fixedRow.abnormal, false, '行上异常标志同步摘除')
  // 缺陷模块终态是「已忽略」，「已修复」按统一口径仍待处理，重点是异常摘帽。
  assert.strictEqual(fixedRow.pending, true, '已修复仍按口径计入待处理')

  // 4. 异常明细可追溯来源模块
  const ovAb = svc.loadOverview()
  const sample = ovAb.abnormalRecords.find((r) => r.moduleKey === 'flow_monitor') || ovAb.abnormalRecords[0]
  assert.ok(sample.moduleName && sample.code && sample.status, '异常记录带来源模块/编号/状态')

  // 5. 刷新（重新读取）口径一致
  const svc2 = await loadApp(storage)
  const a = svc.loadOverview()
  const b = svc2.loadOverview()
  assert.strictEqual(JSON.stringify(a), JSON.stringify(b), '重新进入模块后概览数字一致')

  // 6. 存储缺失某模块 => 零值，不回退种子
  const all = JSON.parse(storage._raw())
  delete all.contractor
  storage.setItem('underground-pipeline-inspection:entries', JSON.stringify(all))
  const svc3 = await loadApp(storage)
  const cRow = svc3.loadOverview().modules.find((m) => m.key === 'contractor')
  assert.deepStrictEqual([cRow.created, cRow.pending, cRow.abnormal], [0, 0, 0], '缺失模块显示零值')
  assert.strictEqual(svc3.listEntries('contractor').items.length, 0, '缺失模块列表为空')

  // 7. 数据损坏 => 读取抛错，而不是回退旧值/种子
  storage.setItem('underground-pipeline-inspection:entries', '{损坏')
  const svc4 = await loadApp(storage)
  assert.throws(() => svc4.loadOverview(), /损坏/, '损坏数据读取抛错')
  const failed = svc4.runAction('inspection', 3, '确认完成')
  assert.ok(!failed.ok && /放弃本次写入|读取/.test(failed.message), '读取失败时动作不伪装成功: ' + failed.message)
  // 存储未被改动
  assert.strictEqual(storage._raw(), '{损坏', '失败写入不覆盖原数据')

  // 8. 并发：后成功落库为准（模拟另一标签页在读后写入）
  storage = makeMemoryStorage()
  const sA = await loadApp(storage)
  // 标签页A把 1 完成；标签页B基于更早点完成 3——saveRows 每次重新读全量，互不覆盖
  sA.runAction('inspection', 1, '确认完成')
  const sB = await loadApp(storage)
  sB.runAction('inspection', 3, '确认完成')
  const finalRows = sA.listEntries('inspection').items
  assert.strictEqual(finalRows.find((r) => r.id === 1).status, '已完成', 'A 的写入保留')
  assert.strictEqual(finalRows.find((r) => r.id === 3).status, '已完成', 'B 的写入保留（最后成功落库为准）')

  // 9. 指标卡与状态口径一致（defect 严重缺陷卡 = 异常数）
  storage = makeMemoryStorage()
  const svc5 = await loadApp(storage)
  const severe = svc5.moduleMetrics('defect').find((m) => m.label === '严重缺陷').value
  assert.strictEqual(severe, svc5.loadOverview().modules.find((m) => m.key === 'defect').abnormal, '指标卡异常数=概览异常量')
  const inspMetrics = svc5.moduleMetrics('inspection').find((m) => m.label === '今日任务').value
  assert.strictEqual(inspMetrics, 3, '指标卡不再写死为0')

  console.log('全部行为验证通过 ✅')
})().catch((e) => { console.error(e); process.exit(1) })
