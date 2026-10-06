<template>
  <section class="page">
    <header class="page-head">
      <div>
        <h2>运营概览</h2>
        <p class="page-desc">汇总各业务模块的关键指标，先看总量再看异常。指标与各模块列表共用同一口径。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="refresh">重新统计</button>
      </div>
    </header>
    <p v-if="errorMessage" class="error-text overview-error">{{ errorMessage }}</p>
    <div class="stat-row">
      <article v-for="card in cards" :key="card.label" class="stat-card">
        <span class="stat-label">{{ card.label }}</span>
        <strong class="stat-value">{{ card.value }}</strong>
      </article>
    </div>
    <table class="data-table">
      <thead>
        <tr><th>业务模块</th><th>登记总量</th><th>待处理</th><th>异常量</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in moduleRows" :key="row.key">
          <td>{{ row.name }}</td>
          <td>{{ row.created }}</td>
          <td>{{ row.pending }}</td>
          <td>
            <span :class="{ 'error-text': row.abnormal > 0 }">{{ row.abnormal }}</span>
          </td>
          <td>
            <RouterLink class="link" :to="'/' + row.key">查看明细</RouterLink>
          </td>
        </tr>
      </tbody>
    </table>

    <h3 class="section-title">异常明细</h3>
    <table class="data-table">
      <thead>
        <tr><th>来源模块</th><th>业务编号</th><th>记录ID</th><th>当前状态</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="item in abnormalRows" :key="`${item.moduleKey}-${item.id}`">
          <td>{{ item.moduleName }}</td>
          <td>{{ item.code }}</td>
          <td>{{ item.id }}</td>
          <td class="error-text">{{ item.status }}</td>
          <td>
            <RouterLink class="link" :to="'/' + item.moduleKey">前往处理</RouterLink>
          </td>
        </tr>
        <tr v-if="!abnormalRows.length">
          <td colspan="5" class="empty-state">当前没有异常记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>数据保存在本机浏览器里，换浏览器或清缓存会回到示例数据</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

import { loadOverview } from '@/api/local-service'
import { subscribeStorage } from '@/data/local-store'
import { MODULES } from '@/data/modules'
import type { OverviewResult } from '@/data/types'

// 读取失败时展示零值，绝不用上一次缓存的统计结果充当最新值。
const EMPTY_OVERVIEW: OverviewResult = {
  cards: [
    { label: '业务模块', value: MODULES.length },
    { label: '登记总量', value: 0 },
    { label: '待处理', value: 0 },
    { label: '异常量', value: 0 },
  ],
  modules: MODULES.map((meta) => ({
    key: meta.key,
    name: meta.name,
    created: 0,
    pending: 0,
    abnormal: 0,
  })),
  abnormalRecords: [],
}

const cards = ref<OverviewResult['cards']>(EMPTY_OVERVIEW.cards)
const moduleRows = ref<OverviewResult['modules']>(EMPTY_OVERVIEW.modules)
const abnormalRows = ref<OverviewResult['abnormalRecords']>([])
const errorMessage = ref('')

function refresh() {
  try {
    const payload = loadOverview()
    cards.value = payload.cards
    moduleRows.value = payload.modules
    abnormalRows.value = payload.abnormalRecords
    errorMessage.value = ''
  } catch (error) {
    cards.value = EMPTY_OVERVIEW.cards
    moduleRows.value = EMPTY_OVERVIEW.modules
    abnormalRows.value = []
    errorMessage.value = error instanceof Error ? error.message : '运营概览读取失败'
  }
}

// 任意模块状态落库成功（含其他标签页并发操作）后自动重新统计，进入/返回本页时同理。
let unsubscribe: (() => void) | undefined
onMounted(() => {
  refresh()
  unsubscribe = subscribeStorage(refresh)
})
onUnmounted(() => unsubscribe?.())
</script>
