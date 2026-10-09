<template>
  <view class="page" :style="[{ paddingTop: statusBarHeight + 'px' }, themeVars]">
    <!-- 顶栏：返回 + 标题（右侧空占位，标题才居中） -->
    <view class="top">
      <view class="icon-btn" @click="goBack">
        <view :style="maskStyle('chevL', 44, 'var(--md-on-surface)')"></view>
      </view>
      <text class="title">预付管理</text>
      <!-- 右侧：历史记录入口（已结清的那些去那儿看）。标题是绝对居中的，这里放什么都不挤它 -->
      <view class="his-btn af-press" :class="{ pressing: isPressed('his') }" @touchstart="pressOn('his')"
        @touchend="pressOff" @touchcancel="pressOff" @click="goHistory"><text>历史</text></view>
    </view>

    <view v-if="loadError" class="error-box">
      <text class="error-text">加载失败</text>
      <view class="retry-btn af-press" :class="{ pressing: isPressed('retry') }" @touchstart="pressOn('retry')"
        @touchend="pressOff" @touchcancel="pressOff" @click="load"><text class="retry-text">重 试</text></view>
    </view>

    <template v-else>
      <view v-if="items.length" class="sum">
        <text class="sum-t">还有 {{ items.length }} 笔没报回来，合计 <text class="sum-v num">{{ fmtYuan(totalRemaining) }}</text></text>
      </view>

      <!-- 空态**不进滚动区**：它没有「更多」，也不该能滚。这一页的提示文案最长，
           搁进滚动区会顶出内容高度，于是空态自己也能上拉 —— 就是「莫名其妙能滚」那件事。
           放在外面它有整个剩余高度可用，既不会溢出去，想滚也没得滚 -->
      <view v-if="!items.length" class="empty">
        <text class="empty-icon">🐦</text>
        <text class="empty-t">没有待回收的预付</text>
        <text class="empty-h">在「记一笔」的支出模式下按右上角的「预付」，垫出去的钱就会出现在这里</text>
      </view>

      <!-- **只有这一块滚**（顶栏 / 汇总固定）。这一页不切期，所以不配 scroll-top ——
           从记账页返回时列表留在原处正好 -->
      <scroll-view v-else class="list-body" :scroll-y="listScrollable" @scrolltolower="onListLower">
      <view class="list">
        <view v-for="p in visibleItems" :key="p.id" class="card">
          <view class="c-head">
            <category-icon :icon="p.categoryIcon" :color="p.categoryColor" :name="p.categoryName" :size="76" />
            <view class="c-txt">
              <text class="c-title">{{ p.categoryName }}</text>
              <text class="c-sub">{{ subOf(p) }}</text>
            </view>
          </view>
          <!-- 三个数并排：垫出去多少、已经报回来多少、还剩多少。
               用户要的就是最后那个「还剩」—— 所以它最大、最显眼 -->
          <view class="c-nums">
            <view class="c-num">
              <text class="k">垫付</text>
              <text class="v num">{{ fmtYuan(p.amount) }}</text>
            </view>
            <view class="c-num">
              <text class="k">已收</text>
              <text class="v num">{{ fmtYuan(p.recovered) }}</text>
            </view>
            <view class="c-num">
              <text class="k">待收</text>
              <text class="v num strong">{{ fmtYuan(p.remaining) }}</text>
            </view>
          </view>
          <view class="c-btns">
            <view class="c-btn af-press" :class="{ pressing: isPressed('rc' + p.id) }"
              @touchstart="pressOn('rc' + p.id)" @touchend="pressOff" @touchcancel="pressOff"
              @click="openRecover(p)"><text>收回</text></view>
            <view class="c-btn primary af-press" :class="{ pressing: isPressed('st' + p.id) }"
              @touchstart="pressOn('st' + p.id)" @touchend="pressOff" @touchcancel="pressOff"
              @click="onSettle(p)"><text>结清</text></view>
          </view>
        </view>

      </view>
      </scroll-view>
    </template>

    <!-- 收回：底部卡片。金额默认填「待收」，多数情况一次就收完 -->
    <view v-if="showRecover" class="rv-scrim" :class="{ closing: rvClosing }" @click="closeRecover">
      <view class="af-blocker"></view>
      <view class="rv-card" :class="{ closing: rvClosing }" @click.stop>
        <view class="rv-grab"></view>
        <text class="rv-title">收回预付</text>
        <text class="rv-info">{{ rvItem ? `垫付 ${fmtYuan(rvItem.amount)} · 待收 ${fmtYuan(rvItem.remaining)}` : '' }}</text>

        <view class="rv-row">
          <text class="rv-label">收到</text>
          <view class="rv-input-wrap">
            <input class="rv-input num" v-model="rvAmount" type="digit" placeholder="0" :cursor-spacing="kbSpacing"
              placeholder-class="rv-ph" />
            <view v-if="rvAmount" class="rv-clear" @click="rvAmount = ''">
              <view :style="maskStyle('x', 26, 'var(--md-on-surface-variant)')"></view>
            </view>
          </view>
          <text class="rv-unit">元</text>
        </view>

        <text class="rv-label2">收到的账户</text>
        <scroll-view class="rv-accts" scroll-x>
          <view class="rv-acct-rail">
            <view v-for="a in payAccounts" :key="a.id" class="rv-acct" :class="{ on: rvAccountId === a.id }"
              @click="rvAccountId = a.id">
              <category-icon :icon="a.icon" :color="a.color" :name="a.name" :size="48" />
              <text class="rv-acct-t">{{ a.name }}</text>
            </view>
          </view>
        </scroll-view>

        <view class="rv-btns">
          <view class="rv-cancel af-press" :class="{ pressing: isPressed('rvc') }" @touchstart="pressOn('rvc')"
            @touchend="pressOff" @touchcancel="pressOff" @click="closeRecover"><text>取消</text></view>
          <view class="rv-done af-press" :class="{ pressing: isPressed('rvd') }" @touchstart="pressOn('rvd')"
            @touchend="pressOff" @touchcancel="pressOff" @click="confirmRecover"><text>确定</text></view>
        </view>
      </view>
    </view>

    <confirm-dialog ref="confirmDlg" />
  </view>
