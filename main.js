import App from './App'

// #ifndef VUE3
import Vue from 'vue'
import './uni.promisify.adaptor'
Vue.config.productionTip = false
App.mpType = 'app'
const app = new Vue({
	...App
})
app.$mount()
// #endif

// #ifdef VUE3
import {
	createSSRApp,
	reactive
} from 'vue'
import { applyTheme, mirrorVars } from '@/services/theme.js'

/**
 * 当前主题的 16 条 CSS 变量。视图层唯一的取色来源。
 *
 * 为什么要这个对象：App 端页面的 JS 跑在逻辑层，没有 document，变量写不进 DOM
 * （详见 services/theme.js 里 applyTheme 的注释）。只能反过来——让视图层自己取：
 * 各页根节点 :style="themeVars" 绑它，值一变页面自己重渲染。
 */
const themeState = reactive({ vars: {} })

export function createApp() {
	const app = createSSRApp(App)
	// 冷启动首帧：此刻数据库还没就绪（initDB 要建表/迁移/种子），但首帧已经在画了。
	// getStorageSync 是同步的，先把上次的主题摆上去，免得冷启动明显闪一段默认绿。
	// 读不到就保持空对象（首帧＝默认绿），交给下面 onShow 的异步路径。
	const fast = mirrorVars()
	if (fast) themeState.vars = fast
	// 一处覆盖所有页（含将来新增的）：App 端每页是独立 webview，变量不跨页。
	app.mixin({
		computed: {
			// 页面根节点绑这个。用 computed 而不是 data：data 会在每个组件实例里
			// 拷一份引用，themeState.vars 换成新对象时老的那份不会跟着变。
			themeVars() {
				return themeState.vars
			},
			/**
			 * 输入框「光标与键盘的距离」（px）—— 弹层卡片里的输入框绑它（`:cursor-spacing`）。
			 *
			 * 为什么需要：App 端软键盘默认是 adjustPan（官方原文：「软键盘弹出时，webview 窗体
			 * 高度不变，但窗体上推，**以保证输入框不被软键盘盖住**」）—— 它只保证**输入框本身**
			 * 露出来，输入框下面那半截卡片（图标宫格、说明、字数计数、取消/确定）就留在键盘后面，
			 * 看不见也点不到（用户反馈）。`cursor-spacing` 让平台多推一截：光标与键盘之间留出
			 * 这么多距离，整张卡片因此落在键盘上方。
			 *
			 * 取 400：比这几张卡片的高度（约 150~250px）大一截。官方语义是「取 input 距离屏幕底部
			 * 的距离与 cursor-spacing 的**较小值**」，所以实际间距会落在卡片自身的高度上 ——
			 * 卡片正好贴着键盘上沿，不会多推。
			 * **★ 嫌卡片离键盘太远/太近，只调这一个数**（5 个输入框读的都是它）。
			 */
			kbSpacing() {
				return 400
			}
		},
		onShow() {
			this.syncTheme()
		},
		methods: {
			/** 重算当前主题并上屏。onShow 走它，换肤后（theme.vue 的 pick）也走它 */
			async syncTheme() {
				themeState.vars = await applyTheme()
			}
		}
	})
	return {
		app
	}
}
// #endif
