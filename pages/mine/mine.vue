<template>
  <!-- 左右滑切页：任意位置起滑都算，见 services/tab-swipe.js -->
  <view class="page" :class="slideClass" :style="[{ paddingTop: statusBarHeight + 16 + 'px' }, themeVars]"
    @touchstart="onSwipeStart" @touchend="onSwipeEnd" @touchcancel="onSwipeEnd">
    <!-- 关于：一行胶囊，放在**页面顶部**（用户裁定）。外观与主题页的「恢复默认」同一套 ——
         同属「次级动作」，用同一形状，用户不必重新学一次「这是什么、能不能点」 -->
    <view class="about-pill af-press" :class="{ pressing: isPressed('about') }" @touchstart="pressOn('about')"
      @touchend="pressOff" @touchcancel="pressOff" @click="go('/pages/about/about')">
      <text>关于本应用</text>
      <view :style="maskStyle('chevR', 30, 'var(--md-on-surface-variant)')"></view>
    </view>

    <!-- 设置入口：一排四个图标选项（用户裁定），图标在上、名称在下。
         按下反馈用 touchstart/touchend 自绘（.pressing → 缩一下），与 tabBar 圆钮同一套 ——
         CSS 的 :active 在移动端 webview 触发时机不稳，本项目一律不用 -->
    <view class="card entry-row">
      <view class="entry af-press" :class="{ pressing: isPressed('theme') }" @touchstart="pressOn('theme')"
        @touchend="pressOff" @touchcancel="pressOff" @click="go('/pages/theme/theme')">
        <view :style="maskStyle('palette', 46, 'var(--md-primary)')"></view>
        <text class="entry-t">主题管理</text>
      </view>
      <view class="entry af-press" :class="{ pressing: isPressed('category') }" @touchstart="pressOn('category')"
        @touchend="pressOff" @touchcancel="pressOff" @click="go('/pages/category/category')">
        <view :style="maskStyle('package', 46, 'var(--md-primary)')"></view>
        <text class="entry-t">分类管理</text>
      </view>
      <view class="entry af-press" :class="{ pressing: isPressed('account') }" @touchstart="pressOn('account')"
        @touchend="pressOff" @touchcancel="pressOff" @click="go('/pages/account/account')">
        <view :style="maskStyle('credit-card', 46, 'var(--md-primary)')"></view>
        <text class="entry-t">账户管理</text>
      </view>
      <view class="entry af-press" :class="{ pressing: isPressed('data') }" @touchstart="pressOn('data')"
        @touchend="pressOff" @touchcancel="pressOff" @click="go('/pages/data/data')">
        <view :style="maskStyle('database', 46, 'var(--md-primary)')"></view>
        <text class="entry-t">数据管理</text>
      </view>
    </view>

    <!-- 收支图表：直接在本页展示（用户裁定：不放入口），内容全部交给 stats-panel。
         @pick = 点分类占比里的某一行 → 下钻到该分类的明细；跳去哪由本页决定，面板不认识路由 -->
    <view class="card card-chart">
      <stats-panel ref="stats" @pick="openCategoryDetail" />
    </view>

    <!-- 自绘 tabBar（Task 4.5） -->
    <app-tabbar current="mine" />
  </view>
</template>

<script>
import { maskStyle } from '@/services/icons.js'
import tabSwipe from '@/services/tab-swipe.js'
import pressFx from '@/services/press.js'

