<template>
	<view class="page" :style="[{ paddingTop: statusBarHeight + 'px' }, themeVars]">
		<!-- 顶栏：返回 + 标题（与账户页/主题页同一套；navigationStyle: custom） -->
		<view class="top">
			<view class="icon-btn" @click="goBack">
				<view :style="maskStyle('chevL', 44, 'var(--md-on-surface)')"></view>
			</view>
			<text class="title">数据管理</text>
			<view class="icon-btn"></view>
		</view>

		<!-- 导出 -->
		<view class="card">
			<text class="sec-t">导出备份</text>
			<text class="hint">把全部账本数据复制成一段文本 —— 包括账户、分类与流水。发给微信文件传输助手、存进备忘录或邮件发给自己，将来就能在别的手机上导回来。</text>
			<view class="btn primary af-press" :class="{ pressing: isPressed('export') }" @touchstart="pressOn('export')"
				@touchend="pressOff" @touchcancel="pressOff" @click="onExport"><text>导出并复制</text></view>
		</view>

		<!-- 导入 -->
		<view class="card">
			<text class="sec-t">导入备份</text>
			<text class="hint danger">导入会清空当前的账户、分类与流水，换成备份数据。操作前会自动存一份当前数据，导错了可以撤销。</text>
			<view class="btn ghost af-press" :class="{ pressing: isPressed('import') }" @touchstart="pressOn('import')"
				@touchend="pressOff" @touchcancel="pressOff" @click="onImport"><text>从剪贴板导入</text></view>
		</view>

		<!-- 撤销：只有存在快照时才出现 -->
		<view class="card" v-if="snapshotAt">
			<text class="sec-t">撤销上次导入</text>
			<text class="hint">回到 {{ snapshotAt }} 时的数据（也就是上次导入之前）。</text>
			<view class="btn ghost af-press" :class="{ pressing: isPressed('undo') }" @touchstart="pressOn('undo')"
				@touchend="pressOff" @touchcancel="pressOff" @click="onUndo"><text>撤销上次导入</text></view>
		</view>

		<confirm-dialog ref="confirmDlg" />
	</view>
</template>

<script>
	import {
		maskStyle
	} from '@/services/icons.js'
	import {
		exportBackup,
		parseBackup,
		importBackup,
		readSnapshotInfo,
		undoLastImport
	} from '@/services/backup.js'
	import pressFx from '@/services/press.js'

	export default {
		mixins: [pressFx],
		data() {
			return {
				statusBarHeight: 0,
				snapshotAt: ''
			}
		},
		onLoad() {
			this.statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 0
		},
		async onShow() {
			// 库没就绪时 readSnapshotInfo 会抛 —— 不接住就是一条未捕获的 rejection。
			// 失败只是不显示撤销卡片，不该污染日志，更不该打断这一页。
			try {
				const info = await readSnapshotInfo()
				this.snapshotAt = info ? info.exportedAt : ''
			} catch (e) {
				this.snapshotAt = ''
			}
		},
		methods: {
			maskStyle,
			goBack() {
				uni.navigateBack()
			},
			/** 导入成功后整页重启：服务层有模块级缓存、各页有自己的 load()，靠 onShow 逐个自愈不如直接重来 */
			backToHome() {
				uni.reLaunch({
					url: '/pages/index/index'
				})
			},
			async onExport() {
				try {
					const out = await exportBackup()
					const kb = Math.round(out.text.length / 1024)
					uni.setClipboardData({
						data: out.text,
						success: () => {
							const big = kb > 300 ? '（较大，微信可能发不出去，建议存备忘录或邮件）' : ''
							uni.showToast({
								title: `已复制：${out.counts.records} 条流水，约 ${kb}KB${big}`,
								icon: 'none',
								duration: 3000
							})
						},
						fail: () => uni.showToast({
							title: '复制失败',
							icon: 'none'
						})
					})
				} catch (e) {
					uni.showToast({
						title: String((e && e.message) || '导出失败'),
						icon: 'none'
					})
				}
			},
			async onImport() {
				let text = ''
				try {
					text = await new Promise((resolve, reject) =>
						uni.getClipboardData({
							success: (r) => resolve(r.data || ''),
							fail: reject
						})
					)
				} catch (e) {
					uni.showToast({
						title: '读不到剪贴板',
						icon: 'none'
					})
					return
				}

				const parsed = parseBackup(text)
				if (!parsed.ok) {
					uni.showToast({
						title: parsed.message,
						icon: 'none',
						duration: 3000
					})
					return
				}

				const d = parsed.payload.data
				this.$refs.confirmDlg.open({
					title: '确认导入',
					message: `这份备份是 ${parsed.payload.exportedAt} 的，含 ${d.accounts.length} 个账户、${d.categories.length} 个分类、${d.records.length} 条流水。导入会清空当前全部数据。`,
					confirmText: '覆盖导入',
					danger: true,
					onConfirm: async () => {
						uni.showLoading({
							title: '导入中'
						})
						try {
							const res = await importBackup(parsed.payload)
							uni.hideLoading()
							// 快照没写成时必须如实说：这一次导错了是撤不回来的（否则卡片上的
							// 「撤销上次导入」会指向更早的状态，比没有更糟）
							uni.showToast({
								title: res.snapshotOk ? '导入完成' : '导入完成，但本次无法撤销',
								icon: res.snapshotOk ? 'success' : 'none',
								duration: res.snapshotOk ? 1500 : 3000
							})
							setTimeout(() => this.backToHome(), res.snapshotOk ? 800 : 2000)
						} catch (e) {
							uni.hideLoading()
							uni.showToast({
								title: String((e && e.message) || '导入失败'),
								icon: 'none',
								duration: 3000
							})
						}
					}
				})
			},
			onUndo() {
				this.$refs.confirmDlg.open({
					title: '撤销上次导入',
					message: `回到 ${this.snapshotAt} 时的数据？当前的改动会被替换掉。`,
					confirmText: '撤销',
					danger: true,
					onConfirm: async () => {
						uni.showLoading({
							title: '撤销中'
						})
						try {
							await undoLastImport()
							uni.hideLoading()
							uni.showToast({
								title: '已撤销',
								icon: 'success'
							})
							setTimeout(() => this.backToHome(), 800)
						} catch (e) {
							uni.hideLoading()
							uni.showToast({
								title: String((e && e.message) || '撤销失败'),
								icon: 'none',
								duration: 3000
							})
						}
					}
				})
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

	.sec-t {
		display: block;
		font-size: 27rpx;
		font-weight: 600;
		color: var(--md-on-surface);
	}

	.hint {
		display: block;
		margin-top: 14rpx;
		font-size: 23rpx;
		line-height: 1.6;
		color: var(--md-on-surface-variant);

		&.danger {
			color: var(--md-error);
		}

		.em {
			color: var(--md-on-surface);
			font-weight: 600;
		}
	}

	.btn {
		margin-top: 26rpx;
		height: 88rpx;
		border-radius: 999rpx;
		display: flex;
		align-items: center;
		justify-content: center;

		text {
			font-size: 29rpx;
			font-weight: 600;
		}

		&.primary {
			background: var(--md-primary);

			text {
				color: #ffffff;
			}
		}

		&.ghost {
			background: var(--md-surface-container-highest);

			text {
				color: var(--md-on-surface-variant);
			}
		}
	}
</style>
