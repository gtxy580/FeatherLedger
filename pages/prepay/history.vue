<template>
  <view class="page" :style="[{ paddingTop: statusBarHeight + 'px' }, themeVars]">
    <view class="top">
      <view class="icon-btn" @click="goBack">
        <view :style="maskStyle('chevL', 44, 'var(--md-on-surface)')"></view>
      </view>
      <text class="title">预付历史</text>
      <view class="icon-btn"></view>
    </view>

    <!-- 筛选：时间在左、粒度胶囊贴最右（用户裁定）。
         时间这枚与首页**同构**：‹ 期间 ›（点中间那串字打开滚轮，两侧箭头翻期） -->
    <view class="filters">
      <view class="month-chip">
        <view class="chev" @click="shiftPeriod(-1)">
          <view :style="maskStyle('chevL', 38, 'var(--md-on-surface-variant)')"></view>
        </view>
        <text class="period-label num" @click="openPicker">{{ periodLabel }}</text>
        <view class="chev" :class="{ off: !canForward }" @click="shiftPeriod(1)">
          <view :style="maskStyle('chevR', 38, 'var(--md-on-surface-variant)')"></view>
        </view>
      </view>
      <view class="mode-seg">
        <!-- 滑动指示块：translateX 100% 滑到「年」，transition 由样式给（与首页同一枚） -->
        <view class="seg-thumb"
          :style="{ transform: mode === 'year' ? 'translateX(100%)' : 'translateX(0)' }"></view>
        <view class="seg-btn" :class="{ on: mode === 'month' }" @click="setMode('month')"><text>月</text></view>
        <view class="seg-btn" :class="{ on: mode === 'year' }" @click="setMode('year')"><text>年</text></view>
      </view>
    </view>

    <view v-if="loadError" class="error-box">
      <text class="error-text">加载失败</text>
      <view class="retry-btn af-press" :class="{ pressing: isPressed('retry') }" @touchstart="pressOn('retry')"
        @touchend="pressOff" @touchcancel="pressOff" @click="load"><text class="retry-text">重 试</text></view>
    </view>

    <template v-else>
      <!-- 汇总说的是**净额**：这一段里垫出去的钱，最后收回来了多少 ——
           没收完就说「未收回 xxx」，收多了（报销比垫的还多）就说「多收回 xxx」 -->
      <view v-if="items.length" class="sum">
        <text class="sum-t">结清 {{ items.length }} 笔 · <text class="sum-v num">{{ sumText }}</text></text>
      </view>

      <!-- 空态**不进滚动区**（理由见 prepay.vue）：它有整个剩余高度可用，也不该能滚 -->
      <view v-if="!items.length" class="empty">
        <text class="empty-icon">🐦</text>
        <text class="empty-t">{{ periodLabel }}没有结清的预付</text>
        <text class="empty-h">换个时间看看</text>
      </view>

      <!-- **只有这一块滚**（顶栏 / 筛选 / 汇总都固定）。到底由 scroll-view 的
           scrolltolower 触发 —— 整页不再滚动，页面的 onReachBottom 就等不到了 -->
      <!-- 高度交回 CSS（flex: 1 吃满剩余空间）；能不能滚由 scroll-y 说了算。
           ★ 别再往这里塞固定高度：锁成「测量那一瞬的内容高」的话，长按展开
             「取消结清」把卡片撑高，多出来的那段就直接被裁掉 -->
      <!-- ★ scroll-with-animation 跟着「这一趟是哪种滚动」走（见 scrollAnimated）：
           换期回顶要**瞬间**到位（用户裁定：不要滚动过程），滚到某天才有滚动过程 -->
      <scroll-view v-else class="list-body" :scroll-y="listScrollable" :scroll-top="scrollTop"
        :scroll-into-view="scrollIntoView" :scroll-with-animation="scrollAnimated" @scroll="onListScroll"
        @scrolltolower="onListLower">
      <view class="list">
        <!-- 长按一张卡 → 它下面滑出「取消结清」（再长按 / 点别处收起）。
             卡片本身没有点击行为，所以长按不会和别的操作打架 -->
        <view v-for="p in visibleItems" :key="p.id" :id="'c-' + p.date" class="card" @longpress="actOn(p.id)">
          <view class="c-head">
            <category-icon :icon="p.categoryIcon" :color="p.categoryColor" :name="p.categoryName" :size="76" />
            <view class="c-txt">
              <text class="c-title">{{ p.categoryName }}</text>
              <text class="c-sub">{{ subOf(p) }}</text>
            </view>
            <text class="c-date num">{{ p.date }}</text>
          </view>
          <!-- 三个数讲完一笔预付的一生：垫了多少、收回来多少、最后自己承担了多少 -->
          <view class="c-nums">
            <view class="c-num">
              <text class="k">垫付</text>
              <text class="v num">{{ fmtYuan(p.amount) }}</text>
            </view>
            <view class="c-num">
              <text class="k">收回</text>
              <text class="v num">{{ fmtYuan(p.recovered) }}</text>
            </view>
            <view class="c-num">
              <text class="k">差额</text>
              <text class="v num strong">{{ fmtYuan(p.remaining) }}</text>
            </view>
          </view>
          <view v-if="actingId === p.id" class="c-acts">
            <view class="c-act af-press" :class="{ pressing: isPressed('unsettle') }" @touchstart="pressOn('unsettle')"
              @touchend="pressOff" @touchcancel="pressOff" @click="askUnsettle(p)"><text>取消结清</text></view>
          </view>
        </view>

      </view>
      </scroll-view>
    </template>

    <!-- 期间切换：日历（月态弹月历、年态弹年历）。这里原来是滚轮。
         ★ 弹层里的 ›‹ 与页面上那对是同一件事（都走 shiftPeriod）：翻到哪期，
           底下的列表就跟着换到哪期，格子里的数因此永远是真的 -->
    <view v-if="showPicker" class="af-scrim" :class="{ closing: pkClosing }" @click="closePicker">
      <view class="af-blocker"></view>
      <view class="af-card" :class="{ closing: pkClosing }" @click.stop>
        <view class="af-grab"></view>
        <period-calendar :mode="mode" :year="calYear" :month="calMonth" :today="todayStr"
          :values="periodValues" @pick="onCalendarPick" @shift="shiftPeriod" />
        <view class="af-btns">
          <view class="af-cancel af-press" :class="{ pressing: isPressed('pk') }" @touchstart="pressOn('pk')"
            @touchend="pressOff" @touchcancel="pressOff" @click="closePicker"><text>关闭</text></view>
        </view>
      </view>
    </view>

    <!-- 自绘确认框（easycom 自动注册） -->
    <confirm-dialog ref="confirmDlg" />
  </view>