export default {
  mixins: [tabSwipe, pressFx],
  data() {
    return {
      statusBarHeight: 0,
      // 左右滑切页：我的是最右的 tab：只能往右滑（回左边的「明细」）。
      // 反方向没有相邻 tab —— 不出手，连转场都不播（用户反馈：会「动一下」再弹回）。
      swipeDirs: [1],
    }
  },
  onLoad() {
    this.statusBarHeight = (uni.getSystemInfoSync().statusBarHeight) || 0
  },
  /**
   * 每次显示本页都让统计面板重查一次。
   *
   * 「我的」是 tab 页：switchTab **复用页面**、组件不重新挂载 —— 面板 mounted 里那次
   * load() 一辈子只跑一次。不主动刷新的话，记完账 / 删完流水切回来，看到的还是旧图，
   * 只能靠切时间段逼它重查（真机反馈）。
   *
   * 判空是必要的：首次进入时 onShow 可能早于子组件就绪，那时 $refs.stats 还没有；
   * 而首次的数据由面板自己的 mounted 负责，不会因此漏掉。
   */
  onShow() {
    const sp = this.$refs.stats
    if (sp) sp.refresh()
  },
  /** 安卓返回键：统计面板的快速切换卡片开着时，返回 = 关闭它（返回 true 消费掉事件） */
  onBackPress() {
    const sp = this.$refs.stats
    if (sp && sp.quickOpen) {
      sp.closeQuick()
      return true
    }
    return false
  },
  methods: {
    maskStyle,
    /** 左右滑：往右滑 → 切回「明细」（在 tabBar 上它就在本页左边） */
    onTabSwipe(dir) {
      if (dir === 1) uni.switchTab({ url: '/pages/index/index' })
    },
    go(url) {
      uni.navigateTo({ url })
    },
    /**
     * 分类占比的某一行 → 该分类的明细页。
     *
     * 面板只发一个结构化事件，URL 长什么样是**这一页**的事 —— 组件因此不必认识路由。
     *
     * 参数全走 query：目标页是 navigateTo 压栈进去的，被系统回收后再恢复时按参数重建即可，
     * 不需要额外的全局状态。
     *
     * ★ 参数**全是 ASCII**，分类名与期间文案都不传。上一版用 encodeURIComponent 把中文
     *   塞进 URL，而 **uni-app 在 App 端不会自动解码 query** —— 目标页页头于是显示成
     *   `%E5%B9%B4…` 一串。那两样本来就能现算：期间文案由 format.js 的 periodText 从
     *   gran/start/end 算出，分类名由目标页从查回来的流水里取 categoryName（还顺带保证
     *   名字永远与库里的当前值一致）。**不往 URL 里放中文，就不必再猜每一端解不解码。**
     */
    openCategoryDetail(e) {
      const q = [
        'cid=' + (e.cid == null ? '' : e.cid),
        'sub=' + (e.includeSub ? '1' : '0'),
        'type=' + e.type,
        'gran=' + e.gran,
        'start=' + e.start,
        'end=' + e.end
      ].join('&')
      uni.navigateTo({ url: '/pages/record/detail?' + q })
    }
  }
}
</script>

<style lang="less">
.page {
  // box-sizing 让 padding 计入 100vh：内容短时页面恰好一屏、**不出现滚动条**；
  // 底部留白在 padding 里（不是额外垫一个空 view），正好让开固定 tabBar
  min-height: 100vh;
  box-sizing: border-box;
  // 让开的不是 tabBar 本身（110rpx），而是它中央**凸出的记账圆钮**：
  // 圆钮高 120rpx、底距 34rpx，顶边在屏幕底上方 154rpx 处，比 tabBar 顶边还高 44rpx。
  // 154 是必须让开的；200 里余下的 46rpx 是呼吸空间，让内容不要贴着圆钮。
  // ⚠ 必须与 pages/index/index.vue 的 .list-foot-pad 保持一致（用户裁定两页一致）。
  //   这两个值原先各写各的（这边 170、那边 240），就是这么走散的 —— 两处都留了这句交叉引用。
  padding-bottom: calc(200rpx + env(safe-area-inset-bottom));
  background: var(--md-surface-container);
}

.card {
  margin: 28rpx 32rpx 0;
  background: var(--md-surface);
  border-radius: 32rpx;
  padding: 32rpx;
}

// 关于本应用：一行胶囊。外观照 theme.vue 的「恢复默认」——同类「次级动作」用同一套，
// 用户不必重新学一次「这是什么形状的东西、能不能点」
.about-pill {
  margin: 28rpx 32rpx 0;
  height: 88rpx;
  border-radius: 999rpx;
  background: var(--md-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;

  text {
    font-size: 28rpx;
    font-weight: 600;
    color: var(--md-on-surface-variant);
  }
}

// 图表卡裁掉溢出：stats-panel 的粘性抬头用 padding-top: statusBarHeight 把背景铺到状态栏，
// 同时用等量负 margin 抵消布局——静止时那一截背景会画到卡片上方（状态栏 ~47px 的机型上约 30px，
// 越过卡片间距、压到上一张卡上）。裁在**卡片**这一层，不能裁在面板根节点：面板根有水平出血
// （负 margin 让背景铺满卡片宽），裁在根上两侧会露出滚动内容。
// 用 overflow: clip 而不是 hidden——hidden 会让卡片成为滚动容器，position: sticky 直接失效。
// 老 WebView 不认 clip 时该声明被忽略，退化成「溢出可见」（即今天的行为），不会更糟。
.card-chart {
  overflow: clip;
}

// 一排三个图标选项：图标在上、名称在下，等宽均分
.entry-row {
  display: flex;

  .entry {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14rpx;
    padding: 8rpx 0;
  }

  .entry-t {
    font-size: 24rpx;
    color: var(--md-on-surface-variant);
  }
}
</style>
