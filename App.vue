<script>
import { initDB } from '@/services/db.js'

export default {
  onLaunch() {
    // App 端 onLaunch 时 plus 环境已就绪，可直接使用 plus.sqlite
    initDB()
      .then(() => console.log('[App] 数据库就绪'))
      .catch((e) => console.error('[App] 数据库初始化失败:', e))
  }
}
</script>

<style lang="less">
/* 全局公共样式 + MD3 设计令牌
   值 = 默认档主题（松绿）的派生结果，必须与 services/palette.js 的模板一致 —— 否则不选主题
   时首帧会闪一下（这里是运行时变量就位前的兜底）。由 theme-repro 第 1 组逐 token 守着。
   ⚠ 2026-10-03 起这套值比设计稿（docs/design/2026-10-01-md3-preview.html）**更饱和**：
   用户反馈「主题色实际效果太灰」，全表 s ×2、主色 l 压到 44（见 palette.js 的说明）。
   那份设计稿是历史记录，读到时以这里为准。 */
page {
  /* 这两句必须走 var：否则页面底色与默认字色不跟主题。
     这里同时是**兜底**——主题变量还没就位时页面仍是默认淡绿（--md-surface-container 的兜底
     值），不是无色。 */
  /* ★ 2026-10-04「翻底」方案（用户从三张对比稿里选的 C）：**页底铺主题淡色、抬起来的面用纯白**。
     所以约定是 ——
       --md-surface                = 抬起来的面：卡片 / 弹层 / tabBar / 页面上那些药丸
       --md-surface-container      = 页面底色，**以及白面上的凹槽**（输入框、次级按钮、进度轨）
       --md-surface-container-high/-highest = 凹槽的更深两档，只用在白面内部
     反过来记也行：**更抬起 = 更白，凹下去 = 更淡的色**。改任一处的 background 之前先问
     「它压在什么上面」—— 压在页底（淡色）上就得用 --md-surface，压在卡片（白）上就得用
     --md-surface-container 一族，同色会糊掉（这正是这轮最容易被改错的地方）。
     ⚠ 已知局限（与翻底无关，M7 就在）：page{} 是最外层 canvas，主题变量挂在它的**子元素**上，
     所以 iOS 橡皮筋 / 安卓 overscroll 露出的那一段**永远是默认档的淡绿**。 */
  background-color: var(--md-surface-container);
  color: var(--md-on-surface);

  --md-primary: #519074;
  --md-primary-strong: #318563;
  --md-on-primary: #ffffff;
  --md-primary-container: #c1eee5;
  --md-on-primary-container: #0d4935;
  --md-secondary-container: #d6eee0;
  --md-on-secondary-container: #124230;
  --md-inverse-surface: #21372b;
  --md-inverse-on-surface: #ecf4ea;
  --md-surface: #ffffff;
  --md-surface-container: #e9f3eb;
  --md-surface-container-high: #e1ede3;
  --md-surface-container-highest: #dae8de;
  --md-on-surface: #16221c;
  --md-on-surface-variant: #3a5044;
  --md-outline: #698173;
  --md-outline-variant: #bbd1c3;
  --md-error: #ba1a1a;
  --md-income: #b4573e;
  /* 与上两个同组：固定语义色，不随主题。统计摘要把「变好」标绿时用它 ——
     不能借用 --md-primary，那是主题色，切到靛蓝主题后「变好了」会变成蓝的。 */
  --md-success: #2e7d32;
}

