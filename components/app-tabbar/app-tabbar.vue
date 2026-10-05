<template>
	<view class="tb">
		<view class="tb-item af-press" :class="{ on: current === 'index', pressing: isPressed('index') }"
			@touchstart="pressOn('index')" @touchend="pressOff" @touchcancel="pressOff"
			@click="go('/pages/index/index')">
			<view :style="icon('receipt')"></view>
			<text>明细</text>
		</view>
		<!-- 光环与爆发环：与圆钮同心同大，靠 DOM 顺序（排在圆钮之前）压在圆钮下面。
		     两者都带 pointer-events: none —— 光环会放大到 1.75 倍、盖到左右两个 tab 上，
		     不吃掉点击的话「明细 / 我的」就点不动了。 -->
		<view class="tb-halo"></view>
		<view class="tb-burst" :class="{ pressing: isPressed('center') }"></view>
		<view class="tb-center" @touchstart="pressOn('center')" @touchend="pressOff"
			@touchcancel="pressOff" @click="add">
			<!-- 按下缩放放在内层：圆钮本身被常驻呼吸占着 transform，两者要分开（.af-press 也挂在内层） -->
			<view class="tb-inner af-press" :class="{ pressing: isPressed('center') }">
				<view :style="maskStyle('pen', 66, '#ffffff')"></view>
			</view>
		</view>
		<view class="tb-item af-press" :class="{ on: current === 'mine', pressing: isPressed('mine') }"
			@touchstart="pressOn('mine')" @touchend="pressOff" @touchcancel="pressOff"
			@click="go('/pages/mine/mine')">
			<view :style="icon('user')"></view>
			<text>我的</text>
		</view>
	</view>
</template>

<script>
	import {
		maskStyle
	} from '@/services/icons.js'
	import pressFx from '@/services/press.js'

	export default {
		mixins: [pressFx],
		name: 'app-tabbar',
		props: {
			// 当前所在 tab：'index' | 'mine'
			current: {
				type: String,
				default: ''
			}
		},
		mounted() {
			this.hideNativeBar()
		},
		methods: {
			maskStyle,
			icon(key) {
				const on = (key === 'receipt' && this.current === 'index') ||
					(key === 'user' && this.current === 'mine')
				return maskStyle(key, 44, on ? 'var(--md-primary-strong)' : 'var(--md-on-surface-variant)')
			},
			go(url) {
				if (url.includes(this.current)) return // 已在本页
				uni.switchTab({
					url
				})
			},
			add() {
				uni.navigateTo({
					url: '/pages/record/edit'
				})
			},
			/**
			 * App 端自绘 tabBar：hideTabBar 后 webview 高度不会自动补回（社区已知问题）。
			 * 差值 ≥50px 说明原生栏仍占位 → 把 65px（pages.json tabBar.height）补回去；
			 * 新版运行时若已自动补高（差值趋近 0）则跳过，避免把页面加超高。
			 */
			hideNativeBar() {
				// #ifdef APP-PLUS
				uni.hideTabBar({
					animation: false
				})
				setTimeout(() => {
					const si = uni.getSystemInfoSync()
					if (si.screenHeight - si.windowHeight < 50) return
					const pages = getCurrentPages()
					const page = pages[pages.length - 1]
					const webview = page && page.$getAppWebview && page.$getAppWebview()
					if (webview) webview.setStyle({
						height: si.windowHeight + 65 + 'px'
					})
				}, 50)
				// #endif
			}
		}
	}
</script>

<style lang="less">
	.tb {
		position: fixed;
		right: 0;
		bottom: 0;
		left: 0;
		z-index: 100;
		height: 110rpx;
		padding-bottom: constant(safe-area-inset-bottom);
		padding-bottom: env(safe-area-inset-bottom);
		background: var(--md-surface);
		border-top: 1rpx solid var(--md-outline-variant);
		display: flex;
		align-items: center;
		box-sizing: content-box;

		.tb-item {
			flex: 1;
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 6rpx;
			padding-top: 12rpx;
			box-sizing: border-box; // 下面靠侧向内边距把内容往外推，需 border-box 才不吃掉等分宽度

			// 与中央凸出圆钮拉开距离（用户裁定：明细/我的离中心太近）：
			// 左项压右内边距、右项压左内边距，内容各向外移 60rpx
			&:first-child {
				padding-right: 60rpx;
			}

			&:last-child {
				padding-left: 60rpx;
			}

			text {
				font-size: 22rpx;
				color: var(--md-on-surface-variant);
			}

			&.on text {
				color: var(--md-primary-strong);
				font-weight: 600;
			}
		}

		// 光环 / 爆发环：与圆钮同心同大小，排在圆钮之前 → 画在圆钮下面
		.tb-halo,
		.tb-burst {
			position: absolute;
			left: 50%;
			bottom: calc(34rpx + constant(safe-area-inset-bottom));
			bottom: calc(34rpx + env(safe-area-inset-bottom));
			width: 120rpx;
			height: 120rpx;
			margin-left: -60rpx;
			border-radius: 50%;
			background: var(--md-primary);
			opacity: 0;
			// 关键：光环会放大到 1.75 倍盖住左右两个 tab，不吃掉点击的话它们就点不动了
			pointer-events: none;
		}

		// 常驻：进页面播 3 次就停。fill-mode 默认 none → 播完自动回到 opacity: 0 的静止态
		.tb-halo {
			animation: tbHalo 1.8s ease-out 3;
		}

		// 按下才播：class 每加上一次就重头播一遍，所以连点会连跳
		.tb-burst.pressing {
			animation: tbBurst 0.45s ease-out;
		}

		@keyframes tbHalo {
			0% {
				transform: scale(1);
				opacity: 0.55;
			}

			70%,
			100% {
				transform: scale(1.75);
				opacity: 0;
			}
		}

		@keyframes tbBurst {
			0% {
				transform: scale(1);
				opacity: 0.6;
			}

			100% {
				transform: scale(1.5);
				opacity: 0;
			}
		}

		@keyframes tbBreathe {

			0%,
			100% {
				transform: scale(1);
			}

			50% {
				transform: scale(1.07);
			}
		}

		// 凸出圆钮：bottom 计入 safe-area，保证各机型凸出量一致
		.tb-center {
			position: absolute;
			left: 50%;
			bottom: calc(34rpx + constant(safe-area-inset-bottom));
			bottom: calc(34rpx + env(safe-area-inset-bottom));
			width: 120rpx;
			height: 120rpx;
			margin-left: -60rpx;
			border-radius: 50%;
			background: var(--md-primary);
			// 常驻呼吸：与光环同拍，各 3 次后停（用户裁定「进页面播 3 次」）
			animation: tbBreathe 1.8s ease-in-out 3;
			// 投影改用中性黑：主题色一变，写死的绿阴影会在圆钮周围留一圈绿光。
			// 不做「跟着主题的彩影」—— rgba() 里塞不进 var，要拆 --md-primary-rgb 三段，不值。
			box-shadow: 0 6rpx 16rpx rgba(0, 0, 0, 0.18);

			// 按下缩放放在内层：圆钮自己的 transform 被常驻呼吸占着，两者分开才不打架。
			// 必须撑满圆钮 —— 圆钮已经不是 flex 容器了，内层不撑满的话图标会贴在圆钮顶部。
			// 缩放本身由共享件给（模板里 .tb-inner 挂了 .af-press），与其余按钮同一档。
			.tb-inner {
				width: 100%;
				height: 100%;
				display: flex;
				align-items: center;
				justify-content: center;
			}
		}
	}
</style>
