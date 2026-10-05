<template>
	<view v-if="visible" class="dlg-scrim" :class="{ closing }" @click="cancel">
		<view class="af-blocker"></view>
		<view class="dlg-card" :class="{ closing }" @click.stop>
			<text class="dlg-title">{{ dlgTitle }}</text>
			<text class="dlg-msg">{{ dlgMessage }}</text>
			<view class="dlg-btns">
				<view v-if="!hideCancel" class="dlg-btn cancel af-press" :class="{ pressing: isPressed('cancel') }" @touchstart="pressOn('cancel')"
					@touchend="pressOff" @touchcancel="pressOff" @click="cancel">
					<text>{{ dlgCancelText }}</text>
				</view>
				<view class="dlg-btn confirm af-press" :class="{ pressing: isPressed('confirm') }" @touchstart="pressOn('confirm')"
					@touchend="pressOff" @touchcancel="pressOff" @click="confirm">
					<text :class="{ danger }">{{ dlgConfirmText }}</text>
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	import pressFx from '@/services/press.js'

	/**
	 * 自绘确认对话框。
	 *
	 * 为什么不用 uni.showModal：App 端它映射到原生对话框，**点遮罩关不掉**（用户明确要求
	 * 「点对话框外部也要能取消」），而且外观不受页面样式控制——与 M3.5 踩过的系统 <picker> 同源。
	 * 自绘才能同时管住「行为」与「样式」。
	 *
	 * 用法：
	 *   <confirm-dialog ref="confirm" />
	 *   this.$refs.confirm.open({
	 *     title, message, confirmText, cancelText, danger, hideCancel,
	 *     onConfirm, onCancel
	 *   })
	 *
	 * hideCancel：只给一个按钮的「说明型」对话框用（如账户有流水时不能删除）。
	 * 缺省 false，现有调用方行为不变；此时点遮罩/返回键仍等于取消（关掉对话框）。
	 *
	 * 安卓返回键：页面实现 onBackPress，若本组件 visible 则调 cancel() 并 return true
	 * （返回 true 表示事件已被消费，不退出页面）。
	 */
	export default {
		mixins: [pressFx],
		name: 'confirm-dialog',
		data() {
			return {
				visible: false,
				closing: false,
				dlgTitle: '',
				dlgMessage: '',
				dlgConfirmText: '确定',
				dlgCancelText: '取消',
				danger: false,
				hideCancel: false,
				onConfirm: null,
				onCancel: null,
				timer: null
			}
		},
		beforeDestroy() {
			if (this.timer) clearTimeout(this.timer)
		},
		methods: {
			open(opts = {}) {
				if (this.timer) clearTimeout(this.timer)
				this.closing = false
				this.dlgTitle = opts.title || ''
				this.dlgMessage = opts.message || ''
				this.dlgConfirmText = opts.confirmText || '确定'
				this.dlgCancelText = opts.cancelText || '取消'
				this.danger = !!opts.danger
				this.hideCancel = !!opts.hideCancel
				this.onConfirm = opts.onConfirm || null
				this.onCancel = opts.onCancel || null
				this.visible = true
			},
			/** 退场动画：visible 撑到播完再清（与各页弹层同一套机制） */
			close() {
				if (!this.visible || this.closing) return
				this.closing = true
				this.timer = setTimeout(() => {
					this.visible = false
					this.closing = false
					this.timer = null
				}, 180)
			},
			/** 取消：点「取消」、点遮罩、按返回键——都走这里 */
			cancel() {
				if (!this.visible || this.closing) return
				const fn = this.onCancel
				this.onConfirm = null
				this.onCancel = null
				this.close()
				if (fn) fn()
			},
			/** 只有点「确定」才走这里 */
			confirm() {
				if (!this.visible || this.closing) return
				const fn = this.onConfirm
				this.onConfirm = null
				this.onCancel = null
				this.close()
				if (fn) fn()
			}
		}
	}
</script>

<style lang="less">
	.dlg-scrim {
		position: fixed;
		top: 0;
		right: 0;
		bottom: 0;
		left: 0;
		z-index: 400; // 高于弹层（200/201）：对话框可以盖在底部卡片之上
		background: rgba(0, 0, 0, 0.4);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0 72rpx;
		box-sizing: border-box;
		animation: dlgFadeIn 0.18s ease-out;

		&.closing {
			animation: dlgFadeOut 0.18s ease-in forwards;
		}
	}

	.dlg-card {
		// 必须定位：兄弟节点 .af-blocker 是 position:absolute 的**定位元素**，按 CSS 绘制
		// 顺序「定位元素画在静态元素之上」，静态卡片会被挡板完全盖住 —— 挡板还带
		// touch-action:none，于是点「确定」实际点在挡板上、冒泡给 .dlg-scrim 的
		// @click="cancel"，**每次确认都变成取消**（M6 加挡板时引入，一直没被发现：
		// 其余 9 处弹层用的是 .af-card，它自己就是定位元素，只有这里踩中）。
		position: relative;
		z-index: 1;
		width: 100%;
		background: var(--md-surface);
		border-radius: 56rpx;
		padding: 40rpx 36rpx 20rpx;
		box-sizing: border-box;
		animation: dlgPopIn 0.22s cubic-bezier(0.34, 1.45, 0.5, 1);

		&.closing {
			animation: dlgPopOut 0.18s ease-in forwards;
		}
	}

	@keyframes dlgFadeIn {
		from {
			opacity: 0;
		}
	}

	@keyframes dlgFadeOut {
		to {
			opacity: 0;
		}
	}

	@keyframes dlgPopIn {
		from {
			opacity: 0;
			transform: scale(0.9);
		}
	}

	@keyframes dlgPopOut {
		to {
			opacity: 0;
			transform: scale(0.94);
		}
	}

	.dlg-title {
		display: block;
		font-size: 34rpx;
		font-weight: 600;
		color: var(--md-on-surface);
	}

	.dlg-msg {
		display: block;
		margin-top: 20rpx;
		font-size: 27rpx;
		line-height: 1.5;
		color: var(--md-on-surface-variant);
	}

	.dlg-btns {
		display: flex;
		justify-content: flex-end;
		margin-top: 32rpx;

		.dlg-btn {
			padding: 20rpx 32rpx;
			border-radius: 999rpx;

			text {
				font-size: 29rpx;
				font-weight: 600;
				color: var(--md-primary-strong);
			}

			&.cancel text {
				color: var(--md-on-surface-variant);
			}

			// 破坏性操作（删除）的确认键用错误色
			&.confirm text.danger {
				color: var(--md-error);
			}
		}
	}
</style>
