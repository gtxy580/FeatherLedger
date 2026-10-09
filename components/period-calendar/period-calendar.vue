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

		<!-- 格子：月态 7 列（4~6 行，够用就少一行）、年态 3 列 × 4 行。
		     每格里：日期自己占一个块，收/支两行挂在块下面（见 .pc-box 那段注释） -->
		<view class="pc-grid" :class="mode" :style="gridStyle">
			<view v-for="c in cells" :key="c.key" class="pc-cell"
				:class="{ dim: !c.current, today: c.isToday, future: c.future, pressing: isPressed(c.key) }"
				@touchstart="onCellDown(c)" @touchend="pressOff" @touchcancel="pressOff" @click="pick(c)">
				<view class="pc-box">
					<text class="pc-d">{{ c.label }}</text>
				</view>
				<text class="pc-e num">{{ c.expenseText }}</text>
				<text class="pc-i num">{{ c.incomeText }}</text>
			</view>
		</view>
	</view>
</template>

<script>
import {
	monthCells, yearCells, cellLine, rowGap, isFuture, currentPeriod, todayKey,
	canGoForward, canPickCell
} from '@/services/calendar.js'
import { maskStyle } from '@/services/icons.js'
import pressFx from '@/services/press.js'

// 周一起头是中文习惯（列对齐靠 grid 的等分，不靠这七个字的宽度）
const WEEK = ['一', '二', '三', '四', '五', '六', '日']

export default {
	name: 'period-calendar',
	mixins: [pressFx], // 按下反馈（项目不用 :active，webview 对它的触发时机不稳）
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
		/**
		 * 月态的**行距**（不是格子高度）。★ 行数少了，多出来的空间给行距、不给格子 ——
		 * 格子因此始终近正方（比例保持不变），只是行与行松一些；整块高度恒定，翻月时不跳。
		 * 年态恒 4 行，间距写在样式里，不用这个。
		 */
		gridStyle() {
			if (this.isYear) return {}
			return { rowGap: `${rowGap(this.cells.length / 7)}rpx` }
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
		/** 手指按下：**只给会跳的格子**深色反馈（用户裁定："不跳转就不要"） */
		onCellDown(c) {
			if (canPickCell(c, this.isYear)) this.pressOn(c.key)
		},
		/** 手指抬起（或划走）：真的跳。能不能跳见 canPickCell —— 与按下反馈同一把尺子 */
		pick(c) {
			if (!canPickCell(c, this.isYear)) return
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
	// ⚠ 这个 6rpx 与 services/calendar.js 里的 CELL_GAP 是**同一个数**，改一个就要改另一个
	column-gap: 6rpx;
}

// 月态的行距由内联样式给（按行数算，见 gridStyle）：行数少了就松一些，
// 让出来的空间不进格子 —— 格子因此始终近正方
.pc-grid {
	row-gap: 6rpx;
}

.pc-grid.year {
	grid-template-columns: repeat(3, 1fr);
	gap: 14rpx; // 年态恒 4 行，横竖都写死（不走 rowGap）
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
	// ★ **不居中**：日期块永远贴在本格**顶部**，金额挂在它下面。
	//   居中会让"只有支出"（2 行）和"收支都有"（3 行）的日子把日期挤到不同高度 ——
	//   真机上看着每个日期都在飘（用户反馈：很不和谐）
	justify-content: flex-start;
	// ⚠ 104rpx 与 services/calendar.js 里的 CELL_H 是**同一个数**，改一个就要改另一个。
	// 行数少了**不**长高：多出来的空间给行距（见 gridStyle），格子比例因此保持不变。
	// 里面装的是「日期块 52 + 两行金额 48」
	min-height: 104rpx;

	// 前后月的格子淡下去 —— 但**仍然可点**：点它就是翻月（见父级的 pick 处理）
	&.dim {
		opacity: 0.35;
	}

	// 今天：一圈描边（画在日期块上，不是整格）
	&.today .pc-box {
		box-shadow: inset 0 0 0 2rpx var(--md-primary);
	}

	// 还没到的格子：**连淡底都不给** —— 跟"前后月"那种"淡然而能点"区分开。
	// 它们点下去什么都不会发生（见 pick），所以不能长得像能点的东西。
	// 整块底一撤，这一期就"在这里结束"，一眼看得出今天是哪一天收的尾。
	// 要写在 .dim 之后：两个类同时挂着时（本月末尾那几格既属"下月"又没到），
	// 同权重下后一条说了算
	&.future {
		opacity: 0.3;

		.pc-box {
			background: transparent;
		}
	}

	// 按住：日期块的底深一档（用主题里现成的那两档，不新造颜色）。
	// ★ 只有**会跳**的格子会进这个态（见 onCellDown）—— 按下去变深、松手却什么都不发生，
	//   比全程没反馈更糟
	&.pressing .pc-box {
		background: var(--md-surface-container-highest);
	}
}

/* 日期（月态）/ 月份（年态）**自己占一个格子**，边上是空白的金额行（用户裁定）——
   于是不管那天有没有账、有几种账，日期都在同一个高度上。
   只装一个日期，所以能比原来那一整格矮不少 */
.pc-box {
	width: 100%;
	height: 52rpx;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 14rpx;
	// 52（日期块）+ 4（这道缝）+ 48（两行金额）= 104，正好是 .pc-cell 的 min-height
	margin-bottom: 4rpx;
	background: var(--md-surface-container);
	// 按下反馈走的是换底（不是 .af-press 的缩放）——所以 transition 也得写在这儿，
	// 不靠 App.vue 那份 .af-press：它只管 transform，挂上反而会被页面样式整条盖掉。
	// 0.08s 与 .af-press 同档：再慢就从"手感"变成"动画"了
	transition: background-color 0.08s ease-out;
}

.pc-grid.year .pc-cell {
	min-height: 132rpx;

	// 年态的格子宽（3 列），日期块也高一点才不像条细缝
	.pc-box {
		height: 80rpx;
	}
}

.pc-d {
	font-size: 24rpx;
	line-height: 1.2;
	color: var(--md-on-surface-variant);
}

// 收、支各一行（上支下收，与列表里「支 X 收 Y」同一个顺序）。
// ★ **左对齐**，不跟格子中线对齐（用户裁定）：两行各自居中时，「支」「收」两个字会被
//   各自的宽度推进推出（`支 128` 比 `收 80` 宽），上下看着像锯齿。左对齐之后
//   「支 / 收」和后面的数字各成一列，一眼扫得下来。
//   `align-self: stretch` 让这两行占满格宽（不是缩成内容宽），`text-align` 才有的可对
.pc-e,
.pc-i {
	align-self: stretch;
	padding-left: 8rpx;
	text-align: left;
	font-size: 20rpx;
	line-height: 1.2;
	color: var(--md-on-surface);
}

// 收带主题色 —— 与列表里「收」那截同一个规矩（支出留默认色）
.pc-i {
	color: var(--md-income);
}
</style>