</template>

<script>
import { listPendingPrepays, recoverPrepay, settlePrepay } from '@/services/prepay.js'
import { listAccounts } from '@/services/account.js'
import { fmtYuan } from '@/services/format.js'
import { maskStyle } from '@/services/icons.js'
import pressFx from '@/services/press.js'

// 列表懒加载：首屏只渲染这么多张卡，滚到底再补一批（与首页/分类明细同一套）。
// 这一页没有「切期/换账户」的概念，所以不记指纹 —— 收回一笔后 onShow 重查时，
// shownRows 保持不动正好（列表变短也不会出错，slice 取完就停）。
const LAZY_ROWS = 60

export default {
  mixins: [pressFx],
  data() {
    return {
      statusBarHeight: 0,
      items: [],
      totalRemaining: 0,
      // 懒加载：渲染到第几张卡（切出来的是 visibleItems）；合计仍按 items 全量算
      shownRows: LAZY_ROWS,
      // 这一块能不能滚：由 measureList() 按「内容是否真的超过可用高度」决定
      // （那套算不通的高度账见 index.vue 的同名方法注释）
      listScrollable: false,
      loadError: false,
      // 收回卡片
      showRecover: false,
      rvClosing: false,
      rvTimer: null,
      rvItem: null,
      rvAmount: '',
      rvAccountId: null,
      payAccounts: [],
      saving: false,
      kbSpacing: 0
    }
  },
  computed: {
    /** 真正渲染出去的那一段（列表懒加载）—— 数据仍是全量，顶上那个「待收合计」照旧准 */
    visibleItems() {
      return this.items.slice(0, this.shownRows)
    },
    hasMore() {
      return this.shownRows < this.items.length
    }
  },
  watch: {
    // 列表内容变了就重量一次（空态↔列表切换、收回一笔后重查、滚到底补了一批）
    'items.length'() {
      this.$nextTick(this.measureList)
    },
    shownRows() {
      this.$nextTick(this.measureList)
    }
  },
  onLoad() {
    this.statusBarHeight = (uni.getSystemInfoSync().statusBarHeight) || 0
    // 键盘遮挡弹层用 cursor-spacing，不自己抬（App 端 adjustPan 是系统在平移窗口）
    this.kbSpacing = 80
  },
  onReady() {
    this.measureList()
  },
  onShow() {
    this.load()
  },
  onUnload() {
    if (this.rvTimer) clearTimeout(this.rvTimer)
  },
  /** 安卓返回键：卡片开着时先收它 */
  onBackPress() {
    const dlg = this.$refs.confirmDlg
    if (dlg && dlg.visible) {
      dlg.cancel()
      return true
    }
    if (this.showRecover) {
      this.closeRecover()
      return true
    }
    return false
  },
  methods: {
    /**
     * 量出列表内容有没有超过可用高度，据此决定这一块能不能滚（与首页同一套，
     * 为什么不让 CSS 算、为什么锁 scroll-y 而不锁高度，见 index.vue 那条注释）。
     */
    measureList() {
      const q = uni.createSelectorQuery().in(this)
      q.select('.list-body').boundingClientRect()
      q.select('.list').boundingClientRect()
      q.exec((res) => {
        const b = res && res[0]
        const l = res && res[1]
        if (!b) return // 空态时这一块不存在，本来也不需要滚
        const avail = Math.max(0, uni.getSystemInfoSync().windowHeight - b.top)
        const content = l ? l.height : 0
        this.listScrollable = content > avail + 1 // +1 容差躲浮点
      })
    },
    /** 列表滚到底：懒加载的门槛再抬一批（触发者是 scroll-view 的 scrolltolower） */
    onListLower() {
      if (!this.hasMore) return
      this.shownRows += LAZY_ROWS
    },
    fmtYuan,
    maskStyle,
    goBack() {
      uni.navigateBack()
    },
    goHistory() {
      uni.navigateTo({ url: '/pages/prepay/history' })
    },
    async load() {
      try {
        this.items = await listPendingPrepays()
        this.totalRemaining = this.items.reduce((n, p) => n + p.remaining, 0)
        this.loadError = false
      } catch (e) {
        console.error('[prepay] 加载失败', e)
        this.loadError = true
      }
    },
    /** 副标题：谁垫的 · 哪天 · 备注（有才拼，不留半个分隔符） */
    subOf(p) {
      const parts = []
      if (p.accountName) parts.push(p.accountName)
      if (p.date) parts.push(p.date)
      if (p.note) parts.push(p.note)
      return parts.join(' · ')
    },
    // ---- 收回 ----
    async openRecover(p) {
      this.rvItem = p
      // 默认填「待收」：多数情况就是一次收完，省一次输入
      this.rvAmount = p.remaining ? String(p.remaining / 100) : ''
      try {
        // 收款账户里不会有预付账户 —— listAccounts 把它滤掉了（否则收回就成了把钱挪回原处）
        this.payAccounts = await listAccounts()
      } catch (e) {
        console.error('[prepay] 账户加载失败', e)
        this.payAccounts = []
      }
      this.rvAccountId = this.payAccounts.length ? this.payAccounts[0].id : null
      this.rvClosing = false
      this.showRecover = true
    },
    closeRecover() {
      if (!this.showRecover || this.rvClosing) return
      this.rvClosing = true
      this.rvTimer = setTimeout(() => {
        this.showRecover = false
        this.rvClosing = false
        this.rvTimer = null
      }, 200)
    },
    async confirmRecover() {
      if (this.saving || this.rvClosing || !this.rvItem) return
      const yuan = Number(String(this.rvAmount).trim())
      if (!Number.isFinite(yuan) || yuan <= 0) {
        uni.showToast({ title: '填写收回金额', icon: 'none' })
        return
      }
      if (this.rvAccountId == null) {
        uni.showToast({ title: '选择收到的账户', icon: 'none' })
        return
      }
      this.saving = true
      try {
        // 不传 date / time：补记的流水要跟**这笔预付**同一天同一时刻（服务层兜底），
        // 传 today() 反而会把它们拆到结清那天去，与「同一笔业务的两面」不符
        const r = await recoverPrepay({
          prepayId: this.rvItem.id,
          toAccountId: this.rvAccountId,
          amountCents: Math.round(yuan * 100)
        })
        this.saving = false
        this.closeRecover()
        await this.load()
        uni.showToast({ title: r.income > 0 ? '已收回（多出部分记了收入）' : '已收回', icon: 'none' })
      } catch (e) {
        this.saving = false
        console.error('[prepay] 收回失败', e)
        uni.showToast({ title: String(e.message || '') || '收回失败', icon: 'none' })
      }
    },
    // ---- 结清 ----
    onSettle(p) {
      const rest = fmtYuan(p.remaining)
      this.$refs.confirmDlg.open({
        title: '结清这笔预付？',
        // 说清「钱会怎么走」，因为结清会真的记一笔支出出来，用户得知道它从哪来
        message:
          p.remaining > 0
            ? `还有 ${rest} 没报回来，结清会把它记成一笔支出（分类「${p.categoryName}」，账户「${p.accountName}」）。`
            : '这笔已经全收回来了，结清后它就从待回收列表里消失。',
        confirmText: '结清',
        cancelText: '取消',
        onConfirm: async () => {
          try {
            await settlePrepay({ prepayId: p.id })
            await this.load()
            uni.showToast({ title: '已结清', icon: 'success' })
          } catch (e) {
            console.error('[prepay] 结清失败', e)
            uni.showToast({ title: String(e.message || '') || '结清失败', icon: 'none' })
          }
        }
      })
    }
  }
}
</script>

