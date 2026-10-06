<template>
	<!-- 分类明细：从「我的」页的分类占比点进来，看**这一个分类**在这一期里的流水。
	     它是只读视图 + 可编辑：结构与首页的按天分组列表同构，样式直接复用首页那套全局类名
	     （.group / .row / .amt 等），所以这里不再抄一遍样式。
	     刻意**没有**的东西（用户裁定）：大标题与签名、期次/年月切换、支出收入结余储蓄率四张卡、tabBar。
	     期间与分类由来源页带来，本页不提供任何切期入口 —— 想知道别的期，回上一页切。 -->
	<view class="page" :style="[{ paddingTop: statusBarHeight + 'px' }, themeVars]" @click="onPageClick">
		<!-- 顶栏：返回 + 标题（与账户/主题/数据页同一套；navigationStyle: custom） -->
		<view class="top">
			<view class="icon-btn" @click="goBack">
				<view :style="maskStyle('chevL', 44, 'var(--md-on-surface)')"></view>
			</view>
			<text class="title">分类明细</text>
			<view class="icon-btn"></view>
		</view>

		<!-- 页头：分类名 · 期间 · 合计。三者缺一，用户点进来就不知道自己在看什么、
		     也没法把它跟刚才点的那根条对上（用户裁定）。 -->
		<view class="hd">
			<view class="hd-row">
				<text class="hd-name">{{ name }}</text>
				<text class="hd-total num" :class="{ inc: !isExpense }">{{ isExpense ? '-' : '+' }}{{ fmtYuan(total) }}</text>
			</view>
			<text class="hd-period num">{{ periodLabel }}</text>
		</view>

		<!-- 错误态：数据库不可用时的明确出口（布局复用 .empty，与空态同一形状） -->
		<view v-if="loadError" class="empty">
			<text class="empty-icon">⚠️</text>
			<text class="empty-text">数据加载失败</text>
			<view class="retry af-press" :class="{ pressing: isPressed('retry') }" @touchstart="pressOn('retry')"
				@touchend="pressOff" @touchcancel="pressOff" @click="load"><text>重 试</text></view>
		</view>

		<template v-else>
			<!-- 列表头：笔数 + 账户筛选。
			     账户筛选**只作用于本页**（用户裁定）：分类占比那张图的口径里没有账户维度，
			     所以筛完之后页头的合计会小于刚才那根条的金额 —— 这是筛选的必然结果，不是两个口径打架。 -->
			<view class="list-head">
				<text class="cnt">共{{ totalCount }}笔</text>
				<view class="acct-btn" @click="openAcctPicker">
					<text class="acct-t">{{ accountName }}</text>
					<view :style="maskStyle('chevDown', 24, 'var(--md-on-surface-variant)')"></view>
				</view>
			</view>

			<!-- 分组列表：年粒度按月分组（与首页年报同规），周/月粒度按天 -->
			<view v-for="g in groups" :key="g.key" class="group">
				<view class="group-head">
					<text class="g-label">{{ g.label }}</text>
					<view class="g-sub num">
						<text :class="{ inc: !isExpense }">{{ isExpense ? '支' : '收' }} {{ fmtYuan(g.amount) }}</text>
					</view>
				</view>
				<view v-for="r in g.records" :key="r.id" class="row" :class="{ managing: manageMode }"
					@click.stop="onRowTap" @touchstart="onRowPressStart($event, r)" @touchmove="onRowPressMove"
					@touchend="onRowPressEnd" @touchcancel="onRowPressEnd">
					<category-icon :icon="r.iconKey" :color="r.iconColor" :name="r.iconName" :size="80" />
					<view class="txt">
						<text class="t">{{ r.mainTitle }}</text>
						<text v-if="r.subTitle" class="sub">{{ r.subTitle }}</text>
					</view>
					<text class="amt num" :class="r.amountClass">{{ r.sign }}{{ fmtYuan(r.amount) }}</text>
					<!-- 手续费行（transferId 非空）不给编辑/删除：它完全由所属转账决定（与首页同规） -->
					<view v-if="actsAlive && r.transferId == null" class="acts" :class="{ closing: actsClosing }">
						<view class="act act-edit" @click.stop="onEditTap(r)">
							<view :style="maskStyle('pencil', 30, 'var(--md-primary)')"></view>
						</view>
						<view class="act act-del" @click.stop="onDelete(r)">
							<view :style="maskStyle('trash', 30, 'var(--md-error)')"></view>
						</view>
					</view>
				</view>
			</view>

			<view v-if="groups.length === 0" class="empty">
				<text class="empty-icon">🐦</text>
				<text class="empty-text">{{ emptyText }}</text>
			</view>

			<view v-if="groups.length" class="list-end">
				<text>没有更多了</text>
			</view>

			<view class="foot-pad"></view>
		</template>

		<!-- 账户筛选：底部卡片（与首页同一套） -->
		<view v-if="showAcctPicker" class="af-scrim" :class="{ closing: apClosing }" @click="closeAcctPicker">
			<view class="af-blocker"></view>
			<view class="af-card" :class="{ closing: apClosing }" @click.stop>
				<view class="af-grab"></view>
				<text class="af-title">账户筛选</text>
				<view class="ap-list">
					<!-- 「全部账户」不显示收支（用户裁定，与首页一致） -->
					<view class="ap-item all" :class="{ on: accountId == null }" @click="pickAccount(null)">
						<text class="ap-name">全部账户</text>
						<view v-if="accountId == null" class="ap-check" :style="maskStyle('check', 32, 'var(--md-primary-strong)')"></view>
						<view class="ap-gap"></view>
					</view>
					<view v-for="a in accounts" :key="a.id" class="ap-item" :class="{ on: a.id === accountId }"
						@click="pickAccount(a.id)">
						<category-icon :icon="a.icon" :color="a.color" :name="a.name" :size="56" />
						<view class="ap-mid">
							<text class="ap-name">{{ a.name }}</text>
							<view class="ap-nums num">
								<text>支 {{ fmtYuan(acctOf(a.id).expense) }}</text>
								<text class="inc">收 {{ fmtYuan(acctOf(a.id).income) }}</text>
							</view>
						</view>
						<view class="ap-gap"></view>
						<view v-if="a.id === accountId" class="ap-check" :style="maskStyle('check', 32, 'var(--md-primary-strong)')"></view>
					</view>
				</view>
				<view class="af-btns">
					<view class="af-cancel af-press" :class="{ pressing: isPressed('close') }" @touchstart="pressOn('close')"
						@touchend="pressOff" @touchcancel="pressOff" @click="closeAcctPicker"><text>关闭</text></view>
				</view>
			</view>
		</view>

		<confirm-dialog ref="confirmDlg" />
	</view>
