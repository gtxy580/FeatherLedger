<template>
  <view id="sp-top" class="sp">
    <!-- 抬头区（粘性）：标题行 + 粒度切换 + 期间/收支 + 加载条。
         面板很长时向下滚也看得见，随时能切粒度与期间（用户裁定） -->
    <!-- padding-top 让粘住时背景盖住状态栏；等量的负 margin-top 抵消它在静止时的占位，
         否则标题会被平白推下去一整个状态栏的高度（用户反馈「离分区上方太远」） -->
    <view class="sp-sticky" :style="{ paddingTop: statusBarHeight + 'px', marginTop: -statusBarHeight + 'px' }">
    <!-- 标题行：图标 + 标题 + 粒度切换（tab + 滑动指示条） -->
    <view class="sp-head">
      <view :style="maskStyle('chart', 32, 'var(--md-primary-strong)')"></view>
      <text class="sp-title">收支图表</text>
      <view class="sp-gran">
        <view v-for="g in GRANS" :key="g.key" class="sp-gran-item" :class="{ on: gran === g.key }"
          @click="setGran(g.key)">
          <text>{{ g.label }}</text>
        </view>
        <view class="sp-gran-bar" :style="{ transform: 'translateX(' + granIndex * 100 + '%)' }"></view>
      </view>
    </view>

    <!-- 期间 + 收支同一行 -->
    <view class="sp-ctrl">
      <view class="seg">
        <view class="seg-thumb" :class="{ right: type === 2 }"></view>
        <view class="seg-btn" :class="{ on: type === 1 }" @click="setType(1)"><text>支出</text></view>
        <view class="seg-btn" :class="{ on: type === 2 }" @click="setType(2)"><text>收入</text></view>
      </view>
      <view class="sp-period">
        <view class="sp-nav" @click="shift(-1)">
          <view :style="maskStyle('chevL', 34, 'var(--md-on-surface-variant)')"></view>
        </view>
        <text class="sp-period-t" @click="openQuick">{{ periodLabel }}</text>
        <view class="sp-nav" :class="{ off: !canForward }" @click="shift(1)">
          <view :style="maskStyle('chevR', 34, 'var(--md-on-surface-variant)')"></view>
        </view>
      </view>
    </view>

    <!-- 加载条：不清空旧图，只在顶部走一条细线 -->
    <view class="sp-loading" :class="{ on: loading }"></view>
    </view>

    <!-- 错误态 -->
    <view v-if="loadError" class="sp-error">
      <text class="sp-error-t">统计加载失败</text>
      <view class="sp-retry" @click="load"><text>重 试</text></view>
    </view>

    <template v-else>
      <!-- 期间摘要：本期 / 日均 / 较上期（名字随粒度走，见 sumLabels）。放在分类占比**之前** —— 先给总量，再拆到结构 -->
      <view v-if="sum" class="sp-sum">
        <view class="sp-sum-cell">
          <text class="sp-sum-k">{{ sumLabels[0] }}</text>
          <text class="sp-sum-v num">{{ fmtYuan(sum.total) }}</text>
        </view>
        <view class="sp-sum-cell">
          <text class="sp-sum-k">{{ sumLabels[1] }}</text>
          <text class="sp-sum-v num">{{ fmtYuan(sum.daily) }}</text>
        </view>
        <view class="sp-sum-cell">
          <text class="sp-sum-k">{{ sumLabels[2] }}</text>
          <text class="sp-sum-v num" :class="deltaClass">{{ deltaText }}</text>
        </view>
      </view>
      <!-- 分类占比 -->
      <view class="sp-sec">
        <view class="sp-sec-head">
          <text class="sp-sec-title">分类占比</text>
          <!-- 层级切换：与收支同一套胶囊（用户裁定）——只作用于分类图，紧贴它上方 -->
          <view class="seg">
            <view class="seg-thumb" :class="{ right: level === 'sub' }"></view>
            <view class="seg-btn" :class="{ on: level === 'top' }" @click="setLevel('top')"><text>主分类</text></view>
            <view class="seg-btn" :class="{ on: level === 'sub' }" @click="setLevel('sub')"><text>子分类</text></view>
          </view>
        </view>

        <view v-if="!catRows.length" class="sp-empty">
          <text class="sp-empty-t">这段时间还没有记账</text>
        </view>

        <view v-else class="sp-bars">
          <!-- 整行可点：下钻到这一分类的明细（用户裁定）。按压反馈与「我的」页那排入口同一套，
               免得同一个「能点的东西」在两处是两种手感 -->
          <view v-for="r in catRows" :key="r.key" class="sp-row af-press" :class="{ pressing: isPressed(r.key) }"
            @touchstart="pressOn(r.key)" @touchend="pressOff" @touchcancel="pressOff" @click="pickCategory(r)">
            <category-icon :icon="r.icon" :color="r.color" :name="r.iconName" :size="48" />
            <view class="sp-row-mid">
              <text class="sp-row-name">{{ r.name }}</text>
              <view class="sp-track">
                <view class="sp-fill" :style="{ width: r.pct + '%', backgroundColor: r.barColor }"></view>
              </view>
            </view>
            <text class="sp-row-amt num">{{ fmtYuan(r.amount) }}</text>
            <text class="sp-row-pct num">{{ r.pctText }}</text>
          </view>
        </view>
      </view>

      <!-- 趋势：本期 vs 上期（图例名字随粒度走，见 trendLabels），双折线 -->
      <view class="sp-sec">
        <view class="sp-sec-head">
          <text class="sp-sec-title">{{ trendTitle }}</text>
          <view class="sp-legend">
            <view class="sp-lg">
              <view class="sp-lg-dot" :style="{ backgroundColor: curColor }"></view>
              <text class="sp-lg-t">{{ trendLabels[0] }}</text>
            </view>
            <view class="sp-lg">
              <view class="sp-lg-dot" :style="{ backgroundColor: prevColor }"></view>
              <text class="sp-lg-t">{{ trendLabels[1] }}</text>
            </view>
          </view>
        </view>

        <!-- 绘图区：先量一次尺寸（px），折线才能算角度与长度；空态时叠一层提示 -->
        <view class="sp-chart">
          <!-- Y 轴：只标两档（中/顶），0 由下方基线代替；刻度线与数据点共用同一套顶部留白。
               ★ 这一列**必须始终占位**，不能按「有没有数据」来挂 v-if：它的宽度（88rpx）就是
               绘图区与横轴刻度的左起点，一旦无数据时被拿掉，整条横轴会左移 88rpx ——
               起点跑到与「有数据时」不同的位置（用户反馈）。无数据时 yTicks 本身就是空数组，
               所以这列只是空着，不会多画出刻度或网格线（网格线同样由 yTicks 驱动）。 -->
          <view class="sp-yaxis">
            <text v-for="(t, i) in yTicks" :key="'y' + i" class="sp-ytick" :style="{ bottom: t.bottom }">{{ t.label }}</text>
          </view>
          <view class="sp-plot-col">
            <view id="sp-plot" class="sp-plot">
            <view class="sp-baseline"></view>
            <view v-for="(t, i) in yTicks" :key="'gl' + i" class="sp-grid" :style="{ bottom: t.bottom }"></view>
            <view v-for="(g, i) in chart.segs" :key="'g' + i" class="sp-seg" :style="g"></view>
            <view v-for="(d, i) in chart.dots" :key="'d' + i" class="sp-dot" :style="d"></view>
            <view v-if="!trendHasData" class="sp-plot-empty">
              <text class="sp-empty-t">这段时间还没有记账</text>
            </view>
            </view>

            <!-- 横轴刻度：必须与绘图区同宽同起点（左边有 Y 轴列），否则整体偏移、与数据点对不齐。
                 内部用绝对定位到 i/(n-1)，flex 等分会给每个刻度加半格偏移 -->
            <view class="sp-ticks">
              <text v-for="(t, i) in trend" :key="'t' + i" class="sp-tick"
                :class="{ hide: !showTrendLabel(i), first: i === 0, last: i === trend.length - 1 }"
                :style="{ left: tickLeft(i) }">{{ t.label }}</text>
            </view>
          </view>
        </view>
      </view>
    </template>
    <!-- 快速切换期间：自绘滚轮（与首页/记一笔的滚轮同一套——picker-view 在页面内、样式可控；
         年列止于今年、当年期列止于本月，因此滚不出未来期间，与 › 的裁定一致） -->
    <view v-if="quickOpen" class="af-scrim" :class="{ closing: quickClosing }" @click="closeQuick">
      <view class="af-blocker"></view>
      <view class="af-card" :class="{ closing: quickClosing }" @click.stop>
        <view class="af-grab"></view>
        <text class="af-title">选择{{ granLabel }}</text>
        <!-- 选中行由 .pv-capsule 自己画（uni 的指示条按列各画一条，两列就会断开）；
             indicator-style 只留高度，保证滚轮的选中槽与胶囊对齐 -->
        <view class="pv-wrap">
          <view class="pv-capsule"></view>
          <picker-view class="pv-view sp-pv" :value="pvIndex" indicator-style="height: 88rpx;" @change="onPvChange">
            <picker-view-column>
              <view v-for="y in pvYears" :key="y" class="sp-pv-cell">{{ y }}年</view>
            </picker-view-column>
            <picker-view-column v-if="gran !== 'year'">
              <view v-for="u in pvUnits" :key="u.v" class="sp-pv-cell">{{ u.label }}</view>
            </picker-view-column>
          </picker-view>
        </view>
        <view class="af-btns">
          <view class="af-cancel af-press" :class="{ pressing: isPressed('cancel') }" @touchstart="pressOn('cancel')"
            @touchend="pressOff" @touchcancel="pressOff" @click="closeQuick"><text>取消</text></view>
          <view class="af-done af-press" :class="{ pressing: isPressed('ok') }" @touchstart="pressOn('ok')"
            @touchend="pressOff" @touchcancel="pressOff" @click="confirmPeriod"><text>确定</text></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { getCategoryStats, getTrendStats } from '@/services/record.js'