<style lang="less">
// 页面容器本身不许滚（能滚的只有下面那块 scroll-view）。App 端的页面 body 默认是
// **可滚且带回弹**的 —— 光给 .page 写 overflow: hidden 管不到它那一层。与首页同规，
// pages.json 那边另有 app-plus.bounce: none 收口。
page {
  overflow: hidden;
}

.page {
  // 钉死在视口上（与首页同规，为什么不用 100vh 见 index.vue 那条注释）。
  // 页头固定、只有列表滚 —— 原先是 min-height，那会让页面跟着内容长高
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding-bottom: calc(40rpx + env(safe-area-inset-bottom));
  background: var(--md-surface-container);
}

// 顶栏 / 汇总行都不伸缩：flex 列里的子项默认会被压缩，不标 flex: none 的话，
// 列表一长就会把它们挤扁
.top,
.sum {
  flex: none;
}

// 列表滚动区：吃掉父容器剩下的高度。
// ★ 别补 height: 0（首页那边踩过这个坑，说明写在那一条注释里）：scroll-view 的
//   内层 100% 参照外层的**计算**高度，外层写死 0 会让它恒可滚 —— 内容再少也一样
.list-body {
  flex: 1;
  min-height: 0;
}

// 顶栏右侧的「历史」：文字按钮，比一枚时钟图标好认（这一页没有别的图标要跟它区分）
.his-btn {
  padding: 10rpx 4rpx;

  text {
    font-size: 27rpx;
    font-weight: 600;
    color: var(--md-primary-strong);
  }
}