</template>

<script>
import { listSettledPrepays, unsettlePrepay } from '@/services/prepay.js'
import { fmtYuan } from '@/services/format.js'
import { maskStyle } from '@/services/icons.js'
import pressFx from '@/services/press.js'
import PeriodCalendar from '@/components/period-calendar/period-calendar.vue'
import { sumByKey, todayKey, canGoForward, gridKeyOf } from '@/services/calendar.js'

// 列表懒加载：首屏只渲染这么多张卡，滚到底再补一批（与首页/分类明细同一套）
const LAZY_ROWS = 60

export default {
  components: { PeriodCalendar },
  mixins: [pressFx],
  data() {
    return {
      statusBarHeight: 0,
      items: [],
      totalAmount: 0,
      totalRecovered: 0,
      // 懒加载：渲染到第几张卡（切出来的是 visibleItems）。
      // 汇总那几个数仍按 items 全量算 —— 它们要的是这一期总共结清了多少
      shownRows: LAZY_ROWS,
      // 列表滚动位置（只用来「换粒度/翻期回到顶部」；用户自己滚不会回写这里）
      scrollTop: 0,
      // 这一块能不能滚：由 measureList() 按「内容是否真的超过可用高度」决定。
      // 内容装得下就直接把 scroll-y 关掉 —— scroll-view 内部认的「内容高度」跟它渲染
      // 出来的框高对不上（实测：框 707、.list 只有 280，却滚了 75px），跟它算不明白，
      // 干脆按我们自己量到的数决定让不让它滚
      listScrollable: false,
      // 上次 load 的「粒度 + 期间」指纹：变了才把列表收回首屏
      loadKey: '',
      loadError: false,
      loadToken: 0,
      // 长按哪一张卡（它下面才显示「取消结清」）；null = 都没长按
      actingId: null,
      // 粒度：月一屏 / 年一屏（用户裁定加那枚胶囊）
      mode: 'month',
      // 期间：'YYYY-MM'（月模式）与年份（年模式）
      month: '',
      year: 0,
      showPicker: false,
      pkClosing: false,
      pkTimer: null,
      // 滚到哪张卡（形如 'c-2026-10-09'）。★ 只在「点日历」时设，用户一动手指就清掉 ——
      // 不清的话，之后任何一次重渲染都会把列表拽回那天
      scrollIntoView: '',
      // 这一趟滚动要不要动画：换期回顶 = 不要（用户裁定），「滚到某天」= 要。
      // ★ scroll-with-animation 是**滚动容器**的属性、不是每次调用的参数，
      //   所以只能按趟切换；切换与滚动指令分两个 tick（见 load / scrollToDay）
      scrollAnimated: false,
    }
  },
  computed: {
    /** 点期次时弹的日历看哪一期 */
    calYear() {
      return this.mode === 'year' ? this.year : Number(this.month.slice(0, 4))
    },
    calMonth() {
      return Number(this.month.slice(5, 7)) || 1
    },
    /** 只有月态画「今天」那一圈（年态没有「天」这个格子） */
    todayStr() {
      return this.mode === 'year' ? '' : todayKey()
    },
    /**
     * 喂给日历的每格数字：那天**结清的预付差额**，分成收、支两笔（分，都是正数）。
     *
     * ★ 用 `remaining`（= 垫付 − 收回）而不是 `amount`，是为了**与顶上那行汇总同口径** ——
     *   它说的就是这个数（「未收回 X」/「多收回 X」）。口径不一致的话卡片上的数和日历里的数会对不上。
     * ★ 正负各自成行：`remaining > 0` 是**还没报回来的**（支）、`< 0` 是**多收回来的**（收）——
     *   与汇总那两句话同一套说法。一天里两种都可能出现，所以两行都得给。
     * ★ 同一天可能结清好几笔，靠 sumByKey **累加**。
     * ★ 用全量 items，不是 visibleItems（后者是懒加载切过的）。
     * ★ 键按**格子**的形状走（gridKeyOf）：月态按天、年态按月。这条不能想当然 ——
     *   之前一直按天累加，年态的格子问的是 'YYYY-MM'，整片空白且不报错。
     */
    periodValues() {
      return sumByKey(this.items, (p) => gridKeyOf(p.date, this.mode === 'year'), (p) => p.remaining)
    },
    periodLabel() {
      if (this.mode === 'year') return `${this.year}年`
      const [y, m] = (this.month || '').split('-')
      return m ? `${y}年${Number(m)}月` : ''
    },
    /**
     * 汇总那一句：说的是**净额** = 收回 − 垫付。
     *   > 0 → 报销回来的比垫出去的多（多收的那部分当时记成了收入）
     *   < 0 → 还有没报回来的（结清时那部分记成了支出）
     *   = 0 → 一来一回刚好平
     */
    sumText() {
      const net = this.totalRecovered - this.totalAmount
      if (net === 0) return '刚好收平'
      return `${net > 0 ? '多收回' : '未收回'} ${fmtYuan(Math.abs(net))}`
    },
    /** 已是最新一期（当年/当月）：右箭头置灰、也不能再往后翻（与首页同一判据、同一实现） */
    canForward() {
      if (this.mode === 'year') return canGoForward({ year: this.year }, true)
      const [y, m] = this.month.split('-').map(Number)
      return canGoForward({ year: y, month: m }, false)
    },
    /** 当前粒度下的起止（含），也是查询用的范围 */
    range() {
      if (this.mode === 'year') {
        return { start: `${this.year}-01-01`, end: `${this.year}-12-31` }
      }
      const [y, m] = this.month.split('-').map(Number)
      const last = new Date(y, m, 0).getDate()
      return { start: `${this.month}-01`, end: `${this.month}-${String(last).padStart(2, '0')}` }
    },
    /**
     * 真正渲染出去的那一段（列表懒加载）—— 见 index.vue 里那套的说明。
     * 这一页的「结清 N 笔」「未收回 xxx」仍旧按 items 全量算：结清几笔是这一期的总数，
     * 不该随用户往下滚而变。
     */
    visibleItems() {
      return this.items.slice(0, this.shownRows)
    },
    hasMore() {
      return this.shownRows < this.items.length
    }
  },
  onLoad() {
    this.statusBarHeight = (uni.getSystemInfoSync().statusBarHeight) || 0
    const d = new Date()
    this.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    this.year = d.getFullYear()
  },
  onReady() {
    this.measureList()
  },
  watch: {
    // 空态 ↔ 列表来回切时 .list-body 会新建/销毁，得重量一次
    'items.length'() {
      this.$nextTick(this.measureList)
    },
    // 长按展开「取消结清」会让内容变高：重量一次，真超过一屏才放开滚动
    actingId() {
      this.$nextTick(this.measureList)
    }
  },
  onShow() {
    this.load()
  },
  onUnload() {
    if (this.pkTimer) clearTimeout(this.pkTimer)
  },
  /** 安卓返回键：滚轮开着时先收它 */
  onBackPress() {
    if (this.showPicker) {
      this.closePicker()
      return true
    }
    return false
  },
  methods: {
    /**
     * 量出列表区该有多高，直接给它一个像素高度。
     *
     * 为什么不让 CSS 算：这一页为此折腾了四轮 —— .page 试过 min-height / 100vh / flex 分配，
     * 真机上**总差那么一丁点**（现象是「内容明明不多，却刚好能拖出一个卡片间距，而且拖到哪算哪」）。
     * App 端的页面容器高度、scroll-view 的包装结构都参与计算，纸面上算不准。
     * 改成量 scroll-view **自己的 top** 再拿窗口高去减：top 只由它上面的页头决定，
     * 跟它自己多高没有关系 —— 这是个不受循环影响的稳定锚点。
     *
     * 空态时这块不存在（它挂在 v-else 上），rect 为 null，直接跳过：那时候本来也不需要高度。
     */
    measureList() {
      // ★ in(this)：本页含自定义组件（category-icon / confirm-dialog），
      //   不带 in 时选择器未必落得到页面自己的节点上
      const q = uni.createSelectorQuery().in(this)
      q.select('.list-body').boundingClientRect()
      q.select('.list').boundingClientRect()
      q.exec((res) => {
        const b = res && res[0]
        const l = res && res[1]
        if (!b) return // 空态时这块不存在，本来也不需要滚
        const avail = Math.max(0, uni.getSystemInfoSync().windowHeight - b.top)
        const content = l ? l.height : 0
        // 内容确实超过可用高度才允许滚（+1 容差躲浮点）—— 装得下就物理上关掉滚动能力。
        // 容器高度本身**不锁**（交回 CSS 的 flex: 1）：锁死会把长按展开的那一截裁掉
        this.listScrollable = content > avail + 1
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
    /** ‹ › 翻一期（与首页同一套：月按 Date 进位跨年，年直接加减） */
    shiftPeriod(delta) {
      if (delta > 0 && !this.canForward) return // 已是最新一期：静默返回（按钮另有置灰）
      const p = (n) => String(n).padStart(2, '0')
      if (this.mode === 'year') {
        this.year += delta
      } else {
        const [y, m] = this.month.split('-').map(Number)
        const d = new Date(y, m - 1 + delta, 1) // Date 自动进位跨年
        this.month = `${d.getFullYear()}-${p(d.getMonth() + 1)}`
      }
      this.load()
    },
    setMode(m) {
      if (this.mode === m) return
      this.mode = m
      this.load()
    },
    async load(opts = {}) {
      const token = ++this.loadToken
      try {
        // 起止由 computed 给（范围谓词才能用上 records(date) 索引，与 record.js 同一套算法）
        const { start, end } = this.range
        const rows = await listSettledPrepays({ start, end })
        if (token !== this.loadToken) return // 已换筛选，晚到的响应丢弃
        this.items = rows
        this.totalAmount = rows.reduce((n, p) => n + p.amount, 0)
        this.totalRecovered = rows.reduce((n, p) => n + p.recovered, 0)
        // 懒加载进度：换粒度/翻期才收回首屏；取消结清后 onShow 的同一期重查保留已滚出的部分
        const key = `${this.mode}|${this.month}|${this.year}`
        if (key !== this.loadKey) {
          this.loadKey = key
          this.shownRows = LAZY_ROWS
          // 回到列表顶部。scroll-view 只在值**变化**时响应 —— 在 0 上再设 0 没用，
          // 先抖半像素（人眼看不出来）。
          // ★ 这一趟要**瞬间**到位（用户裁定：不要滚动过程）：先关掉动画，下一个 tick 再抖
          // ★ 但紧接着要「滚到某天」的那一趟**不回顶**（opts.jumpToDay 就是那个信号）：
          //   回顶再滚下去，人看到的是先闪回顶部、再往下走一趟，多余且难看；
          //   而"滚到那天"本来就会把列表摆到那一天的卡片上
          if (!opts.jumpToDay) {
            this.scrollAnimated = false
            this.$nextTick(() => { this.scrollTop = this.scrollTop === 0 ? 0.5 : 0 })
          }
        }
        this.loadError = false
      } catch (e) {
        console.error('[prepay-history] 加载失败', e)
        if (token !== this.loadToken) return
        this.loadError = true
      }
    },
    /** 长按一张卡：它下面滑出「取消结清」。再长按同一张就收起（卡片没有别的点击行为，不打架） */
    actOn(id) {
      this.actingId = this.actingId === id ? null : id
    },
    /**
     * 取消结清：把这笔放回「还挂着」，结清时补记的那两条一并撤掉。
     * ★ 要确认一下 —— 它会删掉两条流水，而「已经收回来多少」这个数在撤完后仍然成立，
     *   用户看着卡片上的数会有那么一瞬间以为「没变化」，得让他先看清楚要撤的是什么。
     */
    askUnsettle(p) {
      this.actingId = null
      this.$refs.confirmDlg.open({
        title: '取消结清？',
        message: `这笔会回到待回收列表；结清时补记的那笔支出（${fmtYuan(p.remaining)}）也会一并撤掉。已经收回来的钱不动。`,
        confirmText: '取消结清',
        cancelText: '再想想',
        onConfirm: async () => {
          try {
            await unsettlePrepay({ prepayId: p.id })
            await this.load()
            uni.showToast({ title: '已取消结清', icon: 'success' })
          } catch (e) {
            console.error('[prepay-history] 取消结清失败', e)
            uni.showToast({ title: String(e.message || '') || '操作失败', icon: 'none' })
          }
        }
      })
    },
    /** 副标题：哪个账户垫的 · 备注（有才拼，不留半个分隔符） */
    subOf(p) {
      const parts = []
      if (p.accountName) parts.push(p.accountName)
      if (p.note) parts.push(p.note)
      return parts.join(' · ')
    },
    // ---- 期间切换：点期次弹日历（这里原来是滚轮）----
    openPicker() {
      this.pkClosing = false
      this.showPicker = true
    },
    /**
     * 点日历上的一格（月态 'YYYY-MM-DD'、年态 'YYYY-MM'）。
     * 与首页同一套：换期要重查，然后滚到那天的第一张卡。
     */
    async onCalendarPick(key) {
      if (this.mode === 'year') {
        // 年态点某月 → 切到月视角看那个月（与首页同规）
        this.month = key
        this.year = Number(key.slice(0, 4))
        this.mode = 'month'
        this.closePicker()
        await this.load()
        return
      }
      const toMonth = key.slice(0, 7)
      const changed = this.month !== toMonth
      if (changed) this.month = toMonth
      this.closePicker()
      // ★ 告诉 load "这趟紧接着要滚到那天"，它就不会先把我送回顶部
      if (changed) await this.load({ jumpToDay: true })
      this.scrollToDay(key)
    },
    /**
     * 滚到那天的第一张卡。★ 与首页同一个道理：**必须先把目标渲染出来** ——
     * 列表是懒加载切片的（visibleItems），节点不在时 scroll-into-view 会静默失败。
     */
    scrollToDay(dateKey) {
      // ★ 那天**可能有好几张卡**（一天结清好几笔，items 按 date DESC 排、同一天连着）。
      //   要数到那天的**最后一张**为止 —— 只数到第一张的话，滚过去只看得到一张，
      //   后面几张压根没渲染出来，而这时列表又没有多少可滚的余量把它们带出来，
      //   用户就卡在「我明明那天结清了两笔」那里
      let rows = 0
      let hit = false
      for (const p of this.items) {
        if (p.date === dateKey) hit = true
        else if (hit) break
        rows++
      }
      if (!hit) return // 那天没有结清记录：没有可滚的目标，指令也别留下
      if (rows > this.shownRows) this.shownRows = rows
      // 「滚到那天」这一趟**要**滚动过程：动画才看得出来是"过去了"
      this.scrollAnimated = true
      this.$nextTick(() => { this.scrollIntoView = 'c-' + dateKey })
    },
    /** 用户自己一滚，就清掉「滚到某天」的指令 */
    onListScroll() {
      if (this.scrollIntoView) this.scrollIntoView = ''
    },
    closePicker() {
      if (!this.showPicker || this.pkClosing) return
      this.pkClosing = true
      this.pkTimer = setTimeout(() => {
        this.showPicker = false
        this.pkClosing = false
        this.pkTimer = null
      }, 200)
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
  background: var(--md-surface-container);
  // ★ 这里**不加 padding-bottom**（原来那句挪到 .list 上了）：列表区高度是靠
  //   「窗口高 − scroll-view 的 top」量出来的，.page 只要自带下内边距，量出来就会
  //   把它算进去 —— 那又多出「刚好能拖一点」的一截，正是这几轮一直在打的那个偏差
}

// 顶栏 / 筛选行 / 汇总行都不伸缩：flex 列里的子项默认会被压缩，
// 不标 flex: none 的话，列表一长就会把它们挤扁
.top,
.filters,
.sum {
  flex: none;
}

// 列表滚动区：CSS 这套只是**兜底**（测量还没回来时撑住），
// 真正的高度由 measureList() 量出来写成内联 style —— 理由见那个方法。
// ★ 别补 height: 0：scroll-view 内层 100% 参照外层的**计算**高度，写死 0 会让它恒可滚
.list-body {
  flex: 1;
  min-height: 0;
}

// 时间贴左、胶囊贴右（用户裁定）
.filters {
  padding: 4rpx 32rpx 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

// 月 / 年切换胶囊 —— **与首页那一枚完全同构**（用户裁定）：同样的尺寸、同样的
// 实色主色滑动块、同样的弹性 transition。两页的同一个控件长得不一样最费解。
.mode-seg {
  flex-shrink: 0;
  position: relative;
  display: flex;
  // 用填充底代替 1rpx 描边：真机上那条发丝线看着像脏边（首页踩过的反馈）
  background: var(--md-surface);
  border-radius: 999rpx;
  overflow: hidden;

  // 滑动指示块：宽度 = 一个按钮（各占一半），translateX 由模板按模式给
  .seg-thumb {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 50%;
    border-radius: 999rpx;
    // 实色主色：淡染色块与填充底几乎同色，看不出选中（首页踩过的反馈）
    background: var(--md-primary);
    transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  .seg-btn {
    position: relative; // 压在滑动块之上
    z-index: 1;
    width: 80rpx;
    height: 64rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 26rpx;
    font-weight: 500;
    color: var(--md-on-surface-variant);

    &.on {
      color: var(--md-on-primary);
      font-weight: 600;
    }
  }
}

// 期间 chip —— **与首页那一枚同构**（用户裁定）：‹ 期间 ›，点中间的字开滚轮，两侧箭头翻期
.month-chip {
  display: flex;
  align-items: center;
  background: var(--md-surface);
  border-radius: 999rpx;
  padding: 8rpx 12rpx;

  .chev {
    width: 60rpx;
    height: 60rpx;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;

    // 已是最新一期：置灰
    &.off {
      opacity: 0.25;
    }
  }

  .period-label {
    min-width: 220rpx;
    text-align: center;
    font-size: 28rpx;
    font-weight: 600;
    color: var(--md-on-surface);
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
  // 底部安全区的留白放在**滚动内容里**（原来挂在 .page 的 padding-bottom 上，理由见 .page）
  padding-bottom: calc(40rpx + env(safe-area-inset-bottom));
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

.c-date {
  flex-shrink: 0;
  font-size: 23rpx;
  color: var(--md-outline);
}

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

// 长按后滑出来的操作行（目前只有「取消结清」一枚）
.c-acts {
  margin-top: 22rpx;
  padding-top: 22rpx;
  border-top: 2rpx solid var(--md-outline-variant);
  display: flex;
  animation: actsIn 0.18s ease-out;
}

.c-act {
  flex: 1;
  height: 72rpx;
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
}

@keyframes actsIn {
  from {
    opacity: 0;
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

</style>