/* ---- 抬起来的面（白卡片 / 白药丸）底下那一道极淡投影 ----
   为什么需要：翻底方案（2026-10-04）之后，抬起来的面一律是纯白、页底是主题淡色，
   两者明度差约 7 点、彩度差 10/255 —— 看着「分离不够」（用户反馈）。加这一道把边托出来。

   ★ 判据只有一条：**压在页底（淡色）上的白面**要投影。两组 ——
       ① 大的面：卡片 / 列表行 / 汇总卡 / 展开面板
       ② 小的控件：药丸按钮、分段胶囊、下拉式胶囊、键盘键、整行的备注输入条
     反过来，**压在白面上的「凹槽」**（淡色填充）一律不投影 —— 弹层里的输入框与「取消」键、
     统计面板的期次分段与进度轨、数据页的 ghost 键、账户选择里的「全部账户」行。
     它们本来就是靠「比背后淡」被看见的，再补投影就自相矛盾了。
   ★ `.seg` 写成 `.seg-wrap .seg` 就是这个判据的落点：统计面板里也有一个同名同形的 `.seg`，
     但它压在**白卡片**上、是淡色凹槽；页面上那两个（分类页 / 记账页）都在 `.seg-wrap`
     这条「与页底同色的覆盖带」里。用这层祖先正好把两种场合分开，不必另起类名。
   ★ 值只写这一处。这些类名**跨页**（`.card` 在四个页各写了一遍局部样式、`.row` 在三个页
     各一遍），逐个改既有样式段就有 9 份副本，必然走散；写成一条跨页规则则
     **这份选择器清单本身就是「哪些面是抬起来的」的答案**，加新面时看这里。
   ★ 为什么不写成 --md-* 自定义属性：自定义属性值里的 rpx **会不会被编译器转成 rem 没验过**
     （现有产物里找不出这种写法，0 个残留 rpx 只说明框架 CSS 里没有），一旦不转就是
     `2rpx` 原样落到浏览器、整条 box-shadow 失效 —— 且**静默**。写在普通声明里没这个疑问。

   另刻意**不含**：.af-card / .dlg-card（压在遮罩上的弹层，投影没意义）、.tb（tabBar 自带
   1rpx 上边框）、stats-panel 的 .sp-sticky（它在 .card **内部**，必须与卡片同色同面）。
   要调浓淡：两个 alpha 与两个 blur 就是全部旋钮（第一层给「贴边的实感」、第二层给「软」）。 */
.card,
.row,
.total-card,
.summary,
.sub-panel,
.about-pill,
.reset,
.month-chip,
.mode-seg,
.acct-btn,
.field,
.key,
/* 加减键（2026-10-04）与数字键同一种面，投影名单里不能漏 —— 漏了就是「忘了加阴影」 */
.key-op,
.key-acct,
.seg-wrap .seg {
  // 紧的一档（2026-10-04 用户裁定「整体换紧一点」）：软层由 10rpx 收到 6rpx、偏移 3→2rpx，
  // 贴边那层 3→2rpx。软层收窄后覆盖面积小、同样的 alpha 会显得更实，所以第二层由 .06 降到 .05。
  // 收益是相邻元素之间不再糊：列表行间距 12rpx、数字键盘键间距 14rpx，原先 10rpx 的软层会互相压到。
  box-shadow: 0 1rpx 2rpx rgba(0, 0, 0, 0.06), 0 2rpx 6rpx rgba(0, 0, 0, 0.05);
}

/* 例外：两页的「新增」行也叫 .row，但它们是**虚线空位**（`background: transparent` +
   2rpx dashed），不是抬起来的面 —— 给空位画投影就成了一张浮着的虚线框。
   写在下一条而不是用 `:not()`：全仓还没用过 :not()（真机能不能用没验过），
   而 `.row.add` 的特异度天然压过 `.row`，顺序无关，顺带把例外本身摆在明面上可 grep。 */
.row.add,
.row.add-top-row {
  box-shadow: none;
}

/* 注：系统 <picker> 弹层是独立 webview，页面样式够不着（真机已验证）；
   日期选择已改 edit.vue 自绘 picker-view 底部卡片，无需此类覆盖 */

/* ---- 底部弹层公共样式：scrim + 卡片 + 图标宫格 + 色板 ----
   使用方：首页「一句话签名」、记账页（选择日期 / 新增子分类）、分类管理页（编辑分类）。
   层栈约定必须一致：页内内容 1 < 自绘 tabBar 100 < 页内飞行幻影 150 < 页面顶部功能区 180 < 弹层 200/201 < 飞进弹层的幻影 300。
   退场：节点上挂 .closing，配合各页的 xxxClosing 标志 + setTimeout 让动画播完再拆节点。 */