.error-box {
  margin: 120rpx 32rpx 0;
  display: flex;
  flex-direction: column;
  align-items: center;
}

.error-text {
  font-size: 28rpx;
  color: var(--md-on-surface-variant);
}

.retry-btn {
  margin-top: 28rpx;
  padding: 18rpx 48rpx;
  border-radius: 999rpx;
  background: var(--md-primary-container);
}

.retry-text {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--md-primary-strong);
}

.sum {
  margin: 20rpx 32rpx 0;
  padding: 22rpx 28rpx;
  border-radius: 28rpx;
  background: var(--md-surface);
}

.sum-t {
  font-size: 26rpx;
  color: var(--md-on-surface-variant);
}

.sum-v {
  font-weight: 600;
  color: var(--md-on-surface);
}

.list {
  padding: 0 32rpx;
}

.card {
  margin-top: 20rpx;
  padding: 24rpx 28rpx;
  border-radius: 28rpx;
  background: var(--md-surface);
}

.c-head {
  display: flex;
  align-items: center;
  gap: 20rpx;
}

.c-txt {
  flex: 1;
  min-width: 0;
  // App 端 <view> 是块级，但两个 <text> 要各占一行仍得显式 flex 列
  display: flex;
  flex-direction: column;
  gap: 6rpx;
}

.c-title {
  font-size: 30rpx;
  font-weight: 600;
  color: var(--md-on-surface);
}

.c-sub {
  font-size: 24rpx;
  color: var(--md-on-surface-variant);
}

// 三个数：等宽三格，最后那个（待收）最重
.c-nums {
  display: flex;
  margin-top: 22rpx;
}

.c-num {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6rpx;

  .k {
    font-size: 22rpx;
    color: var(--md-outline);
  }

  .v {
    font-size: 28rpx;
    color: var(--md-on-surface-variant);
  }

  .v.strong {
    font-size: 32rpx;
    font-weight: 600;
    color: var(--md-on-surface);
  }
}

.c-btns {
  display: flex;
  gap: 20rpx;
  margin-top: 24rpx;
}

.c-btn {
  flex: 1;
  height: 76rpx;
  border-radius: 999rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--md-surface-container-high);

  text {
    font-size: 27rpx;
    font-weight: 600;
    color: var(--md-on-surface-variant);
  }

  &.primary {
    background: var(--md-primary);

    text {
      color: var(--md-on-primary);
    }
  }
}