import { foldToTop, flatSubRows, summarizePeriod } from '@/services/stats.js'
import { fmtYuan, fmtPercent, fmtYuanShort, periodText } from '@/services/format.js'
import { maskStyle } from '@/services/icons.js'
import pressFx from '@/services/press.js'

// 只有月/年 —— 周报已按用户要求去掉，连带那套 ISO 周历（周年/周序号/周→周一/某年多少周）
// 一起删了；要看它们长什么样，翻 git 历史。
const GRANS = [
  { key: 'month', label: '月报' },
  { key: 'year', label: '年报' }
]

const PLOT_PAD = 0.12 // 折线区顶部留白比例：最高点不贴顶（用户反馈「太挤了」）

const p2 = (n) => String(n).padStart(2, '0')
const parseDate = (s) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const fmtDate = (dt) => `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}`

/**
 * 给定粒度与日期，返回该粒度的**期间起点**（'YYYY-MM-DD'）。
 * range 与 canForward 共用它——「本月的 1 号」这种算法如果写两遍，两处迟早会漂移，
 * 而漂移的表现是「按钮能点但切不过去」或「不该能点时能点」，都很难查。
 */
function periodStartOf(gran, d) {
  if (gran === 'month') return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-01`
  return `${d.getFullYear()}-01-01`
}

export default {
  mixins: [pressFx],
  name: 'stats-panel',
  data() {
    return {
      GRANS,
      gran: 'month', // 'month' | 'year'（默认月报 —— 原先默认的周报已去掉）
      anchor: '', // 'YYYY-MM-DD'，期间锚点；onLoad 时置为今天
      // 期间滚轮（与首页/记一笔的滚轮同一套）：年列 + 月份列，年视图只有年列
      pvYears: [],
      pvUnits: [],
      pvIndex: [0],
      type: 1, // 1=支出 2=收入
      level: 'top', // 'top' | 'sub'，只影响分类图
      cats: [], // getCategoryStats 的原始平铺行（两个层级共用）
      trend: [], // 本期：getTrendStats 的结果（桶已补全）
      prevTrend: [], // 上期：同一函数换一个范围再调一次
      // 期间摘要（本期/日均/较上期）。**在 load() 里算完存下来，不做 computed**：
      // range 是 computed（切粒度立刻变），而 trend 要等查询回来才换 —— 做成 computed
      // 就会在新期间的时长上除旧金额，切粒度时数字乱跳。存下来才能保证与数据同源。
      sum: null,
      plotW: 0, // 绘图区尺寸（px），量一次后所有折线坐标都在 px 空间里算
      plotH: 0,
      // 快速切换期间（点击期间标签弹出）
      statusBarHeight: 0, // 自定义导航栏页：粘性头部要自己让开状态栏
      quickOpen: false,
      quickClosing: false,
      quickTimer: null,
      loading: false,
      loadError: false,
      loadToken: 0
    }
  },
  computed: {
    granIndex() {
      return GRANS.findIndex((g) => g.key === this.gran)
    },
    /** 期间的起止日（含），全部由 gran + anchor 推导 */
    range() {
      return this.rangeOf(this.gran, this.anchor)
    },
    /** 弹层标题跟着粒度走 */
    granLabel() {
      return this.gran === 'month' ? '月' : '年'
    },
    /** 能不能往后翻：不允许切到「当天之后」（用户裁定） */
    canForward() {
      const { start } = this.range
      if (!start) return false
      // 期间起点都是 'YYYY-MM-DD'，字典序即时间序 → 直接比字符串即可
      return start < periodStartOf(this.gran, new Date())
    },
    /** 期间标签：月/年都是单值（文案来自 format.js 的 periodText） */
    periodLabel() {
      return this.labelOf(this.gran, this.anchor)
    },
    /** 两期共用的最大值（Y 轴顶） */
    chartMax() {
      return Math.max(1, ...this.trend.map((x) => x.amount), ...this.prevTrend.map((x) => x.amount))
    },
    /**
     * Y 轴刻度：只取三档（0 / 中 / 顶）——用户裁定「抽稀纵坐标」。
     * bottom 用百分比，与折线共用同一套顶部留白（PLOT_PAD），所以刻度线与数据点天然对齐。
     */
    yTicks() {
      // 空期间整轴隐藏：max 兜底为 1 时两档都会被格式化成「0」，
      // 于是画面上出现两条都标着 0 的网格线（网格线由 yTicks 驱动，所以一起消失）
      if (!this.trendHasData) return []
      const max = this.chartMax
      // 不显示 0（用户裁定）：基线由单独的 .sp-baseline 画，刻度只标「中」与「顶」
      return [max / 2, max].map((v) => ({
        label: fmtYuanShort(v),
        bottom: (v / max) * (1 - PLOT_PAD) * 100 + '%'
      }))
    },
    /**
     * 较上期那一格的文字：持平不显示 0，涨跌带正负号。
     *
     * **不用 ↑/↓**：这两个字符不在系统的中文 UI 字体里（PingFang / Noto Sans CJK 都不收
     * Arrows 区），会走字体回退 —— 回退字体的 ascent 更大，把行盒撑高、字形顺着基线往下掉，
     * 于是这一格比旁边两格「偏下」。± 是 ASCII，一定在同一个字体里，行盒不会被撑开。
     * 方向的含义本来就由颜色承担（红=变坏、绿=变好），符号只负责「增还是减」。
     */
    deltaText() {
      const s = this.sum
      if (!s) return ''
      if (s.dir === 'flat') return '持平'
      return (s.dir === 'up' ? '+' : '-') + fmtYuan(Math.abs(s.delta))
    },
    /** 颜色语义：支出变多是坏、变少是好；收入正好反过来。持平不上色 */
    deltaClass() {
      const s = this.sum
      if (!s || s.dir === 'flat') return 'flat'
      const good = this.type === 1 ? s.dir === 'down' : s.dir === 'up'
      return good ? 'good' : 'bad'
    },
    /**
     * 趋势图例的两个期间名：本月/上月、本年/上年。
     *
     * 与 sumLabels 同一套拼法（都从 granLabel 拼），**别在模板里写死** —— 写死的话
     * 切到「年报」，图例还写着「本期/上期」，跟上面那排期间标签对不上。
     */
    trendLabels() {
      return [`本${this.granLabel}`, `上${this.granLabel}`]
    },
    /** 三格的标签。跟着粒度走（本月/上月、本年/上年）—— 「本期/较上期」在年报里读着别扭 */
    sumLabels() {
      const dir = this.type === 1 ? '支出' : '收入'
      return [`本${this.granLabel}${dir}`, `日均${dir}`, `较上${this.granLabel}`]
    },
    /** 分类图的行；两个层级都从同一份 this.cats 折算（层级切换不查库） */
    catRows() {
      const total = this.cats.reduce((n, r) => n + r.amount, 0) || 1
      const pctOf = (v) => (v / total) * 100
      // 显式传全部展示字段：不要用「展开对象再覆盖」的写法——不同数据源的字段名并不一致
      // （例如分组对象只有 total、没有 amount），直接展开会取到 undefined
      // iconName 是图标文字回退用的名字（category-icon 取首字）：子分类视角必须是**本行自己的**
      // 名称，不能用带父前缀的 label，否则「早餐」会显示成主分类首字「餐」
      //
      // cid / includeSub 是「点这一行跳去分类明细」要带的下钻参数，两者的取值**恰好**
      // 与占比图对得上（见 cat-stats-repro 第 5 组的三条交叉断言）：
      //   cid=null → 已删除分类（孤儿行）；includeSub=true → 主分类视角 = 它自己 + 全部子分类
      // 主分类视角下 cid 可能是「父已被删、自己还在」的子分类的**父 id**（foldToTop 的组键），
      // 而 subtreeIds 会按 parent_id 反查出那个孩子，所以这种行照样点得进去。
      const row = (key, name, icon, color, amount, iconName = name, cid = null, includeSub = false) => ({
        key,
        name,
        icon,
        color,
        amount,
        iconName,
        cid,
        includeSub,
        pct: Math.round(pctOf(amount) * 100) / 100, // 条宽用精确值（两位足够）
        pctText: fmtPercent(pctOf(amount)), // 文案恒两位小数（用户裁定）
        barColor: color || 'var(--md-outline)'
      })

      if (this.level === 'top') {
        // 已删除分类画叉（与首页列表同规）：它没名没图标，退回首字会显示成「已」
        return foldToTop(this.cats).map((t) =>
          row('t' + t.id, t.name, t.id == null ? 'svg:x' : t.icon, t.color, t.amount, t.name, t.id, true)
        )
      }

      // 子分类视角：不分组、不展开——一行一个分类，标签带主分类前缀（用户裁定）
      return flatSubRows(this.cats).map((r) =>
        row(
          's' + (r.cid == null ? 'orphan' : r.cid),
          r.label,
          r.cid == null ? 'svg:x' : r.icon,
          r.color,
          r.amount,
          r.name,
          r.cid,
          false
        )
      )
    },
    /** 趋势图标题随粒度与收支变化 */
    trendTitle() {
      const unit = this.gran === 'year' ? '月' : '日'
      return `每${unit}${this.type === 2 ? '收入' : '支出'}`
    },
    /** 本期线用主色深色、上期线用淡色——同一色系深浅，一眼看出哪条是本期 */
    curColor() {
      return 'var(--md-primary-strong)'
    },
    prevColor() {
      return 'var(--md-outline-variant)'
    },
    /** 上一期的范围：月报=上月、年报=去年 */
    prevRange() {
      const { start } = this.range
      if (!start) return { start: '', end: '' }
      const s = parseDate(start)
      if (this.gran === 'month') {
        const pm = new Date(s.getFullYear(), s.getMonth() - 1, 1)
        const last = new Date(pm.getFullYear(), pm.getMonth() + 1, 0).getDate()
        return { start: fmtDate(pm), end: `${pm.getFullYear()}-${p2(pm.getMonth() + 1)}-${p2(last)}` }
      }
      const y = s.getFullYear() - 1
      return { start: `${y}-01-01`, end: `${y}-12-31` }
    },
    /** 两期共用的 X 轴长度：取较长的那一期（本月 31 天 vs 上月 30 天时，上月线自然停在 30 日） */
    bucketCount() {
      return Math.max(this.trend.length, this.prevTrend.length)
    },
    trendHasData() {
      return this.trend.some((p) => p.amount > 0) || this.prevTrend.some((p) => p.amount > 0)
    },
    /**
     * 折线的线段与数据点。CSS 自绘折线：两点之间是一根细 view，用 rotate 摆到位。
     * 必须先把绘图区量成 px——角度与长度都需要真实尺寸（百分比给不出长度）。
     */
    chart() {
      const n = this.bucketCount
      if (!this.plotW || !this.plotH || n < 2) return { segs: [], dots: [] }
      // 两期共用刻度，取全局最大值为顶——否则两条线之间不可比
      const max = this.chartMax
      const stepX = this.plotW / (n - 1)
      // 顶部留出 PLOT_PAD：最高点不贴顶（与 yTicks 的 bottom 用同一个系数）
      const yOf = (v) => this.plotH - (v / max) * this.plotH * (1 - PLOT_PAD)
      const segs = []
      const dots = []
      for (const s of [{ data: this.prevTrend, color: this.prevColor }, { data: this.trend, color: this.curColor }]) {
        let prev = null
        s.data.forEach((p, i) => {
          const x = i * stepX
          const y = yOf(p.amount)
          dots.push({ left: x + 'px', top: y + 'px', backgroundColor: s.color })
          if (prev) {
            const dx = x - prev.x
            const dy = y - prev.y
            segs.push({
              left: prev.x + 'px',
              top: prev.y + 'px',
              width: Math.sqrt(dx * dx + dy * dy) + 'px',
              backgroundColor: s.color,
              transform: `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`
            })
          }
          prev = { x, y }
        })
      }
      return { segs, dots }
    }
  },
  beforeDestroy() {
    if (this.quickTimer) clearTimeout(this.quickTimer)
  },
  mounted() {
    this.statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 0
    this.anchor = fmtDate(new Date()) // 初值今天 → 首次进入是「本期」
    this.load()
  },
  methods: {
    maskStyle,
    fmtYuan,
    setGran(g) {
      if (this.gran === g) return
      this.gran = g
      this.anchor = fmtDate(new Date()) // 切换粒度回到「当前」月/年（用户裁定）
      this.load()
    },
    /** 量某个选择器的矩形（相对视口） */
    rectOf(sel) {
      return new Promise((resolve) => {
        uni.createSelectorQuery()
          .in(this)
          .select(sel)
          .boundingClientRect((r) => resolve(r || null))
          .exec()
      })
    },
    async setType(t) {
      if (this.type === t) return
      // 支出与收入的分类条目数差很多，页面的总高会随之变化；若用户已经滚过面板顶部，
      // 页面变短会把滚动位置钳到底部——看起来就是「位置跳动」。先记下是否已滚过，
      // 数据到位后把面板顶部锚回视口顶部（只在需要时动，没滚过就不碰滚动位置）。
      const rect = await this.rectOf('#sp-top')
      const scrolledPast = !!(rect && rect.top < 0)
      this.type = t
      await this.load()
      if (scrolledPast) uni.pageScrollTo({ selector: '#sp-top', duration: 0 })
    },
    /** 层级切换只是重新折算本地数据，不查库——这就是「一条查询服务两个层级」的收益 */
    setLevel(l) {
      if (this.level === l) return
      this.level = l
    },
    /**
     * 点分类行 → 下钻到「分类明细」。
     *
     * 组件**只发事件、不认识路由**：跳去哪由宿主（「我的」页）决定。这样本面板一直是
     * 纯展示件，将来放到别处也不必改它。
     *
     * 期间与收支从**自己当前的状态**里取（range / type），而不是让页面再猜一遍 ——
     * 页面若自己从 gran+anchor 重算，就等于把这一页的口径复制了第二份，迟早走散。
     */
    pickCategory(r) {
      // 载荷刻意只给**定位与期间**这几样：分类名与期间文案都由目标页现算
      // （名字从查回来的流水里取、文案由 format.js 的 periodText 算），
      // 免得绕一圈走 URL —— uni-app 在 App 端不会解码 query 里的中文。
      this.$emit('pick', {
        cid: r.cid,
        includeSub: r.includeSub,
        type: this.type,
        gran: this.gran,
        start: this.range.start,
        end: this.range.end
      })
    },
    /** 前后翻页：锚点 ±1 个单位（月 ±1 月、年 ±1 年），Date 自动进位 */
    shift(delta) {
      if (delta > 0 && !this.canForward) return // 已是最新一期：静默返回（按钮另有置灰）
      const d = parseDate(this.anchor)
      if (this.gran === 'month') {
        this.anchor = fmtDate(new Date(d.getFullYear(), d.getMonth() + delta, 1))
      } else {
        this.anchor = fmtDate(new Date(d.getFullYear() + delta, 0, 1))
      }
      this.load()
    },
    /** 给定粒度与锚点，算期间起止（'YYYY-MM-DD'）。按任意锚点算，快速切换列表要用 */
    rangeOf(gran, anchor) {
      if (!anchor) return { start: '', end: '' }
      const d = parseDate(anchor)
      const start = periodStartOf(gran, d)
      if (gran === 'month') {
        // 月末用 new Date(y, m, 0).getDate()：闰年 2 月自动正确
        const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
        return { start, end: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(last)}` }
      }
      return { start, end: `${d.getFullYear()}-12-31` }
    },
    /** 给定粒度与锚点，算期间标签（月/年都是单值） */
    labelOf(gran, anchor) {
      const { start } = this.rangeOf(gran, anchor)
      if (!start) return ''
      return periodText(gran, start)
    },
    // ---- 快速切换期间（点击期间标签弹出滚轮）----
    /**
     * 打开滚轮：年列固定「今年 −10 ~ 今年」；月份列随年份收缩——
     * 当年只到当月，所以滚不出未来期间（与 › 按钮置灰同一条裁定）。
     */
    openQuick() {
      if (this.quickTimer) clearTimeout(this.quickTimer)
      this.quickClosing = false
      const now = new Date()
      const anchorDate = parseDate(this.anchor)
      const anchorYear = anchorDate.getFullYear()
      this.pvYears = []
      for (let y = now.getFullYear() - 10; y <= now.getFullYear(); y++) this.pvYears.push(y)
      const yi = Math.max(0, this.pvYears.indexOf(anchorYear))
      this.pvIndex = [yi, 0]
      if (this.gran !== 'year') {
        this.rebuildPvUnits()
        this.pvIndex = [yi, Math.min(this.unitIndexOf(anchorDate), this.pvUnits.length - 1)]
      }
      this.quickOpen = true
    },
    /** 当前锚点在期列里的下标（月份 − 1） */
    unitIndexOf(d) {
      return d.getMonth()
    },
    /** 期列随年份收缩：当年只到当月 */
    rebuildPvUnits() {
      const now = new Date()
      const y = this.pvYears[this.pvIndex[0]]
      this.pvUnits = []
      const maxM = y === now.getFullYear() ? now.getMonth() + 1 : 12
      for (let m = 1; m <= maxM; m++) this.pvUnits.push({ v: m, label: `${m}月` })
    },
    onPvChange(e) {
      const prevYi = this.pvIndex[0]
      this.pvIndex = e.detail.value
      if (this.gran === 'year' || this.pvIndex[0] === prevYi) return
      this.rebuildPvUnits() // 换年：期列随之收缩，越界的下标要钳回
      if (this.pvIndex[1] > this.pvUnits.length - 1) {
        this.pvIndex = [this.pvIndex[0], this.pvUnits.length - 1]
      }
    },
    /** 确定：把「年 + 月」还原成期间锚点，再重查 */
    confirmPeriod() {
      const y = this.pvYears[this.pvIndex[0]]
      if (!y) return
      if (this.gran === 'year') {
        this.anchor = `${y}-01-01`
      } else {
        const u = this.pvUnits[this.pvIndex[1]]
        if (!u) return
        this.anchor = `${y}-${p2(u.v)}-01`
      }
      if (this.anchor === this.range.start) {
        this.closeQuick() // 已经是这一期，不必重查
        return
      }
      this.closeQuick()
      this.load()
    },
    closeQuick() {
      if (!this.quickOpen || this.quickClosing) return
      this.quickClosing = true
      this.quickTimer = setTimeout(() => {
        this.quickOpen = false
        this.quickClosing = false
        this.quickTimer = null
      }, 200)
    },
    /** 刻度与数据点用同一个 x：i / (n-1)，再平移半个字宽居中 */
    tickLeft(i) {
      const n = this.bucketCount
      return n < 2 ? '0%' : (i / (n - 1)) * 100 + '%'
    },
    /** 量一次绘图区尺寸（px）。加了防抖式守卫：已经量到就不再量 */
    async measurePlot() {
      const r = await new Promise((resolve) => {
        uni.createSelectorQuery()
          .in(this)
          .select('#sp-plot')
          .boundingClientRect((rect) => resolve(rect || null))
          .exec()
      })
      if (r && r.width && r.height) {
        this.plotW = r.width
        this.plotH = r.height
      }
    },
    /**
     * 横轴刻度抽稀。逐粒度的规则：
     *   月报 —— 每 5 天一个（5/10/15/20/25），**25 号之后只留最后一天**：月末那几天
     *          与 25 号挨着排会叠字，而「当月最后一天」本身必须标出来（用户裁定）。
     *   年报 —— 12 个月的字样两两相邻会叠在一起（用户反馈 11 月与 12 月挤在一起），
     *          整段隔一个月标一次，落在**偶数月** 2/4/6/8/10/12。
     *          ★ 年报**不要**「首位必留」：那会额外多出一个 1 月，与 2 月又挨成一
     *            对 —— 只是把右端的挤字挪到左端。
     */
    showTrendLabel(i) {
      const n = this.trend.length
      if (i === n - 1) return true // 末位必留（月报 = 当月最后一天）
      if (this.gran === 'year') return i % 2 === 1 // 奇数下标 = 偶数月
      // 剩下的只有月报：首位必留（1 号），其余每 5 天一个
      if (i === 0) return true
      const day = i + 1
      return day % 5 === 0 && day <= 25
    },
    /**
     * 供宿主动作触发的一次重载（本项目里是「我的」页的 onShow 调它）。
     *
     * 为什么必须由外面来触发：tab 页是 switchTab **复用**的，组件不会重新挂载 ——
     * `mounted` 里那次 `load()` 一辈子只跑一次。记完账切回本页，图表还是旧数据，
     * 用户只能靠切换时间段逼它重查（真机反馈）。
     */
    refresh() {
      this.load()
    },
    async load() {
      const token = ++this.loadToken
      this.loading = true
      try {
        const { start, end } = this.range
        const prev = this.prevRange
        const [rows, trend, prevTrend] = await Promise.all([
          getCategoryStats({ type: this.type, start, end }),
          getTrendStats({ type: this.type, start, end, gran: this.gran }),
          getTrendStats({ type: this.type, start: prev.start, end: prev.end, gran: this.gran })
        ])
        if (token !== this.loadToken) return // 丢弃晚到响应（与首页同规）
        this.cats = rows
        this.trend = trend
        this.prevTrend = prevTrend
        // 摘要与这批数据同源算出来（用**本次**的 start/end，不是 range —— 见 data 里 sum 的注释）
        this.sum = summarizePeriod({ trend, prevTrend, start, end, today: fmtDate(new Date()) })
        this.loadError = false
        // 绘图区尺寸要在渲染之后量；量到才画得出折线
        this.$nextTick(() => this.measurePlot())
      } catch (e) {
        console.error('[stats] 统计加载失败', e)
        if (token !== this.loadToken) return
        this.loadError = true
      } finally {
        if (token === this.loadToken) this.loading = false
      }
    }
  }
}
</script>