.af-scrim {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.35);

  &.closing {
    animation: scrimOut 0.2s ease-in forwards;
  }
}

/* 遮罩之下的一层「挡板」：吃掉落在遮罩上的触摸，弹层开着时背后的页面不跟着滚。
   必须是卡片的**兄弟**，不能把 touchmove 挂在 .af-scrim 上——挂父级会连卡片内部
   冒泡上来的 touchmove 一起吃掉，卡片里的滚轮/列表就滚不动了。
   用 CSS 的 touch-action 而不是 @touchmove.prevent：这块挡板上没有任何可滚内容。 */
.af-blocker {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  touch-action: none;
}

/* 滚轮（picker-view）的公共外观。两个坑都在 uni 的默认实现里：
   ① picker-view 自带白底与**白色渐隐遮罩**，只给根节点设透明会被内部结构盖掉
      → 后代选择器一起压平（不加 !important：那会连 indicator 的内联样式也盖掉）；
   ② 指示条是按列各画一条，两列就显示成两个断开的胶囊
      → 选中行改由 .pv-capsule 自己画：绝对定位、整行、与列数无关。 */
.pv-wrap {
  position: relative;
  margin-top: 8rpx;
}

.pv-capsule {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 88rpx;
  transform: translateY(-50%);
  border-radius: 44rpx;
  background: rgba(0, 0, 0, 0.06);
}

/* 滚轮本体抬起一层压住胶囊（文字才看得见），并与内部结构一起透明 */
.pv-wrap .pv-view {
  position: relative;
  z-index: 1;
  background: transparent;
}

.pv-wrap .pv-view * {
  background: transparent;
}

.af-card {
  position: fixed;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 201;
  background: var(--md-surface);
  border-radius: 40rpx 40rpx 0 0;
  padding: 16rpx 36rpx calc(36rpx + env(safe-area-inset-bottom));
  // 卡片自己也是个滚动容器：内容超高时能滚（此前会顶出屏幕），而且 overscroll-behavior
  // 断掉滚动链——卡片区域内任何拖动都不会带动背后的页面（没有内部滚动条的弹层靠这条）
  max-height: 86vh;
  overflow-y: auto;
  overscroll-behavior: contain;
  box-sizing: border-box;
  animation: afIn 0.28s cubic-bezier(0.32, 0.72, 0.32, 1);

  &.closing {
    animation: afOut 0.2s ease-in forwards;
  }
}

@keyframes afIn {
  from {
    transform: translateY(100%);
  }
}

@keyframes afOut {
  to {
    transform: translateY(100%);
  }
}

@keyframes scrimOut {
  to {
    opacity: 0;
  }
}

/* ---- 边缘滑切页的转场 ----
   页面整体朝滑走的方向移出并淡出（时长与 services/edge-swipe.js 的 SLIDE_MS 一致）。
   写在全局而不是各页：两个 tab 页共用同一套，各写各的会走散。
   transform 会让页面成为 fixed 定位的包含块 —— 这里正合意：自绘 tabBar 与弹层
   都跟着页面一起滑走，而不是钉在原地。 */
@keyframes pageSlideOutLeft {
  to {
    transform: translateX(-22%);
    opacity: 0;
  }
}

@keyframes pageSlideOutRight {
  to {
    transform: translateX(22%);
    opacity: 0;
  }
}

.page-slide-left {
  animation: pageSlideOutLeft 0.18s ease-in forwards;
}

.page-slide-right {
  animation: pageSlideOutRight 0.18s ease-in forwards;
}

.af-grab {
  width: 72rpx;
  height: 8rpx;
  border-radius: 4rpx;
  background: var(--md-outline-variant);
  margin: 0 auto 20rpx;
}

.af-title {
  display: block;
  text-align: center;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--md-on-surface);
  margin-bottom: 24rpx;
}

