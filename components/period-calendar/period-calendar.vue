<template>
	<view class="pc">
		<!-- 标题行：箭头翻的是「正在看哪一期」，与首页期次胶囊同一套观感 -->
		<view class="pc-head">
			<view class="pc-chev" @click="shift(-1)">
				<view :style="maskStyle('chevL', 34, 'var(--md-on-surface-variant)')"></view>
			</view>
			<text class="pc-title num">{{ title }}</text>
			<view class="pc-chev" :class="{ off: !canForward }" @click="shift(1)">
				<view :style="maskStyle('chevR', 34, 'var(--md-on-surface-variant)')"></view>
			</view>
		</view>

		<!-- 星期表头：只有月态有 -->
		<view v-if="mode === 'month'" class="pc-week">
			<text v-for="w in WEEK" :key="w" class="pc-wd">{{ w }}</text>
		</view>

		<!-- 格子：月态 7 列 × 6 行，年态 3 列 × 4 行 -->
		<view class="pc-grid" :class="mode">
			<view v-for="c in cells" :key="c.key" class="pc-cell" :class="{ dim: !c.current, today: c.isToday }"
				@click="pick(c.key)">
				<text class="pc-d">{{ c.label }}</text>
				<text class="pc-a num" :class="{ inc: c.inc }">{{ c.amountText }}</text>
			</view>
		</view>
	</view>
</template>

<script>
import { monthCells, yearCells, cellAmount } from '@/services/calendar.js'
import { maskStyle } from '@/services/icons.js'

// 周一起头是中文习惯（列对齐靠 grid 的等分，不靠这七个字的宽度）
const WEEK = ['一', '二', '三', '四', '五', '六', '日']

export default {
	name: 'period-calendar',
	props: {
		mode: { type: String, default: 'month' }, // 'month' | 'year'
		year: { type: Number, required: true },
		month: { type: Number, default: 1 },
		today: { type: String, default: '' },
		values: { type: Object, default: () => ({}) }
	},
	data() {
		return {
			// 正在看哪一期。箭头翻的是它、不通知父级；点格子那一刻才 emit。
			// 组件随弹层开关创建销毁（父级用 v-if），所以从 prop 初始化一次就够
			viewYear: this.year,
			viewMonth: this.month,
			WEEK
		}
	},
	computed: {
		isYear() {
			return this.mode === 'year'
		},
		title() {
			return this.isYear ? `${this.viewYear}年` : `${this.viewYear}年${this.viewMonth}月`
		},
		// 不能翻到未来（与首页 › 置灰同一条裁定）
		canForward() {
			const d = new Date()
			if (this.isYear) return this.viewYear < d.getFullYear()
			return this.viewYear < d.getFullYear() ||
				(this.viewYear === d.getFullYear() && this.viewMonth < d.getMonth() + 1)
		},
		cells() {
			const raw = this.isYear ? yearCells(this.viewYear) : monthCells(this.viewYear, this.viewMonth)
			return raw.map((c) => {
				const v = Number(this.values[c.key]) || 0
				return {
					key: c.key,
					label: this.isYear ? `${c.month}月` : String(c.day),
					current: this.isYear ? true : c.inMonth, // 年态没有"前后月"这回事
					isToday: !!this.today && c.key === this.today,
					amountText: cellAmount(v),
					inc: v > 0
				}
			})
		}
	},
	methods: {
		maskStyle,
		shift(delta) {
			if (delta > 0 && !this.canForward) return // 不往未来翻（箭头另有置灰）
			if (this.isYear) {
				this.viewYear += delta
				return
			}
			// Date 会自动进位跨年（12 月 +1 → 次年 1 月；1 月 −1 → 上年 12 月）
			const d = new Date(this.viewYear, this.viewMonth - 1 + delta, 1)
			this.viewYear = d.getFullYear()
			this.viewMonth = d.getMonth() + 1
		},
		pick(key) {
			this.$emit('pick', key)
		}
	}
}
</script>

<style lang="less">
.pc {
	padding: 4rpx 8rpx 8rpx;
}

.pc-head {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 8rpx;
	padding: 4rpx 0 12rpx;
}

.pc-chev {
	padding: 10rpx 20rpx;

	&.off {
		opacity: 0.3;
	}
}

.pc-title {
	min-width: 240rpx;
	text-align: center;
	font-size: 30rpx;
	font-weight: 600;
	color: var(--md-on-surface);
}

.pc-week,
.pc-grid {
	display: grid;
	grid-template-columns: repeat(7, 1fr);
	gap: 6rpx;
}

.pc-grid.year {
	grid-template-columns: repeat(3, 1fr);
	gap: 14rpx;
}

.pc-wd {
	padding-bottom: 6rpx;
	text-align: center;
	font-size: 22rpx;
	color: var(--md-on-surface-variant);
}

.pc-cell {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	min-height: 88rpx;
	border-radius: 16rpx;
	background: var(--md-surface-container);

	// 前后月的格子淡下去 —— 但**仍然可点**：点它就是翻月（见父级的 pick 处理）
	&.dim {
		opacity: 0.35;
	}

	// 今天：一圈描边。不用填充色，免得跟主题色抢眼
	&.today {
		box-shadow: inset 0 0 0 2rpx var(--md-primary);
	}
}

.pc-grid.year .pc-cell {
	min-height: 120rpx;
}

.pc-d {
	font-size: 24rpx;
	line-height: 1.2;
	color: var(--md-on-surface-variant);
}

.pc-a {
	font-size: 20rpx;
	line-height: 1.2;
	color: var(--md-on-surface);

	&.inc {
		color: var(--md-income);
	}
}
</style>