<style lang="less">
// 竖向节奏：2026-10-03 用户反馈「元素上下距离太小，很拥挤」后重排。
// 尺子是**卡片自身的 32rpx 内边距** —— 面板就挂在 .card 里，内部分区之间若只有 8~28rpx，
// 读起来比它所在卡片的呼吸还挤，整块就发闷。现有阶梯（rpx）：
//   分区之间 42 ｜ 期间摘要条 36 ｜ 节标题→内容 28 ｜ 行与行 40（padding 20×2）｜ 面板顶 12
// 动其中任何一个数之前先对这把尺子 —— 别又滑回「比卡片还挤」。
.sp {
  padding-top: 12rpx;
}

// 抬头区粘性：面板很长时向下滚也看得见（用户裁定）。
// padding-top 由模板绑 statusBarHeight——本页是自定义导航栏，贴 top:0 会滑到状态栏底下；
// 用内边距让背景铺到 0、内容让开状态栏。左右负边距吃掉卡片内边距，滚动内容不从两侧缝隙露出。
.sp-sticky {
  position: sticky;
  top: 0;
  z-index: 5;
  margin: 0 -32rpx;
  padding-left: 32rpx;
  padding-right: 32rpx;
  // 必须不透明，且**与 .card 同一个 token**：粘性抬头滑到内容上方时要完全遮住底下那行。
  // 翻底方案下两者都是 --md-surface（白）；改 .card 时要连这里一起想。
  background: var(--md-surface);
}