/* 24 个内置分类图标：恰好 3 行 × 8 列，不滚动；选中态是**深色圆底**（见下） */
.af-icons {
  display: flex;
  flex-wrap: wrap;
  gap: 8rpx;

  .af-ic {
    width: calc((100% - 56rpx) / 8);
    height: 76rpx;
    display: flex;
    align-items: center;
    justify-content: center;

    // 环 = 图标外面那层盒子。**与图标同尺寸**（都是 56rpx）：选中态的阴影画在它身上，
    // 同尺寸才贴着图标（阴影是「环盒」的投影，盒子比图标大的话，会变成一圈浮在图标外面的
    // 暗影）。图标靠 flex 居中在环里 —— 居中本身也是必须的：早先没居中，图标比环盒小时
    // 会贴左上角，整圈看着就「歪」。
    //
    // 选中态 = **变大 + 呼吸 + 投影**（用户裁定，与色板、主题色**共用**同一套 selBreathe）。
    // 不画任何底色/光效（三轮定稿的终点），于是「白缝」连存在的余地都没有：图标是
    // category-icon 用 `uni.upx2px()` 算的 px、环盒是 rpx→rem 换算的，项目里 rpx 有**两条
    // 换算路径**、可能差一丁点 —— 但阴影是模糊的、没有硬边，差多少都看不出来。
    .af-ring {
      width: 56rpx;
      height: 56rpx;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      // 白边与投影都走 box-shadow 的**扩散**（0 模糊、只扩 4rpx 的那一层就是白边）。
      // 不用 border 画白边：边框会**撑大盒子**、把布局挤动（子分类宫格里会让旁边的「+」
      // 与文字错开 8rpx）；box-shadow 不占布局，且「随 border-radius 走、天然同心」这条
      // 本项目在真机上验过。
      // 平时不画（见下），选中时两层一起淡入。
      transition: transform 0.22s ease, box-shadow 0.22s ease;

      &.on {
        // 与 selBreathe 的关键帧同值。写这一句是为了「动画没跑起来时它也仍然是大号的」——
        // 选中态不能只靠动画表达。
        transform: scale(1.25);
        // 两层：① 4rpx 白边（用户裁定）—— 它是**阴影的解药**，把投影与图标隔开，投影就
        // 不再糊在图标边上（上一版 16rpx 的模糊直接贴着图标，用户嫌范围大、脏）；
        // ② 收紧的投影（6/16/0.24 → 3/8/0.26：更小更紧，靠提高浓度保住可见度）。
        // 中性黑、不用主题色 —— 与「记一笔」圆钮同一条理由：主题色一变，写死的彩影会在
        // 周围留一圈同色光晕；而 rgba() 里塞不进 var。
        box-shadow: 0 0 0 4rpx #ffffff, 0 3rpx 8rpx rgba(0, 0, 0, 0.26);
        animation: selBreathe 1.8s ease-in-out infinite;
      }
    }
  }
}

/* 选中态的「变大 + 呼吸」—— **图标宫格 / 色板 / 主题色三处共用**。
   theme.vue 也引这一个：App.vue 的样式是全局的，跨文件用 keyframes 有先例（pageSlideOut*）。
   - 「呼吸」这一段整段照「记一笔」圆钮的 tbBreathe：0/100% 与 50% 缩放差 7%（1 ↔ 1.07），
     `1.8s ease-in-out`。区别只在它**无限循环**（圆钮是进页面播 3 次）。
   - 平坦版（纯缩放、不平移不旋转）是刻意的：三处的选中物都是圆，缩放对三者都成立；
     **上一版「抖动」（平移 + 缩放）用户嫌不好看** —— 别再加平移/旋转。
   - 「大」由关键帧自己保证（恒 ≥ 1.25），所以选中是「直接变大 + 开始呼吸」；取消选中时动画
     被摘掉，靠各宿主自己的 `transition: transform` 缩回。
   - 尺寸上限：图标宫格那处的环是 56rpx，1.34 倍才 75rpx，仍在 76rpx 的格子里 —— 也就是说
     这里还有余量；真要继续放大，先看 .af-ic 的高度与 .af-icons 的 gap 够不够。 */
@keyframes selBreathe {
  0%,
  100% {
    transform: scale(1.25);
  }

  50% {
    transform: scale(1.34);
  }
}

