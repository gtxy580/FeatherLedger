/**
 * services/tab-swipe.js —— 「左右滑切换 tab」的公共行为（Vue mixin）
 *
 * 注意：这是个 **mixin，不是数据服务** —— 放在 services/ 只是因为项目只有
 * pages/components/services 三层，为它单开一个目录不值。
 *
 * ## 页面**任意位置**起滑都算（2026-10-03 用户裁定）
 *
 * 早先只在屏幕边缘 20px 内起滑才算 —— 那是为了不与首页的「左滑删除」抢同一个手势
 * （同一个横向拖拽，既可能删掉一行、又可能切页，用户没法预期）。本轮左滑删除已取消
 * （改成右上角角标 + 管理模式），冲突不存在了，于是放开成全页起滑。
 *
 * 唯一还要让开的是**竖向**：竖向位移更大说明用户在滚列表，横滑判定直接放过。
 * 另外只监听 start/end、**不碰 touchmove** —— 这样也不会干扰列表滚动。
 *
 * ## 用法
 *
 *   import tabSwipe from '@/services/tab-swipe.js'
 *   export default {
 *     mixins: [tabSwipe],
 *     data() { return { swipeDirs: [-1] } }, // 边界页要声明允许的方向（见 data 里的说明）
 *   }
 *
 * 页面根节点绑三个事件：`@touchstart="onSwipeStart"`、
 * `@touchend="onSwipeEnd"`、`@touchcancel="onSwipeEnd"`。
 */
const MIN_DX = 30 // 触发切换的最小横向位移（≈60rpx）
const SLIDE_MS = 180 // 转场时长，必须与 App.vue 里那两个 keyframes 的时长一致

export default {
	data() {
		return {
			swipeTracked: 0, // 1 = 这一次按压正在按「可能是横向切页」跟踪（方向在抬手时按位移符号判）
			swipeStartX: 0,
			swipeStartY: 0,
			slideClass: '', // 页面根节点的转场类，见下面 slideOut
			sliding: false, // 转场期间挡住重复触发
			// 这一页允许往哪边滑：-1 = 往左滑（去**右边**的 tab），1 = 往右滑（回左边的 tab）。
			// **处在边界的页面必须声明**（明细最左只能 -1、我的最右只能 1）：不合法的方向连
			// 「滑走」转场都不该播 —— 播了就是动一下再弹回（用户反馈）。不声明则两边都放行。
			swipeDirs: [-1, 1]
		}
	},
	methods: {
		onSwipeStart(e) {
			const t = e.touches && e.touches[0]
			if (!t) return
			// 从哪起滑都算（原先只在屏幕边缘 20px 内才算，那是为了避开列表的左滑删除 —— 已取消）
			this.swipeTracked = 1
			this.swipeStartX = t.clientX
			this.swipeStartY = t.clientY
		},
		onSwipeEnd(e) {
			if (!this.swipeTracked) return
			this.swipeTracked = 0 // 无论走哪条分支都要复位，否则一次起滑会一直有效
			const t = e.changedTouches && e.changedTouches[0]
			if (!t) return
			const dx = t.clientX - this.swipeStartX
			const dy = t.clientY - this.swipeStartY
			// 竖直位移更大 = 用户其实在滚列表，不是横滑
			if (Math.abs(dy) > Math.abs(dx)) return
			const dir = dx <= -MIN_DX ? -1 : (dx >= MIN_DX ? 1 : 0)
			if (!dir) return // 横向位移不够，不算滑动
			// 边界页在无效方向上什么也不做（见 data 里 swipeDirs 的说明）
			if (!this.swipeDirs.includes(dir)) return
			this.slideOut(dir)
		},
		/**
		 * 先播「滑走」的转场，再切页。
		 *
		 * 为什么不能直接切：手指松开到页面换掉之间没有因果，感觉像误触。让当前页朝滑走的
		 * 方向移出淡出，手势与结果就接上了。
		 *
		 * 两个要点：
		 * - 转场类必须**在切页后复位**。tab 页是 switchTab **复用**的（只是被藏起来），
		 *   不复位的话下次回到这一页会看到它歪在一边。
		 * - 类名由这里给、样式在 App.vue（全局）——两个 tab 页共用同一套，各写各的会走散。
		 */
		slideOut(dir) {
			if (this.sliding) return
			this.sliding = true
			this.slideClass = dir < 0 ? 'page-slide-left' : 'page-slide-right'
			setTimeout(() => {
				this.onTabSwipe(dir)
				this.slideClass = ''
				this.sliding = false
			}, SLIDE_MS)
		}
	}
}