</template>

<script>
	import {
		getCategoryRecords,
		getAccountTotals,
		deleteRecord,
		decorateRecord
	} from '@/services/record.js'
	import {
		listAccounts
	} from '@/services/account.js'
	import {
		maskStyle
	} from '@/services/icons.js'
	import {
		fmtYuan,
		dayLabel,
		monthLabel,
		periodText,
		catLabel
	} from '@/services/format.js'
	import pressFx from '@/services/press.js'

	// 与首页同一组常量（同一个手势在两个页面应当是同一个手感）
	const LONG_PRESS_MS = 450
	const MOVE_TOLERANCE = 8
	const ACTS_OUT_MS = 180

	export default {
		mixins: [pressFx],
		data() {
			return {
				statusBarHeight: 0,
				// ---- 来源页带过来的参数（**全是 ASCII**，本页不再改）----
				cid: null, // 分类 id；null = 已删除分类（孤儿行）
				includeSub: false, // 主分类视角 = 它自己 + 全部子分类
				income: false, // 是否是收入视角（跟随来源页的支出/收入切换）
				gran: 'month', // 来源页的粒度：决定按天还是按月分组
				start: '',
				end: '',
				// ---- 本页现算的两样（都不走 URL —— uni-app 在 App 端不解码 query 里的中文）----
				name: '', // 分类标题（含父分类前缀，如「餐饮-早餐」）：load() 从查回来的流水里取；无流水时为空
				periodLabel: '', // 期间文案：onLoad 里由 periodText 算，与占比条上那一个同源
				// ---- 视图 ----
				groups: [],
				total: 0,
				totalCount: 0,
				loadError: false,
				loadToken: 0,
				// 账户筛选
				accounts: [],
				accountId: null,
				// **这一期、这一个分类下**各账户的收支 —— 弹层里显示的是它，不是账户余额
				acctTotals: [],
				acctToken: 0,
				showAcctPicker: false,
				apClosing: false,
				apTimer: null,
				// 管理模式（长按一行进入，与首页同规）
				manageMode: false,
				actsAlive: false,
				actsClosing: false,
				actsTimer: null,
				pressTimer: null,
				pressMoved: false,
				pressFired: false,
				pressStartX: 0,
				pressStartY: 0
			}
		},
		computed: {
			isExpense() {
				return !this.income
			},
			accountName() {
				const a = this.accounts.find((x) => x.id === this.accountId)
				return a ? a.name : '全部'
			},
			/** 空态要把「哪一期、哪个分类、筛没筛账户」说清楚 —— 否则用户不知道是没数据还是筛错了 */
			emptyText() {
				const kind = this.isExpense ? '支出' : '收入'
				const scope = this.accountId == null ? '' : `「${this.accountName}」下`
				// 空列表时 name 取不到（名字是从流水里取的），那句话就不点名分类
				const what = this.name ? `「${this.name}」的` : ''
				return `${this.periodLabel}${scope}没有${what}${kind}`
			}
		},
		/**
		 * 与首页同样的理由：管理模式的退出路径有四条，都只写一句 manageMode = false，
		 * 图标自己多活 ACTS_OUT_MS 用来播淡出 —— 收在一处才不会漏。
		 */
		watch: {
			manageMode(on) {
				clearTimeout(this.actsTimer)
				if (on) {
					this.actsAlive = true
					this.actsClosing = false
				} else {
					this.actsClosing = true
					this.actsTimer = setTimeout(() => {
						this.actsAlive = false
						this.actsClosing = false
					}, ACTS_OUT_MS)
				}
			}
		},
		onLoad(query) {
			this.statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 0
			// 参数在这里**只读一次**：本页没有任何切期/切分类的入口，之后不再变。
			// ★ 全部是 ASCII —— 分类名与期间文案都在本页现算（名字在 load() 里从流水取，
			//   文案由 periodText 算），**不往 URL 里放中文**：uni-app 在 App 端不会自动
			//   解码 query，放进去的结果是页头显示一串 %E5%B9%B4…
			this.cid = query && query.cid !== '' && query.cid != null ? Number(query.cid) : null
			this.includeSub = (query && query.sub) === '1'
			this.income = (query && query.type) === '2'
			this.gran = (query && query.gran) || 'month'
			this.start = (query && query.start) || ''
			this.end = (query && query.end) || ''
			// 期间文案与占比条上那一个是同一份来源（format.js 的 periodText，断言在 format-repro）
			this.periodLabel = periodText(this.gran, this.start, this.end)
		},
		// 从记一笔编辑返回时要重查（同一 Tab 页式的复用不存在，但编辑/删除后回来必须看到新数）
		onShow() {
			this.load()
			this.loadAccounts()
		},
		/** 安卓返回键：弹层 / 管理模式开着时，返回 = 先关它们（与首页同规） */
		onBackPress() {
			const dlg = this.$refs.confirmDlg
			if (dlg && dlg.visible) {
				dlg.cancel()
				return true
			}
			if (this.manageMode) {
				this.manageMode = false
				return true
			}
			if (this.showAcctPicker) {
				this.closeAcctPicker()
				return true
			}
			return false
		},
		methods: {
			maskStyle,
			fmtYuan,
			goBack() {
				// 兜底：本页正常都是从「我的」压栈进来的，但万一成为栈底，回「我的」而不是卡死
				uni.navigateBack({
					fail: () => uni.switchTab({ url: '/pages/mine/mine' })
				})
			},
			async loadAccounts() {
				const token = ++this.acctToken
				try {
					const list = await listAccounts()
					if (token !== this.acctToken) return
					this.accounts = list
					// 当前筛的账户被删了：退回「全部」，否则页面会一直空着且说不出原因
					if (this.accountId != null && !list.some((a) => a.id === this.accountId)) {
						this.accountId = null
						this.load()
					}
				} catch (e) {
					console.error('[cat-detail] 账户加载失败', e) // 非关键：失败就只显示「全部」
				}
			},
			// ---- 账户筛选 ----
			openAcctPicker() {
				if (this.apTimer) clearTimeout(this.apTimer)
				this.apClosing = false
				this.showAcctPicker = true
			},
			closeAcctPicker() {
				if (!this.showAcctPicker || this.apClosing) return
				this.apClosing = true
				this.apTimer = setTimeout(() => {
					this.showAcctPicker = false
					this.apClosing = false
				}, 200)
			},
			pickAccount(id) {
				this.closeAcctPicker()
				if (this.accountId === id) return // 没变就不重查
				this.accountId = id
				this.load()
			},
			/** 本期这个分类下、这个账户的收支（没记过账 → 0 / 0） */
			acctOf(id) {
				return this.acctTotals.find((x) => x.id === id) || { income: 0, expense: 0 }
			},
			async load() {
				const token = ++this.loadToken
				try {
					const [data, totals] = await Promise.all([
						getCategoryRecords({
							type: this.isExpense ? 1 : 2,
							start: this.start,
							end: this.end,
							cid: this.cid,
							includeSub: this.includeSub,
							groupBy: this.gran === 'year' ? 'month' : 'day',
							accountId: this.accountId
						}),
						// 账户筛选弹层要的是「**这一个分类**下、各账户在这一期的收支」，
						// 所以带上 cid/includeSub —— 与上面那条查询同一个口径。
						// 它不按支出/收入过滤：两个数都要显示（支出分类下的收入自然是 0）。
						getAccountTotals({
							start: this.start,
							end: this.end,
							cid: this.cid,
							includeSub: this.includeSub
						})
					])
					if (token !== this.loadToken) return // 已被取代的请求丢弃
					this.acctTotals = totals.accounts
					// 明细行带不带账户名：只在「全部账户」视图下带（与首页同规）；
					// **不带分类名** —— 整页都是同一个分类，每行重复它是噪音（decorateRecord 的 showCategory）
					const deco = { showAccount: this.accountId == null, showCategory: false }
					this.groups = data.groups.map((g) => ({
						key: g.key,
						// 分组键：'YYYY-MM' 是月、'YYYY-MM-DD' 是日（长度即判据，与 groupBy 一一对应）
						label: g.key.length === 7 ? monthLabel(g.key) : dayLabel(g.key),
						amount: g.amount,
						records: g.records.map((r) => decorateRecord(r, deco))
					}))
					// 页头的合计与列表**同一次查询**算出来 —— 显示的那个数就是列表加起来那个数
					this.total = data.total
					this.totalCount = data.count
					// 分类标题从查回来的流水里取（第一笔的 categoryName + parentName 就是这一页的分类）。
					// 走数据而不是走 URL，名字因此永远与库里的当前值一致；**带上父分类**（`餐饮-早餐`）
					// 才好跟占比条上那根条对上。这一期没有流水时取不到，就让页头与空态都不点名（见 emptyText）。
					//
					// 第三个参数：子分类视角（includeSub=false 就是它）里那张「没选子分类」的条，
					// 占比图上写作「餐饮-直接记账」，页头得跟着写同一个标签才认得出来。
					// 没有父分类时才加后缀 —— 拿 parentName 空不空判断，正是「这一行代表父分类自己」。
					const first = data.groups.length ? data.groups[0].records[0] : null
					const direct = !this.includeSub && !!first && !first.parentName
					const label = first ? catLabel(first.categoryName, first.parentName, direct) : ''
					this.name = label || (this.cid == null ? '已删除分类' : '')
					this.loadError = false
				} catch (e) {
					console.error('[cat-detail] 数据加载失败', e)
					if (token !== this.loadToken) return
					this.loadError = true
				}
			},
			/** 点页面里任何地方都退出管理模式（与首页同规，理由见首页注释） */
			onPageClick() {
				if (this.manageMode) this.manageMode = false
			},
			onRowTap() {
				const swallowed = this.pressFired
				this.pressFired = false
				if (swallowed) return
				if (this.manageMode) this.manageMode = false
			},
			// ---- 管理模式：按住一行不动进入（与首页/分类管理页同一套做法）----
			onRowPressStart(e, r) {
				const t = e.touches && e.touches[0]
				if (!t) return
				this.pressStartX = t.clientX
				this.pressStartY = t.clientY
				this.pressMoved = false
				this.pressFired = false
				if (this.manageMode) return
				if (this.pressTimer) clearTimeout(this.pressTimer)
				this.pressTimer = setTimeout(() => {
					this.pressTimer = null
					this.pressFired = true
					this.manageMode = true
					if (uni.vibrateShort) uni.vibrateShort({ fail: () => {} })
				}, LONG_PRESS_MS)
			},
			onRowPressMove(e) {
				const t = e.touches && e.touches[0]
				if (!t || this.pressMoved) return
				const far =
					Math.abs(t.clientX - this.pressStartX) > MOVE_TOLERANCE ||
					Math.abs(t.clientY - this.pressStartY) > MOVE_TOLERANCE
				if (!far) return
				this.pressMoved = true
				if (this.pressTimer) {
					clearTimeout(this.pressTimer)
					this.pressTimer = null
				}
			},
			onRowPressEnd() {
				if (this.pressTimer) {
					clearTimeout(this.pressTimer)
					this.pressTimer = null
				}
			},
			onEditTap(r) {
				this.manageMode = false
				uni.navigateTo({ url: '/pages/record/edit?id=' + r.id })
			},
			onDelete(rec) {
				// 不退管理模式：连着删几笔是常见动作（与首页同规）
				this.$refs.confirmDlg.open({
					title: '确认删除',
					message: `「${rec.mainTitle}」删除后不可恢复，确定吗？`,
					confirmText: '删除',
					cancelText: '取消',
					danger: true,
					onConfirm: async () => {
						try {
							await deleteRecord(rec.id)
							uni.showToast({ title: '已删除', icon: 'success' })
							this.load()
						} catch (e) {
							console.error('[cat-detail] 删除失败', e)
							uni.showToast({ title: '删除失败', icon: 'none' })
						}
					}
				})
			}
		}
	}