.af-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-top: 24rpx;

  .af-preview {
    flex-shrink: 0;
  }

  .af-name {
    flex: 1;
    height: 80rpx;
    background: var(--md-surface-container);
    border-radius: 20rpx;
    // 右侧多留出的 44rpx 是给「清空 ×」让位（.clr-btn 贴右边 10rpx、命中区 44rpx），
    // 不留的话文字会钻到 × 底下。改这个值要连 .clr-btn 的 right / 宽度一起想。
    padding: 0 68rpx 0 24rpx;
    font-size: 28rpx;
    color: var(--md-on-surface);
  }
}

.af-ph {
  color: var(--md-outline);
}

.af-colors {
  display: flex;
  // 18rpx 是 9 个色板时的余量。色板收到 10 个之后，10×52+9×18 = 682rpx 会超出行宽
  // （卡片内容 678rpx）→ 第 10 枚被挤到第二行独自一格。16rpx 刚好排成一行。
  gap: 16rpx;
  margin-top: 24rpx;
  flex-wrap: wrap;
  // 10 枚刚好一行（见上面的余量说明），所以用 space-between 把首尾顶到两端 ——
  // 原来靠左排，右边空出一大块，左右不对称（用户反馈）。
  // 注意：这条依赖「一行放得下」，将来色板再增加、换成两行时，第二行会被摊到两端，
  // 那时要改成给 .af-colors 定宽或用 padding 均分。
  justify-content: space-between;

  .af-color {
    width: 52rpx;
    height: 52rpx;
    border-radius: 50%;
    // 取消选中时缩回原位、白边与投影一起淡出
    transition: transform 0.22s ease, box-shadow 0.22s ease;

    // 选中态与图标宫格**完全相同**（用户裁定「连同色板选择一并做成相同效果」）：
    // 变大 + 呼吸 + 白边 + 投影，不画圆底、不画描边环。
    // 取舍说明：色板自己就是那个彩色圆，加任何底色都会被它盖住；而它的**描边环**
    // （原来是 -8rpx 的伪元素描边，正是「负偏移伪元素真机有偏差」那条写法）在这个语言里
    // 也一并不要了 —— 选中靠「大了 25% + 在呼吸 + 白边隔开投影」更清楚。
    // 白边与投影的数值都与图标宫格一致。白边用 box-shadow 扩散画的好处在这里最明显：
    // 色圆仍是 52rpx、**不会被白边吃掉外圈**（border 会），所以未选中的观感与改动前一致。
    &.on {
      transform: scale(1.25);
      box-shadow: 0 0 0 4rpx #ffffff, 0 3rpx 8rpx rgba(0, 0, 0, 0.26);
      animation: selBreathe 1.8s ease-in-out infinite;
    }
  }
}

.af-hint {
  display: block;
  font-size: 23rpx;
  color: var(--md-outline);
  margin-top: 16rpx;
}

/* 说明文字 + 字数计数。计数**定位**在说明最后一行的右端（用户裁定），不占文档流 ——
   这个位置是三次试出来的：① 与说明并排（flex）会挤掉它一截宽度、多折一行；
   ② 自己独占一行则白多一行高度。定位既不挤也不占。
   结构性前提：说明的每一句都很长（2~3 行），**最后一行总是短的**，所以右端不会与文字撞上。
   计数出现的前提是「这个地方的上限是隐性的」—— 输入框打满之后字符不再进来，
   不说一声用户只会以为键盘坏了。上限值一律来自 services 导出的常量（见 ACCOUNT_NAME_MAX） */
.af-hint-wrap {
  position: relative;
  margin-top: 16rpx;
}

.af-hint-wrap .af-hint {
  display: block;
  margin-top: 0;
}

.af-count {
  position: absolute;
  right: 0;
  bottom: 0;
  font-size: 23rpx;
  color: var(--md-outline);
  font-variant-numeric: tabular-nums; /* 数字等宽：计数不左右抖 */

  /* 打满时变语义红。它不是错误（输入框本来就该在这个数停住），只是「到顶了」，
     所以平时与提示文字同色，只在满时上色 */
  &.full {
    color: var(--md-error);
    font-weight: 600;
  }
}

