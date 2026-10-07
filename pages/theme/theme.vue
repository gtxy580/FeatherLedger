<template>
  <view class="page" :style="[{ paddingTop: statusBarHeight + 'px' }, themeVars]">
    <!-- 顶栏：返回 + 标题（与账户页同一套；navigationStyle: custom） -->
    <view class="top">
      <view class="icon-btn" @click="goBack">
        <view :style="maskStyle('chevL', 44, 'var(--md-on-surface)')"></view>
      </view>
      <text class="title">主题色</text>
      <view class="icon-btn"></view>
    </view>

    <!-- 选色：10 格 5×2。点一下立即生效，没有「保存」按钮 -->
    <view class="card">
      <view class="sec">
        <text class="sec-t">主题色</text>
        <text class="sec-v">{{ currentName }}</text>
      </view>
      <view class="grid">
        <view
          v-for="t in themes"
          :key="t.key"
          class="chip"
          :class="{ on: t.key === current }"
          @click="pick(t.key)"
        >
          <view class="dot" :style="{ backgroundColor: dots[t.key] }">
            <view v-if="t.key === current" :style="maskStyle('check', 34, '#ffffff')"></view>
          </view>
        </view>
      </view>
    </view>

    <!-- 实时预览：全部走 var，所以它自动跟随，不需要单独维护 -->
    <view class="card">
      <text class="sec-t">预览</text>

      <!-- 色阶：主题色的关键 token，按**明度从浅到深**排成一排胶囊（这就是「色阶」的排法）。
           每一枚都读 var(...)，所以切主题时整排一起变 —— 预览区的意义就在于此 -->
      <view class="scale">
        <view v-for="c in scaleColors" :key="c.k" class="cap" :class="{ 'cap-light': c.light }">
          <view class="cap-c" :style="{ backgroundColor: 'var(' + c.k + ')' }"></view>
          <text class="cap-t">{{ c.name }}</text>
        </view>
      </view>

      <!-- 固定语义色：**故意**不跟主题，所以单独一行、胶囊也宽一档（形状差异本身在说
           「这一组不是主题色」）。下面那句提示讲的正是这件事 -->
      <view class="scale">
        <view v-for="c in fixedColors" :key="c.k" class="cap">
          <view class="cap-c" :style="{ backgroundColor: 'var(' + c.k + ')' }"></view>
          <text class="cap-t">{{ c.name }}</text>
        </view>
      </view>

      <view class="pv-hint"><text>收入色与错误色不随主题</text></view>
    </view>

    <!-- 子分类的默认颜色：只决定「新建子分类时颜色那格预填什么」，
         不碰任何已有分类 —— 所以下面那句提示必须写出来，否则设成「随机」之后
         看着现有子分类没变，会以为开关坏了 -->
    <view class="card">
      <view class="sec">
        <text class="sec-t">子分类颜色</text>
        <text class="sec-v">{{ subModeName }}</text>
      </view>
      <view
        v-for="m in subModes"
        :key="m.key"
        class="opt"
        :class="{ on: m.key === subMode, pressing: isPressed('mode:' + m.key) }"
        @touchstart="pressOn('mode:' + m.key)"
        @touchend="pressOff"
        @touchcancel="pressOff"
        @click="pickSubMode(m.key)"
      >
        <view class="opt-txt">
          <text class="opt-t">{{ m.name }}</text>
          <text class="opt-h">{{ m.hint }}</text>
        </view>
        <view v-if="m.key === subMode" :style="maskStyle('check', 32, 'var(--md-primary-strong)')"></view>
      </view>
      <view class="pv-hint"><text>只影响新建时的默认颜色，已有的不会变</text></view>
    </view>

    <view class="reset af-press" :class="{ pressing: isPressed('reset') }" @touchstart="pressOn('reset')"
      @touchend="pressOff" @touchcancel="pressOff" @click="reset"><text>恢复默认</text></view>
  </view>
</template>

<script>
import { maskStyle } from '@/services/icons.js'
import { THEMES, DEFAULT_THEME, loadAccent, setAccent } from '@/services/theme.js'
import { SUB_COLOR_MODES, getSubColorMode, setSubColorMode } from '@/services/category.js'
import pressFx from '@/services/press.js'

