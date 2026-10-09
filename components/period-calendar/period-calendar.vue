<template>
	<view class="pc">
		<!-- 标题行：箭头翻的就是页面这一期（弹层的 › 与页面的 › 是同一件事） -->
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
			<view v-for="c in cells" :key="c.key" class="pc-cell" :class="{ dim: !c.current, today: c.isToday, future: c.future }"
				@click="pick(c)">
				<text class="pc-d">{{ c.label }}</text>
				<text class="pc-e num">{{ c.expenseText }}</text>
				<text class="pc-i num">{{ c.incomeText }}</text>
			</view>
		</view>
	</view>
</template>

<script>
import {
	monthCells, yearCells, cellLine, isFuture, currentPeriod, todayKey, canGoForward
} from '@/services/calendar.js'
import { maskStyle } from '@/services/icons.js'

// 周一起头是中文习惯（列对齐靠 grid 的等分，不靠这七个字的宽度）
const WEEK = ['一', '二', '三', '四', '五', '六', '日']

export default {
	name: 'period-calendar',
	props: {
		mode: { type: String, default: 'month' }, // 'month' | 'year'
		// ★ 组件**不自持期间**：它画的永远是「页面当前那一期」。
		//   箭头翻了页就把 delta 交给父级，父级换期、重查，再把新的 props 送回来 ——
		//   于是格子和列表说的是同一期。（曾经把"正在看哪一期"存在组件自己身上，
		//   结果是翻走之后 values 还是旧期间的键，整月空白。）
		year: { type: Number, required: true },
		month: { type: Number, default: 1 },
		today: { type: String, default: '' },
		// 每格的数字：{ '2026-10-15': { income: 8000, expense: 12800 } }（分，两个都是正数）。
		// ★ 键必须与格子的 key 同形（月态按天、年态按月），且**有键 = 那格点得动** ——
		//   所以收支相抵（差额 0）的那天也要落一个键
		values: { type: Object, default: () => ({}) }
	},
	data() {
		return { WEEK }
	},
	computed: {
		isYear() {
			return this.mode === 'year'
		},
		title() {
			return this.isYear ? `${this.year}年` : `${this.year}年${this.month}月`
		},
		// 不能翻到未来（与两个页面的 › 置灰同一条裁定、同一个实现）
		canForward() {
			return canGoForward({ year: this.year, month: this.month }, this.isYear)
		},
		/**
		 * 判「这一格还没到」用的那个"现在" —— 与格子 key 同形：
		 * 月态是今天（'YYYY-MM-DD'）、年态是本月（'YYYY-MM'）。
		 * ★ 父级不传 today 时自己取（月态必须有个今天，否则会把整月都判成"还没到"）
		 */
		nowKey() {
			return this.isYear ? currentPeriod() : (this.today || todayKey())
		},
		cells() {
			const raw = this.isYear ? yearCells(this.year) : monthCells(this.year, this.month)
			return raw.map((c) => {
				const cell = this.values[c.key] || {}
				return {
					key: c.key,
					label: this.isYear ? `${c.month}月` : String(c.day),
					current: this.isYear ? true : c.inMonth, // 年态没有"前后月"这回事
					isToday: !!this.today && c.key === this.today,
					future: isFuture(c.key, this.nowKey), // 还没到：画得淡、且点不动
					// 「背后有没有东西可看」——就是 values 里有没有这一格。
					// ★ 收支相抵的那天（收付一样多、差额 0）也照样落一个键，所以照样点得动；
					//   没流水的那天压根不会有键
					hasData: Object.prototype.hasOwnProperty.call(this.values, c.key),
					// 收、支分两行（用户裁定）。没数的那行是空串 —— 标签由 cellLine 说了算，
					// 不足半元时连标签一起省掉，不留半截子「支 」
					expenseText: cellLine('支', cell.expense),
					incomeText: cellLine('收', cell.income)
				}
			})
		}
	},
	methods: {
		maskStyle,
		shift(delta) {
			if (delta > 0 && !this.canForward) return // 不往未来翻（箭头另有置灰）
			// 交给父级去换期 —— 弹层里的箭头与页面上的 › 是**同一件事**，
			// 走同一个 shiftPeriod（换期 + 重查）。所以翻到哪期，格子里的数就是哪期的
			this.$emit('shift', delta)
		},
		/**
		 * 点了某一格。有两类格子点不动（都拦在这里，两个页面就不用各写一遍）：
		 *
		 * ① **还没到的**（与 › 置灰同一条裁定）：月历**永远**带着下个月那几格
		 *    （42 − 本月天数 − 前面垫的 ≥ 5），年历在当前年份里 12 个月都在；还有本月内
		 *    今天之后的那几天 —— 不拦就一步跳进还没到的空期间。
		 * ② **当期里没有流水的那些天**（用户裁定：点了不跳转）—— 那天没账可看，跳过去
		 *    也是空的，白把弹层关了。
		 *    ★ 只拦**当期**的格子：前后月那几格的流水不在 values 里（那是别的期间的数据），
		 *      而点它们本来就是"翻到那个月"的指令，不是"看那一天"，照旧放行。
		 */
		pick(c) {
			if (c.future) return
			if (!this.isYear && c.current && !c.hasData) return
			this.$emit('pick', c.key)
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
	min-height: 104rpx;
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

	// 还没到的格子：**连淡底都不给** —— 跟"前后月"那种"淡然而能点"区分开。
	// 它们点下去什么都不会发生（见 pick），所以不能长得像能点的东西。
	// 整块底一撤，这一期就"在这里结束"，一眼看得出今天是哪一天收的尾。
	// 要写在 .dim 之后：两个类同时挂着时（本月末尾那几格既属"下月"又没到），
	// 同权重下后一条说了算
	&.future {
		opacity: 0.3;
		background: transparent;
	}
}

.pc-grid.year .pc-cell {
	min-height: 132rpx;
}

.pc-d {
	font-size: 24rpx;
	line-height: 1.2;
	color: var(--md-on-surface-variant);
}

// 收、支各一行（上支下收，与列表里「支 X 收 Y」同一个顺序）。
// 没数的那行是空串，所以每格一样高、行也齐。
.pc-e,
.pc-i {
	font-size: 20rpx;
	line-height: 1.2;
	color: var(--md-on-surface);
}

// 收带主题色 —— 与列表里「收」那截同一个规矩（支出留默认色）
.pc-i {
	color: var(--md-income);
}
</style>