.sp-head {
  display: flex;
  align-items: center;
  gap: 12rpx;

  .sp-title {
    font-size: 30rpx;
    font-weight: 600;
    color: var(--md-on-surface);
  }
}

// 粒度切换：文字 tab + 底部滑动指示条（与下面那颗胶囊分段区分开）
.sp-gran {
  position: relative;
  margin-left: auto;
  display: flex;

  .sp-gran-item {
    width: 96rpx;
    height: 56rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 25rpx;
    color: var(--md-on-surface-variant);

    &.on {
      color: var(--md-primary-strong);
      font-weight: 600;
    }
  }

  .sp-gran-bar {
    position: absolute;
    bottom: 0;
    left: 0;
    width: 96rpx;
    height: 4rpx;
    border-radius: 2rpx;
    background: var(--md-primary-strong);
    // 与胶囊同一缓动（用户裁定统一滑动动效）；它是标签下划线、不是胶囊，但属同族滑动指示条
    transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
}

.sp-ctrl {
  display: flex;
  align-items: center;
  gap: 16rpx;
  margin-top: 24rpx;
}

.seg {
  position: relative;
  display: flex;
  // 用填充底代替 1rpx 描边：真机上那条发丝线看着像脏边（用户反馈）
  background: var(--md-surface-container-high);
  border-radius: 999rpx;
  overflow: hidden;
  width: 220rpx;
  flex-shrink: 0;
  // 显式声明 content-box：滑动块用 `width: 50%`（相对**内边距盒**），按钮用 `flex: 1`（相对**内容盒**），
  // 两者只有在 padding 为 0 且盒模型可预期时才严格相等。钉死它，别依赖 uni-app 对 view 的默认值。
  box-sizing: content-box;

  .seg-thumb {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 50%;
    border-radius: 999rpx;
    // 实色主色：淡染色块（#dce8e1）与填充底（#e4eae5）几乎同色，看不出选中（用户反馈）
    background: var(--md-primary);
    transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1); // 与其余胶囊统一：y>1 有轻微过冲，「嗒」一下到位

    &.right {
      transform: translateX(100%);
    }
  }

  .seg-btn {
    position: relative;
    z-index: 1;
    flex: 1;
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

.sp-period {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;

  .sp-nav {
    width: 56rpx;
    height: 56rpx;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;

    // 已是最新一期：置灰
    &.off {
      opacity: 0.25;
    }
  }

  .sp-period-t {
    flex: 1;
    min-width: 0;
    text-align: center;
    font-size: 26rpx;
    font-weight: 500;
    color: var(--md-on-surface);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

// 加载条：始终占位，加载时可见——避免切换时布局跳动
.sp-loading {
  height: 4rpx;
  margin-top: 16rpx;
  border-radius: 2rpx;
  background: var(--md-primary-container);
  opacity: 0;
  transition: opacity 0.15s;

  &.on {
    opacity: 1;
    animation: spSweep 1s ease-in-out infinite;
  }
}

@keyframes spSweep {
  0%,
  100% {
    opacity: 0.35;
  }

  50% {
    opacity: 1;
  }
}

.sp-error {
  padding: 60rpx 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24rpx;

  .sp-error-t {
    font-size: 26rpx;
    color: var(--md-on-surface-variant);
  }

  .sp-retry {
    padding: 16rpx 64rpx;
    border-radius: 999rpx;
    background: var(--md-primary);

    text {
      font-size: 27rpx;
      font-weight: 600;
      color: #ffffff;
    }
  }
}

/* 期间摘要：一行三格。三格等宽、各自可省略 —— 金额很长时不撑破布局 */
.sp-sum {
  display: flex;
  margin-top: 36rpx;

  .sp-sum-cell {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center; // 内容居中：三格平分整行时，靠左会让右侧两格看着没占满
    text-align: center;
    gap: 10rpx;
    min-width: 0;
  }

  .sp-sum-k {
    font-size: 23rpx;
    // 行高锁死：三格的标签字数不同（较上期是 3 个字）、值的内容也不同，
    // 不锁死就各自成一个行盒，三格的基线对不齐
    line-height: 1.3;
    color: var(--md-on-surface-variant);
  }

  .sp-sum-v {
    font-size: 32rpx;
    line-height: 1.3; // 同上：锁死行高，三格才在同一水平线上
    font-weight: 600;
    color: var(--md-on-surface);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    // 好/坏用固定语义色，不随主题（App.vue 里与 --md-error / --md-income 同组）
    &.good { color: var(--md-success); }
    &.bad { color: var(--md-error); }
    // 持平不表态：退回中性色与常规字重
    &.flat {
      color: var(--md-on-surface-variant);
      font-weight: 400;
    }
  }
}

.sp-sec {
  margin-top: 42rpx;

  .sp-sec-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .sp-sec-title {
    font-size: 27rpx;
    font-weight: 600;
    color: var(--md-on-surface-variant);
  }
}

// 层级切换已改用与收支同一套胶囊（.seg），样式随之不再需要

.sp-empty {
  padding: 56rpx 0;
  text-align: center;

  .sp-empty-t {
    font-size: 25rpx;
    color: var(--md-outline);
  }
}

.sp-bars {
  margin-top: 28rpx;
}

.sp-row {
  display: flex;
  align-items: center;
  gap: 16rpx;
  padding: 20rpx 0;

  .sp-row-mid {
    flex: 1;
    min-width: 0;
  }

  .sp-row-name {
    font-size: 26rpx;
    color: var(--md-on-surface-variant);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sp-track {
    margin-top: 8rpx;
    height: 12rpx;
    border-radius: 6rpx;
    background: var(--md-surface-container-highest);
    overflow: hidden;
  }

  .sp-fill {
    height: 100%;
    border-radius: 6rpx;
    transition: width 0.25s ease-out;
  }

  .sp-row-amt {
    font-size: 26rpx;
    font-weight: 500;
    color: var(--md-on-surface);
    flex-shrink: 0;
  }

  .sp-row-pct {
    width: 72rpx;
    text-align: right;
    font-size: 23rpx;
    color: var(--md-outline);
    flex-shrink: 0;
  }
}

// 趋势：CSS 自绘双折线。绘图区定高，折线的角度与长度都按量到的 px 算
// 绘图区与横轴刻度的共同列：左边让开 Y 轴列宽（136rpx），两者因此同宽同起点
// 绘图区定高：Y 轴列必须与它同高——刻度标签的 bottom 百分比是相对**自己所在盒子**算的，
// 而 align-items: stretch 会把 Y 轴列拉到整列高（绘图区 + 下方刻度行），于是每条标签都比
// 自己的网格线低 40·(1−p)rpx。两处共用一个变量，杜绝再次写死其中一个。
@plot-h: 220rpx;

.sp-plot-col {
  flex: 1;
  min-width: 0;
}

.sp-plot {
  position: relative;
  width: 100%;
  height: @plot-h;

  // 基线：不标数值，只画 0 那一条
  .sp-baseline {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 1rpx;
    background: var(--md-outline-variant);
  }

  // 网格线：与 Y 轴刻度同高（bottom 由模板给）
  .sp-grid {
    position: absolute;
    left: 0;
    right: 0;
    height: 1rpx;
    background: var(--md-outline-variant);
    opacity: 0.6;
  }
}

// 图表整体：左列是 Y 轴标签，右侧是绘图区
.sp-chart {
  display: flex;
  align-items: stretch;
  // 左侧出血到卡片边缘、右侧保持卡片内边距：折线起点因此更靠页面左边（用户反馈太远），
  // 同时右端与其它内容对齐
  margin: 36rpx -32rpx 0;
  padding-right: 32rpx;
}

.sp-yaxis {
  position: relative;
  width: 88rpx; // 够「1250」这类 4 字标签右对齐后仍与绘图区留 10rpx
  flex-shrink: 0;
  height: @plot-h; // 与绘图区同高，刻度才与网格线共基准（见 @plot-h 处的说明）

  // 右对齐、贴住绘图区左缘（用户裁定：与页面左边留距离，但几乎挨着 y 轴）。
  // max-width + 溢出隐藏：标签过长时向左缩，而不是压到折线上
  .sp-ytick {
    position: absolute;
    right: 10rpx;
    max-width: 100%;
    overflow: hidden;
    transform: translateY(50%); // 让文字的中线对齐刻度线
    font-size: 18rpx;
    color: var(--md-outline);
    white-space: nowrap;
  }
}

// 快速切换期间的滚轮（只定高；外观在 App.vue 的 .pv-* 里统一）
.sp-pv {
  height: 400rpx;

  .sp-pv-cell {
    height: 88rpx;
    line-height: 88rpx;
    text-align: center;
    font-size: 30rpx;
    color: var(--md-on-surface);
  }
}

// 一根线段 = 一个细 view，左端对齐起点后用 transform-origin 旋转
.sp-seg {
  position: absolute;
  height: 3rpx;
  border-radius: 2rpx;
  transform-origin: 0 50%;
}

// 数据点：小圆点，用 translate 把自己居中到坐标上
.sp-dot {
  position: absolute;
  width: 8rpx;
  height: 8rpx;
  border-radius: 50%;
  transform: translate(-50%, -50%);
}

.sp-plot-empty {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  text-align: center;

  .sp-empty-t {
    font-size: 25rpx;
    color: var(--md-outline);
  }
}

// 横轴刻度：绝对定位到与数据点相同的 x，再平移半个字宽居中
.sp-ticks {
  position: relative;
  height: 32rpx;
  margin-top: 12rpx;

  .sp-tick {
    position: absolute;
    transform: translateX(-50%);
    font-size: 20rpx;
    color: var(--md-outline);
    white-space: nowrap;

    // 首尾两个刻度**不居中**：第一个被居中在 x=0 上，必然有一半露到绘图区左边之外
    // （用户反馈「起点到了画面以外」）；最后一个镜像，一半露到右边。
    // 中间的照旧居中 —— 刻度中心对齐数据点中心，只有两端让位。
    // 这不是「没数据才有」：有数据时折线抢注意力，月报那种 5 字符日期最容易看见。
    &.first {
      transform: none;
    }

    &.last {
      transform: translateX(-100%);
    }

    &.hide {
      visibility: hidden; // 占位不显示：抽稀时不影响相邻刻度的位置
    }
  }
}

// 图例：两条线靠颜色区分，没有图例读不出来
.sp-legend {
  display: flex;
  gap: 24rpx;

  .sp-lg {
    display: flex;
    align-items: center;
    gap: 8rpx;

    .sp-lg-dot {
      width: 20rpx;
      height: 6rpx;
      border-radius: 3rpx;
    }

    .sp-lg-t {
      font-size: 22rpx;
      color: var(--md-outline);
    }
  }
}
</style>