</script>

<style lang="less">
	// 本页独有的两处：页头信息条（.hd）与底部留白（.foot-pad）。
	// 列表、账户卡片那些样式在文件末尾 —— 它们是**从首页复制过来的**，原因见那一段的开头。

	.hd {
		margin: 16rpx 40rpx 0;

		.hd-row {
			display: flex;
			align-items: baseline;
			justify-content: space-between;
			gap: 24rpx;
		}

		.hd-name {
			min-width: 0;
			font-size: 40rpx;
			font-weight: 700;
			color: var(--md-on-surface);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.hd-total {
			flex-shrink: 0;
			font-size: 36rpx;
			font-weight: 700;
			color: var(--md-on-surface);

			&.inc {
				color: var(--md-income);
			}
		}

		.hd-period {
			display: block;
			margin-top: 8rpx;
			font-size: 25rpx;
			color: var(--md-on-surface-variant);
		}
	}

	// 底部留白：本页**没有 tabBar**（它是 navigateTo 进来的普通页），所以不能用首页的
	// .list-foot-pad —— 那个 200rpx 是给固定 tabBar 和它中间那颗凸出的圆钮让位的。
	// 照搬过来会在「没有更多了」下面留一大块说不清来历的空白。
	.foot-pad {
		height: calc(60rpx + constant(safe-area-inset-bottom));
		height: calc(60rpx + env(safe-area-inset-bottom));
	}

	// ---- 以下样式逐字复制自 pages/index/index.vue，两边必须保持一致 ----
	//
	// 为什么不「复用首页的全局类名」：**App 端每个页面有一份独立的 CSS**（产物里就是
	// pages/<page>/<page>.css，各页之间互不可见），只有 App.vue 的样式才真正跨页。
	// 所以「首页定义了 .row，这里直接用」在真机上等于没写样式 —— 整个列表光秃秃地铺在
	// 屏幕上（这一版就是这么炸的：点进分类明细，列表一点样式都没有）。
	// 改这里任何一个数值时，请同步改首页对应那一段。

	.page {
		min-height: 100vh;
		background: var(--md-surface-container);
	}

	.list-head {
		display: flex;
		justify-content: space-between;
		align-items: center; // 右侧是账户胶囊，与左侧文字居中对齐
		padding: 28rpx 44rpx 16rpx;

		.cnt {
			font-size: 26rpx;
			font-weight: 600;
			color: var(--md-on-surface-variant);
		}
	}

	.acct-btn {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 6rpx;
		max-width: 240rpx;
		padding: 8rpx 18rpx;
		border-radius: 999rpx;
		background: var(--md-surface);

		.acct-t {
			min-width: 0;
			font-size: 26rpx;
			color: var(--md-on-surface);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}
	}

	.group-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		padding: 16rpx 32rpx 12rpx;

		.g-label {
			font-size: 28rpx;
			font-weight: 600;
			color: var(--md-on-surface);
		}

		.g-sub {
			font-size: 24rpx;
			color: var(--md-on-surface-variant);

			.inc {
				color: var(--md-income);
			}
		}
	}

	.row {
		position: relative;
		margin: 0 32rpx 12rpx;
		border-radius: 28rpx;
		background: var(--md-surface);
		display: flex;
		align-items: center;
		gap: 28rpx;
		padding: 22rpx 28rpx;
		// 进管理模式时右侧内距 28 → 96rpx，金额因此往左让 —— 让它「被挤过去」而不是瞬移。
		// 只过渡 padding-right：上下内距没有变化点，写成 padding 会让别处改动也变得黏糊。
		transition: padding-right 0.22s ease-out;

		&.managing {
			padding-right: 96rpx;
		}

		// 右侧两枚线条图标：**绝对定位**（不在布局流里），行高因此恒等于普通态。
		// 代价就是上面那条写死的补偿内距（96 = 图标盒 44 + 间隔 24 + 行右内距 28）。
		.acts {
			position: absolute;
			top: 0;
			bottom: 0;
			right: 28rpx;
			display: flex;
			flex-direction: column;
			justify-content: center;
			gap: 16rpx;
			z-index: 2;
			animation: actsIn 0.18s ease-out;

			// 退出：反向淡出，0.18s 与 JS 的 ACTS_OUT_MS 是同一个数（元素靠那个定时器摘掉）
			&.closing {
				animation: actsOut 0.18s ease-in forwards;
				pointer-events: none;
			}
		}

		.act {
			padding: 7rpx; // 30rpx 图形 + 2×7rpx = 44rpx 的点按范围
			display: flex;
			align-items: center;
			justify-content: center;
		}

		.txt {
			flex: 1;
			min-width: 0;
			display: flex;
			flex-direction: column;

			.t {
				font-size: 30rpx;
				font-weight: 500;
				color: var(--md-on-surface);
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			.sub {
				margin-top: 2rpx;
				font-size: 24rpx;
				color: var(--md-on-surface-variant);
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}
		}

		.amt {
			font-size: 32rpx;
			font-weight: 600;
			color: var(--md-on-surface);
			flex-shrink: 0;

			&.inc {
				color: var(--md-income);
			}

			// 转账不是收支：不带正负号、也不用收入/支出的颜色
			&.plain {
				color: var(--md-on-surface-variant);
			}
		}
	}

	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding-top: 160rpx;

		.empty-icon {
			font-size: 96rpx;
		}

		.empty-text {
			margin-top: 24rpx;
			font-size: 26rpx;
			color: var(--md-on-surface-variant);
		}

		// 错误态的重试键（本页自有，首页的错误态在 account.vue 里，同样是页面级样式，
		// 这里**不能**指望它 —— 理由与上面那一段相同）
		.retry {
			margin-top: 40rpx;
			padding: 16rpx 64rpx;
			border-radius: 999rpx;
			background: var(--md-primary);

			text {
				font-size: 27rpx;
				font-weight: 600;
				color: #ffffff;
			}
		}
	}

	.list-end {
		display: flex;
		justify-content: center;
		padding: 32rpx 0 4rpx;

		text {
			font-size: 24rpx;
			color: var(--md-outline);
		}
	}

	// 账户筛选卡片列表（与记账页的账户卡片同形）
	.ap-list {
		max-height: 560rpx;
		overflow-y: auto;
		overscroll-behavior: contain; // 断掉滚动链：滚到头也不把背后的页面带着滚

		.ap-item {
			display: flex;
			align-items: center;
			gap: 20rpx;
			padding: 22rpx 24rpx;
			border-radius: 999rpx;

			&.on {
				background: var(--md-primary-container);
			}

			// 「全部账户」：无图标，靠更深的底 + 更大的主色文字让它**永远**醒目
			&.all {
				background: var(--md-surface-container-highest);
				border-radius: 999rpx;
				padding: 28rpx 24rpx;
				margin-bottom: 10rpx;

				.ap-name {
					font-size: 30rpx;
					font-weight: 600;
					color: var(--md-primary-strong);
				}

				&.on {
					background: var(--md-primary-container);

					.ap-name {
						color: var(--md-on-primary-container);
					}
				}
			}

			// 名字与「支 / 收」上下两行（与首页那一份保持一致）
			.ap-mid {
				flex: 1;
				min-width: 0;
				display: flex;
				flex-direction: column;
				gap: 6rpx;
			}

			.ap-name {
				min-width: 0;
				font-size: 28rpx;
				color: var(--md-on-surface);
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			// 本期该账户的收支（**不是余额**）：支出走中性色、收入走收入色
			.ap-nums {
				display: flex;
				gap: 24rpx;
				font-size: 24rpx;
				color: var(--md-on-surface-variant);

				.inc {
					color: var(--md-income);
				}
			}

			// 弹性空档：撑开名字那两行与右侧对勾之间的空白；对勾因此仍贴右
			.ap-gap {
				flex: 1;
				min-width: 0;
			}

			.ap-check {
				flex-shrink: 0;
			}
		}
	}

	@keyframes actsIn {
		from {
			opacity: 0;
		}
	}

	@keyframes actsOut {
		to {
			opacity: 0;
		}
	}
</style>
