/**
 * services/press.js —— 按下反馈（Vue mixin，零依赖）
 *
 * 为什么有它：本项目的既有约定是**不用 CSS 的 `:active`** —— 移动端 webview 对它的触发
 * 时机不稳（这条写在 app-tabbar 的注释里，是踩出来的）。于是每个可点元素都得自己写一份
 * touchstart/touchend + 一份 state。到 2026-10-03，这套已要复制到十几处（tabBar 两个 tab、
 * 记一笔的保存、各处弹层的确定/取消、数据页的三个按钮、我的页四个入口…），所以收成一份。
 *
 * 用法（三步）：
 *   import pressFx from '@/services/press.js'
 *   mixins: [pressFx]                        // ① 混入
 *   class="af-done af-press"                 // ② 挂共享样式（.af-press 定义在 App.vue）
 *   :class="{ pressing: isPressed() }"       // ③ 声明式绑状态 + 三个 touch 处理器。
 *   @touchstart="pressOn"                    //    App 端逻辑层没有 DOM，只能这样声明，
 *   @touchend="pressOff"                     //    不能去操作元素。
 *   @touchcancel="pressOff"
 *
 * 同一个组件里有**多个**可点目标时（tabBar 的两个 tab、我的页四个入口），用 key 区分：
 *   @touchstart="pressOn('index')"   :class="{ pressing: isPressed('index') }"
 * 单目标可以省略 key（内部用 ANY 占位）。
 *
 * 为什么用 touch 而不是只留一个 @click：click 在抬手时才来，那时已经不叫「按下」了 ——
 * 反馈要跟手指下去的那一瞬间。另外 touch 的 end 会在**按下时**那个元素上触发，所以手指
 * 滑出去再抬起也收得到，不会卡在按下态。
 */
const ANY = '*' // 单目标按钮的占位 key

export default {
	data() {
		return {
			pressKey: '' // 正被按住的 key（'' = 没按住）。同一时刻只可能按住一个
		}
	},
	methods: {
		pressOn(key = ANY) {
			this.pressKey = key
		},
		pressOff() {
			this.pressKey = ''
		},
		/** 模板里用：:class="{ pressing: isPressed('index') }" */
		isPressed(key = ANY) {
			return this.pressKey === key
		}
	}
}
