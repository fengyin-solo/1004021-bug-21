<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>登记总量</th><th>待处理</th><th>异常量</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.key">
          <td>
            <RouterLink class="module-link" :to="`/${row.key}`">{{ row.name }}</RouterLink>
          </td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td :class="{ 'abnormal-cell': row.abnormal > 0 }">{{ row.abnormal }}</td>
        </tr>
      </tbody>
    </table>
    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

import { emptyOverview, loadOverview } from '@/api/local-service'
import { subscribe } from '@/data/local-store'
import type { OverviewResult } from '@/data/types'

// 初始就是零值口径，读取成功前绝不显示上一次的缓存数字。
const cards = ref<OverviewResult['cards']>(emptyOverview().cards)
const moduleRows = ref<OverviewResult['modules']>(emptyOverview().modules)
const errorMessage = ref('')

let unsubscribe: (() => void) | undefined

function refresh() {
  errorMessage.value = ''
  try {
    const payload = loadOverview()
    cards.value = payload.cards
    moduleRows.value = payload.modules
  } catch (error) {
    // 读取失败：全部归零并提示，不能把旧值当成新值继续展示。
    cards.value = emptyOverview().cards
    moduleRows.value = emptyOverview().modules
    errorMessage.value = error instanceof Error ? error.message : '运营概览读取失败'
  }
}

onMounted(() => {
  refresh()
  // 本标签页动作落库、其他标签页 storage 变更都会触发重算，刷新和重新进入口径一致。
  unsubscribe = subscribe(refresh)
})

onUnmounted(() => unsubscribe?.())
</script>