export default {
  mixins: [pressFx],
  data() {
    return {
      statusBarHeight: 0,
      themes: THEMES,
      current: DEFAULT_THEME.key,
      // 子分类的默认颜色策略。选项文字与 hint 都在服务层（SUB_COLOR_MODES），
      // 这一页只负责画 —— 与 themes 同一个模式
      subModes: SUB_COLOR_MODES,
      subMode: 'follow',
      // 预览用的色阶：主题色的关键 token，按**明度从浅到深**排。
      // 值一律写成 var(...)（不是 hex），所以切主题时整排自动跟随 —— 这正是预览的意义，
      // 也让 check-theme-hex 那道「主题色只能有一个来源」的门保持成立。
      scaleColors: [
        // light: true = 「与这一排自己的底（= 卡片，白）几乎同色」，只在**这两枚**上补一道极淡
        // 描边（用户裁定）。不是给全排描边 —— 那样用户看过、嫌乱；而这两枚不描就看着像空的。
        // 2026-10-04 翻底后这两格换了：卡片是纯白（与排底同色）、页面底是那层淡色。
        { k: '--md-surface', name: '卡片', light: true },
        { k: '--md-surface-container', name: '页面底', light: true },
        { k: '--md-primary-container', name: '浅主色' },
        { k: '--md-primary', name: '主色' },
        { k: '--md-outline', name: '描边' },
        { k: '--md-primary-strong', name: '深主色' },
        { k: '--md-on-surface', name: '文字' }
      ],
      // 固定语义色：**不跟主题**，所以另起一行（下面那句提示在说这件事）
      fixedColors: [
        { k: '--md-income', name: '收入' },
        { k: '--md-error', name: '错误' }
      ]
    }
  },
  computed: {
    // 每格显示的就是**色板那一格的颜色**（用户裁定「图标色板和主题色板保持一致」）——
    // 不再拿主题派生出的主色：那个只有 ~15% 饱和度，10 个格子摆一起几乎分不出哪个是哪个。
    // 于是主题选择器与分类/账户的色板成了同一排颜色、同一个顺序。
    dots() {
      const m = {}
      for (const t of THEMES) m[t.key] = t.color
      return m
    },
    currentName() {
      const t = THEMES.find((x) => x.key === this.current)
      return t ? t.name : ''
    },
    subModeName() {
      const m = SUB_COLOR_MODES.find((x) => x.key === this.subMode)
      return m ? m.name : ''
    }
  },
  onLoad() {
    this.statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 0
  },
  async onShow() {
    const t = await loadAccent()
    this.current = t.key
    // 策略每次显示都重读：它是 meta 里的一格，备份导入能改到它
    this.subMode = await getSubColorMode()
  },
  methods: {
    maskStyle,
    goBack() {
      uni.navigateBack()
    },
    /** 点一下立即生效：先上屏（不等落库），再写 meta、应用。失败则把选中环退回点击前那格 */
    async pick(key) {
      if (key === this.current) return
      const prev = this.current
      this.current = key
      try {
        await setAccent(key)
        // syncTheme 来自 main.js 的全局 mixin：它刷新响应式主题变量，页面根节点
        // 的 :style 立刻跟着变。不能直接调 applyTheme——那只算不值，不会上屏。
        await this.syncTheme()
      } catch (e) {
        // 写库或应用失败：屏幕上的颜色没变，选中环也不该停在没生效的那格。
        // 不 catch 的话这里会冒未处理的 rejection，而用户只看到「点了没反应」。
        this.current = prev
        uni.showToast({ title: '主题切换失败', icon: 'none' })
      }
    },
    /**
     * 切「子分类颜色」策略。与 pick 同一套「先上屏、失败退回」。
     *
     * 但这里**不需要** syncTheme：它不参与任何颜色变量的计算，只是一个下次打开
     * 新建卡片时才被读的值。也**不碰已有分类** —— 那是这个开关的定义。
     */
    async pickSubMode(key) {
      if (key === this.subMode) return
      const prev = this.subMode
      this.subMode = key
      try {
        await setSubColorMode(key)
      } catch (e) {
        this.subMode = prev
        uni.showToast({ title: '设置失败', icon: 'none' })
      }
    },
    reset() {
      this.pick(DEFAULT_THEME.key)
    }
  }
}
</script>

<style lang="less">
.page {
  min-height: 100vh;
  box-sizing: border-box;
  padding-bottom: calc(60rpx + env(safe-area-inset-bottom));
  background: var(--md-surface-container);
}

.card {
  margin: 20rpx 32rpx 0;
  background: var(--md-surface);
  border-radius: 32rpx;
  padding: 32rpx;
}