.af-btns {
  display: flex;
  gap: 20rpx;
  margin-top: 28rpx;

  .af-cancel {
    flex: 1;
    height: 88rpx;
    border-radius: 999rpx;
    background: var(--md-surface-container-highest);
    display: flex;
    align-items: center;
    justify-content: center;

    text {
      font-size: 29rpx;
      font-weight: 600;
      color: var(--md-on-surface-variant);
    }
  }

  .af-done {
    flex: 2;
    height: 88rpx;
    border-radius: 999rpx;
    background: var(--md-primary);
    display: flex;
    align-items: center;
    justify-content: center;

    text {
      font-size: 29rpx;
      font-weight: 600;
      color: #ffffff;
    }
  }
}

/* ---- 按下反馈（所有按钮类共用）----
   约定：不用 CSS 的 :active（移动端 webview 触发时机不稳，见 app-tabbar 里的注释），
   一律 touchstart/touchend 自绘。状态与三个处理器由 services/press.js 这个 mixin 提供，
   样式只有这里一份 —— 按钮加上 .af-press 就有了。
   0.08s / scale 0.9 与 tabBar 圆钮同档：再慢就从「手感」变成「动画」了。 */
.af-press {
  transition: transform 0.08s ease-out;

  &.pressing {
    transform: scale(0.9);
  }
}

/* ---- 管理模式（长按进入）的公共件 ----
   两件都留在 App.vue 当唯一来源，但**目前只有分类管理页在用**（首页流水两样都撤了，
   2026-10-03 用户裁定）：jiggle 那边靠长按拖动排序，抖是必要的暗示；首页只是在编辑几笔，
   抖起来是噪音。哪天首页要回来，直接挂 class 即可，别在两处各抄一份。 */
@keyframes jiggle {
  0% {
    transform: rotate(-2deg);
  }

  100% {
    transform: rotate(2deg);
  }
}

.hint-bar {
  margin: 0 24rpx 16rpx;
  padding: 14rpx 24rpx;
  border-radius: 20rpx;
  background: var(--md-primary-container);

  .hint-text {
    font-size: 23rpx;
    color: var(--md-on-primary-container);
  }
}

/* ---- 管理页头部（账户 / 主题 / 数据 / 分类 四个页面共用）----
   原来这套在三个页面里各写一份（取值逐字节相同）—— 分类页没有自绘头部，用的是系统导航栏，
   于是它和另外三页看着不一样（用户反馈）。收到这里一份，「新增第 N 个管理页」直接照抄结构，
   样式不必重抄。 */
.top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12rpx 24rpx;

  .icon-btn {
    width: 84rpx;
    height: 84rpx;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .title {
    font-size: 32rpx;
    font-weight: 600;
    color: var(--md-on-surface);
  }
}

/* ---- 输入框右侧的「清空 ×」 ----
   用法：把 <input> 包进 .clr-wrap，再在它里面放一个 .clr-btn（**有值才渲染** ——
   判断条件写在各页模板里，因为「有值」各页不同：金额是 !== '0'，其余是非空串）。

   为什么要多包 .clr-wrap 这一层：
   ① 它是 × 的**定位包含块** —— × 的位置只由这一层的盒子决定，与输入框自己的
      padding / 宽度无关（别把 × 挂在输入框的爷爷节点上：那就要拿「爷爷的 padding 加
      输入框的 padding」两个变量去算位置，本项目为这种事返过工，见首页分隔线那条教训）；
   ② 在 .af-row 这类 flex 行里，它**接管**原来 <input> 的 flex: 1 —— <input> 在块容器里
      是 display: block、宽度自动撑满，所以包一层之后输入框的宽度一点没变。
   flex: 1 在非 flex 上下文里是空转的，所以两种场景共用同一条规则。 */
.clr-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
}

.clr-btn {
  position: absolute;
  // 压住输入框：定位元素本来就画在静态元素之上，这里是双保险（万一某页把输入框改成 relative）
  z-index: 1;
  right: 10rpx;
  top: 50%;
  transform: translateY(-50%);
  // 命中区 44rpx、图标 26rpx：图标小、可点的地方不小
  width: 44rpx;
  height: 44rpx;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