.empty {
  margin-top: 160rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 60rpx;
}

.empty-icon {
  font-size: 72rpx;
}

.empty-t {
  margin-top: 20rpx;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--md-on-surface);
}

.empty-h {
  margin-top: 12rpx;
  font-size: 25rpx;
  line-height: 1.6;
  text-align: center;
  color: var(--md-on-surface-variant);
}

// ---- 收回卡片（与账户页的表单同一套机制：closing 撑住节点播完退场再拆）----
.rv-scrim {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: flex-end;
  animation: rvFadeIn 0.2s ease-out;

  &.closing {
    animation: rvFadeOut 0.2s ease-in forwards;
  }
}

.rv-card {
  position: relative;
  width: 100%;
  background: var(--md-surface);
  border-radius: 40rpx 40rpx 0 0;
  padding: 20rpx 32rpx calc(32rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
  animation: rvUp 0.24s cubic-bezier(0.34, 1.3, 0.6, 1);

  &.closing {
    animation: rvDown 0.2s ease-in forwards;
  }
}

.rv-grab {
  width: 72rpx;
  height: 8rpx;
  border-radius: 999rpx;
  background: var(--md-outline-variant);
  margin: 0 auto 22rpx;
}

.rv-title {
  display: block;
  font-size: 32rpx;
  font-weight: 600;
  color: var(--md-on-surface);
}

.rv-info {
  display: block;
  margin-top: 8rpx;
  font-size: 25rpx;
  color: var(--md-on-surface-variant);
}

.rv-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 26rpx;
}

.rv-label {
  flex-shrink: 0;
  font-size: 26rpx;
  color: var(--md-on-surface-variant);
}

.rv-input-wrap {
  flex: 1;
  min-width: 0;
  position: relative;
  display: flex;
  align-items: center;
}

.rv-input {
  flex: 1;
  min-width: 0;
  height: 76rpx;
  padding: 0 56rpx 0 22rpx;
  border-radius: 20rpx;
  background: var(--md-surface-container-high);
  font-size: 32rpx;
  color: var(--md-on-surface);
}

.rv-ph {
  color: var(--md-outline);
}

.rv-clear {
  position: absolute;
  right: 12rpx;
  top: 50%;
  transform: translateY(-50%);
  padding: 10rpx;
}

.rv-unit {
  flex-shrink: 0;
  font-size: 26rpx;
  color: var(--md-on-surface-variant);
}

.rv-label2 {
  display: block;
  margin-top: 28rpx;
  font-size: 26rpx;
  color: var(--md-on-surface-variant);
}

.rv-accts {
  margin-top: 16rpx;
  white-space: nowrap;
}

.rv-acct {
  flex-shrink: 0;
  padding: 12rpx 22rpx 12rpx 12rpx;
  border-radius: 999rpx;
  background: var(--md-surface-container-high);
  display: flex;
  align-items: center;
  gap: 12rpx;

  .rv-acct-t {
    font-size: 26rpx;
    color: var(--md-on-surface-variant);
  }

  &.on {
    background: var(--md-primary-container);

    .rv-acct-t {
      color: var(--md-on-primary-container);
      font-weight: 600;
    }
  }
}

// 横向排布靠 rail 而不是给 scroll-view 里的子项直接 flex（App 端 scroll-view 不认子项 flex）
.rv-acct-rail {
  display: flex;
  gap: 16rpx;
}

.rv-btns {
  display: flex;
  gap: 20rpx;
  margin-top: 36rpx;
}

.rv-cancel,
.rv-done {
  flex: 1;
  height: 84rpx;
  border-radius: 999rpx;
  display: flex;
  align-items: center;
  justify-content: center;

  text {
    font-size: 28rpx;
    font-weight: 600;
  }
}

.rv-cancel {
  background: var(--md-surface-container-high);

  text {
    color: var(--md-on-surface-variant);
  }
}

.rv-done {
  background: var(--md-primary);

  text {
    color: var(--md-on-primary);
  }
}

@keyframes rvFadeIn {
  from {
    opacity: 0;
  }
}

@keyframes rvFadeOut {
  to {
    opacity: 0;
  }
}

@keyframes rvUp {
  from {
    transform: translateY(60rpx);
    opacity: 0;
  }
}

@keyframes rvDown {
  to {
    transform: translateY(60rpx);
    opacity: 0;
  }
}
</style>