.sec {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.sec-t {
  font-size: 27rpx;
  font-weight: 600;
  color: var(--md-on-surface);
}

.sec-v {
  font-size: 24rpx;
  color: var(--md-on-surface-variant);
}

// 10 格 5×2：格子用 20% 宽自动折行，预设增删都不用改样式
.grid {
  display: flex;
  flex-wrap: wrap;
  margin-top: 24rpx;
}

.chip {
  width: 20%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12rpx 0;
}

.dot {
  width: 76rpx;
  height: 76rpx;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  // 取消选中时缩回原位、白边与投影一起淡出（与图标宫格、色板同一套）
  transition: transform 0.22s ease, box-shadow 0.22s ease;
}

// 选中态：与图标宫格 / 色板**完全相同**的「变大 + 呼吸 + 白边 + 投影」（selBreathe 定义
// 在 App.vue —— 它是全局样式，跨文件引 keyframes 有先例，pageSlideOut* 就是这么用的）。
// 原来是 box-shadow 描边环（内圈垫卡片底色、外圈描边）；那类「细环 + 1px 偏差就显歪」的
// 写法在三处一并退场了，换成「白边隔开投影」的浮起。白边同样用 box-shadow 扩散画
// （不用 border：那会撑大盒子、挤动布局，也不会把色圆吃掉外圈）。
// 白勾**保留**：它是这一格额外的信息（哪个是当前主题），与「选中效果」不是一回事。
.chip.on .dot {
  transform: scale(1.25);
  box-shadow: 0 0 0 4rpx #ffffff, 0 3rpx 8rpx rgba(0, 0, 0, 0.26);
  animation: selBreathe 1.8s ease-in-out infinite;
}

// 色阶：一排胶囊，每枚 = 一个 token。flex: 1 均分 —— 主题那行 7 枚、固定色那行 2 枚，
// 后者因此宽一档，「这一组不一样」由形状本身说出来。
//
// **没有托底、也不整排描边**（用户三轮定稿）：深托底嫌丑（l≈80 的灰板），整排描边嫌乱。
// 折中的结果是：只给最浅的两枚补一道 1rpx 极淡描边（.cap-light）—— 它们在浅底上
// 与卡片底几乎同色（1.07:1），不描就看着像空的；其余几枚本来就清楚，不必描。
.scale {
  display: flex;
  gap: 12rpx;
  margin-top: 24rpx;

  .cap {
    flex: 1;
    min-width: 0;

    .cap-c {
      height: 56rpx;
      border-radius: 999rpx;
    }

    // 只有「底色 / 卡片」这两枚需要一道极淡描边（它们与卡片底几乎同色，不描就像空的）。
    // 用 **inset** 的 box-shadow 而不是 border：不占布局，也不会把色块撑开。
    &.cap-light .cap-c {
      box-shadow: inset 0 0 0 1rpx var(--md-outline-variant);
    }

    .cap-t {
      display: block;
      margin-top: 8rpx;
      text-align: center;
      font-size: 20rpx;
      white-space: nowrap;
      color: var(--md-on-surface-variant);
    }
  }
}

// 子分类颜色的两格选项：整行可点，选中行尾一枚勾。
// 底色用页面底那档（在白卡片上分得出层次），选中的换成浅主色 + 一枚主色勾。
.opt {
  margin-top: 16rpx;
  padding: 22rpx 24rpx;
  border-radius: 24rpx;
  background: var(--md-surface-container);
  display: flex;
  align-items: center;
  gap: 20rpx;
  // 按下用「淡一档」而不是 .af-press 的 scale(0.9)：整行缩一圈会连文字一起缩，很怪
  transition: opacity 0.08s ease-out;

  &.pressing {
    opacity: 0.6;
  }

  &.on {
    background: var(--md-primary-container);
  }

  // 名字与说明上下两行 —— App 端 <view> 是块级，要两行必须显式 flex column
  .opt-txt {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 6rpx;
  }

  .opt-t {
    font-size: 27rpx;
    font-weight: 500;
    color: var(--md-on-surface);
  }

  .opt-h {
    font-size: 23rpx;
    color: var(--md-on-surface-variant);
  }
}

.pv-hint {
  margin-top: 18rpx;

  text {
    font-size: 23rpx;
    color: var(--md-outline);
  }
}

.reset {
  margin: 36rpx 32rpx 0;
  height: 88rpx;
  border-radius: 999rpx;
  background: var(--md-surface);
  display: flex;
  align-items: center;
  justify-content: center;

  text {
    font-size: 28rpx;
    font-weight: 600;
    color: var(--md-on-surface-variant);
  }
}
</style>
