<template>
	<!-- 左右滑切页：**任意位置**起滑都算（2026-10-03 用户裁定；原先只在边缘生效是因为要与列表左滑删除分工，
	     而左滑已取消）。只监听 start/end、不碰 touchmove，故不影响列表滚动。见 services/tab-swipe.js -->
	<view class="page" :class="slideClass" :style="themeVars" @touchstart="onSwipeStart"
		@touchend="onSwipeEnd" @touchcancel="onSwipeEnd" @click="onPageClick">
		<!-- 错误态：数据库不可用时的明确出口（Spec §9，M3 既有能力）。
		     形状与「分类明细」页的错误态一致（.empty + .retry）——原先用的 .error-box 只定义在
		     account.vue 里，而 **App 端页面样式是隔离的**，那个类名在这一页根本拿不到：
		     数据库真出问题时，这里会是一个没有样式的裸按钮。跨页那一版由 check-pages 第七道拦住。 -->
		<view v-if="loadError" class="empty">
			<text class="empty-icon">⚠️</text>
			<text class="empty-text">数据加载失败</text>
			<view class="retry af-press" :class="{ pressing: isPressed('retry') }" @touchstart="pressOn('retry')"
				@touchend="pressOff" @touchcancel="pressOff" @click="load"><text>重 试</text></view>
		</view>

		<template v-else>
			<!-- 固定区：大标题 → 列表头这一整段不跟着列表滚（用户裁定：只有列表区能滚）。
			     里面几十行的缩进**没动**，只在外面包了一层 —— 重排一遍只会把 diff 撑爆，
			     而这一层纯粹是布局用的，不参与任何数据与事件 -->
			<view class="head-fixed">
			<!-- 大标题 + 一句话签名（点签名即改，末尾铅笔是「可编辑」提示） -->
			<view class="appbar" :style="{ paddingTop: statusBarHeight + 10 + 'px' }">
				<view class="title-row">
					<!-- 「飞鸟」当主体、「记账」退成次级：字号 / 字重 / 颜色 / 字距四个维度一起拉，
					     设计稿见 docs/design/2026-10-03-app-title-preview.html -->
					<view class="app-title">
						<text class="t-brand">飞鸟</text>
						<text class="t-kind">记账</text>
					</view>
					<view class="tagline-btn" :class="{ empty: !tagline }" @click="openTagEdit">
						<text class="tagline">{{ tagline || '没有签名' }}</text>
						<view class="tagline-pen" :style="maskStyle('pencil', 26, 'var(--md-on-surface-variant)')"></view>
					</view>
				</view>
			</view>

			<!-- 期次切换 chip + 月/年分段 -->
			<view class="month-row">
				<view class="month-chip">
					<view class="chev" @click="shiftPeriod(-1)">
						<view :style="maskStyle('chevL', 38, 'var(--md-on-surface-variant)')"></view>
					</view>
					<text class="period-label num" @click="openPeriodPicker">{{ periodLabel }}</text>
					<view class="chev" :class="{ off: !canForward }" @click="shiftPeriod(1)">
						<view :style="maskStyle('chevR', 38, 'var(--md-on-surface-variant)')"></view>
					</view>
				</view>
				<view class="mode-seg">
					<!-- 滑动指示块：translateX 100% 滑到「年」，transition 由样式给 -->
					<view class="seg-thumb"
						:style="{ transform: mode === 'year' ? 'translateX(100%)' : 'translateX(0)' }">
					</view>
					<view class="seg-btn" :class="{ on: mode === 'month' }" @click="setMode('month')"><text>月</text>
					</view>
					<view class="seg-btn" :class="{ on: mode === 'year' }" @click="setMode('year')"><text>年</text>
					</view>
				</view>
			</view>

			<!-- 汇总卡：支出 | 收入 并列一行（支出在左，用户裁定）；结余 + 储蓄率 小字一行 -->
			<view class="summary">
				<view class="sum-row">
					<view class="stat">
						<text class="k">支出（元）</text>
						<text class="v num">{{ fmtYuan(summary.expense) }}</text>
					</view>
					<view class="stat">
						<text class="k">收入（元）</text>
						<text class="v num income">{{ fmtYuan(summary.income) }}</text>
					</view>
					<!-- 分隔线是独立元素、绝对定位在 50%：位置只由定位决定，
					     不受 padding / box-sizing / flex 分配的影响（详见样式里的注释） -->
					<view class="sum-div"></view>
				</view>
				<view class="sum-sub num">
					<text>结余 </text>
					<text class="b">{{ balanceText }}</text>
					<text style="margin-right:50rpx">元</text>
					<text>&nbsp;储蓄率 {{ rateText }}</text>
				</view>
			</view>

			<!-- 列表头 -->
			<view class="list-head">
				<text class="cnt">{{ mode === 'year' ? '本年' : '本月' }}共{{ totalCount }}笔</text>
				<!-- 账户筛选：从标题行搬到这儿（用户裁定），替掉原来的左滑提示。
				     右上角的角标 = 还有几笔预付没报回来（0 的时候不出现） -->
				<view class="acct-btn" @click="openAcctPicker">
					<text class="acct-t">{{ accountName }}</text>
					<view :style="maskStyle('chevDown', 24, 'var(--md-on-surface-variant)')"></view>
					<view v-if="pendingCount > 0" class="badge">
						<text class="badge-t num">{{ pendingCount }}</text>
					</view>
				</view>
			</view>
			</view>

			<!-- 空态**不进滚动区**（理由见 prepay.vue）：它有整个剩余高度可用，也不该能滚 -->
			<view v-if="groups.length === 0" class="empty">
				<text class="empty-icon">🐦</text>
				<text class="empty-text">{{ periodLabel }}还没有记账</text>
			</view>

			<!-- **只有这一块滚**。列表到底由 scroll-view 自己的 scrolltolower 触发 ——
			     页头已经不参与滚动了，页面的 onReachBottom 因此永远不会响 -->
			<scroll-view v-else class="list-body" :scroll-y="listScrollable" :scroll-top="scrollTop"
				:scroll-into-view="scrollIntoView" scroll-with-animation @scroll="onListScroll"
				@scrolltolower="onListLower">
			<!-- 包裹层：measureList() 靠它量「内容总高」—— 列表顶层是多个 .group，
			     没有这么一个统一的父节点，就只能去猜「最后一个节点是谁」 -->
			<view class="list-inner">
			<!-- 分组列表：月视图按天 / 年视图按月，结构同构。走 visibleGroups（懒加载切出来的
			     那一段），不是 groups —— 数据全量在手，渲染按需放 -->
			<view v-for="g in visibleGroups" :key="g.key" :id="'g-' + g.key" class="group">
				<view class="group-head">
					<text class="g-label">{{ g.label }}</text>
					<view class="g-sub num">
						<text v-if="g.expense">支 {{ fmtYuan(g.expense) }}</text>
						<text v-if="g.expense && g.income">&nbsp;&nbsp;</text>
						<text v-if="g.income" class="inc">收 {{ fmtYuan(g.income) }}</text>
					</view>
				</view>
				<view v-for="r in g.records" :key="r.id" class="row" :class="{ managing: manageMode }"
					@click.stop="onRowTap" @touchstart="onRowPressStart" @touchmove="onRowPressMove"
					@touchend="onRowPressEnd" @touchcancel="onRowPressEnd">
					<category-icon :icon="r.iconKey" :color="r.iconColor" :name="r.iconName" :size="80" />
					<view class="txt">
						<!-- 标题 + 「预付」标识同一行：标识是这块的，不能塞进 .txt（那是列容器，
						     塞进去会另起一行）。App 端 <text> 是行内元素，同行必须有显式 flex 容器 -->
						<view class="t-row">
							<text class="t">{{ r.mainTitle }}</text>
							<text v-if="r.prepay" class="pre-tag">预付</text>
							<text v-if="r.settled" class="settled-tag">结清</text>
						</view>
						<text v-if="r.subTitle" class="sub">{{ r.subTitle }}</text>
					</view>
					<!-- 三态：支出「-」红、收入「+」收入色、转账不带正负号走中性色（它不算收支） -->
					<text class="amt num" :class="r.amountClass">{{ r.sign }}{{ fmtYuan(r.amount) }}</text>
					<!-- 管理模式：右侧上下两枚**线条图标** —— 编辑＝笔（主题色）、删除＝垃圾桶（语义红）。
					     不带圆底：图形本身就是按钮，靠内边距撑出点按范围（内边距不画东西，视觉上仍是裸线）。
					     它们在**绝对定位**里（见样式）—— 不参与行高，所以进编辑态列表高度不变 -->
					<!-- 手续费行（transferId 非空）不给编辑/删除按钮：它完全由所属转账决定，
					     给了半个入口反而会出现「删了它、编辑转账又把它插回来」的状态不一致 -->
					<!-- 调整流水（r.adjust，分类是「差异调节」）不给编辑、**但要给删除**：
					     它的金额与分类是改余额时反推出来的，手改一笔就破坏了「这笔调整让余额正好
					     落到目标值」那个前提 —— 而余额是流水算出来的，用户改完只会看到数字不对，
					     找不到是谁动的。删除是合理的（余额就回到调整前）。服务层还有一道硬拦。
					     ★ 编辑按钮整枚**不渲染**（v-if，不是 visibility: hidden）：这一行只剩删除
					     一枚，.acts 按现有子项居中，它正好落在行的正中央 —— 换个方式占位就没有这个效果 -->
					<!-- 结清流水（r.settled）也不给编辑/删除：它与所属的那笔预付是一体的，
					     要撤就回「预付历史」长按取消结清 —— 单删这一条会留下半截账 -->
					<view v-if="actsAlive && r.transferId == null && !r.settled" class="acts" :class="{ closing: actsClosing }">
						<view v-if="!r.adjust" class="act act-edit" @click.stop="onEditTap(r)">
							<view :style="maskStyle('pencil', 30, 'var(--md-primary)')"></view>
						</view>
						<view class="act act-del" @click.stop="onDelete(r)">
							<view :style="maskStyle('trash', 30, 'var(--md-error)')"></view>
						</view>
					</view>
				</view>
			</view>

			<!-- 列表到底提示：还有没渲染出来的就先别说「到头了」—— 滚到底自动补一批
			     （onReachBottom），补完这里才换成「没有更多了」 -->
			<view v-if="groups.length" class="list-end">
				<text>{{ hasMore ? '上拉加载更多' : '没有更多了' }}</text>
			</view>

			<view class="list-foot-pad"></view>
			</view>
			</scroll-view>
		</template>

		<!-- 签名编辑：底部卡片（与记一笔弹层同机制：closing 标志撑住节点播退场动画再拆） -->
		<view v-if="showTagEdit" class="af-scrim" :class="{ closing: tagEditClosing }" @click="closeTagEdit">
			<view class="af-blocker"></view>
			<view class="af-card" :class="{ closing: tagEditClosing }" @click.stop>
				<view class="af-grab"></view>
				<text class="af-title">一句话签名</text>
				<view class="clr-wrap">
					<input class="sig-input" v-model="taglineInput" placeholder="写在首页大标题旁边的一句话" maxlength="20" :cursor-spacing="kbSpacing"
						placeholder-class="af-ph" />
					<!-- 有内容才显示；点它清空输入（保存仍由下面的「保存」负责） -->
					<view v-if="taglineInput" class="clr-btn" @click="taglineInput = ''">
						<view :style="maskStyle('x', 26, 'var(--md-on-surface-variant)')"></view>
					</view>
				</view>
				<!-- 字数上限要**告诉用户**（不只是静默截断），所以右边给个计数 -->
				<view class="sig-foot">
					<text class="af-hint">最多 20 字；清空并保存表示不要签名</text>
					<text class="sig-count num">{{ taglineInput.length }}/20</text>
				</view>
				<view class="af-btns">
					<view class="af-cancel af-press" :class="{ pressing: isPressed('cancel') }" @touchstart="pressOn('cancel')"
						@touchend="pressOff" @touchcancel="pressOff" @click="closeTagEdit"><text>取消</text></view>
					<view class="af-done af-press" :class="{ pressing: isPressed('save') }" @touchstart="pressOn('save')"
						@touchend="pressOff" @touchcancel="pressOff" @click="saveTagline"><text>保存</text></view>
				</view>
			</view>
		</view>

		<!-- 账户筛选：底部卡片（首行「全部账户」= 不筛；选中即重查） -->
		<view v-if="showAcctPicker" class="af-scrim" :class="{ closing: apClosing }" @click="closeAcctPicker">
			<view class="af-blocker"></view>
			<view class="af-card" :class="{ closing: apClosing }" @click.stop>
				<view class="af-grab"></view>
				<text class="af-title">账户筛选</text>
				<view class="ap-list">
					<!-- 「全部账户」不显示本期收支（用户裁定）：它不是某个账户，写「支/收」在这里
					     反而像是「另一个账户」，而它代表的是「不筛」。但**余额那一格例外** ——
					     它显示的是总资产：既然这一屏开始看余额了，「一共多少」是最自然的一个数
					     （用户裁定），而且它同样是「到今天」的口径，与下面各行的余额同源。 -->
					<view class="ap-item all" :class="{ on: accountId == null }" @click="pickAccount(null)">
						<view class="ap-mid">
							<view class="ap-top">
								<text class="ap-name">全部账户</text>
								<text class="ap-bal num" :class="{ neg: totalBalance < 0 }">余额 {{ fmtYuan(totalBalance) }}</text>
							</view>
						</view>
						<view class="ap-check" :class="{ off: accountId != null }" :style="maskStyle('check', 32, 'var(--md-primary-strong)')"></view>
					</view>
					<!-- 这份列表里没有预付账户（listAccounts 滤掉了）：点账户是「按它筛」，
					     看预付是「垫出去多少」—— 后者由下面那行「预付管理」负责，
					     两件事挤在同一个位置上，用户只能靠猜 -->
					<view v-for="a in accounts" :key="a.id" class="ap-item" :class="{ on: a.id === accountId }"
						@click="pickAccount(a.id)">
						<category-icon :icon="a.icon" :color="a.color" :name="a.name" :size="56" />
						<view class="ap-mid">
							<!-- 名字行两端：左是账户名，右是**余额**（累计到今天）。
							     ★ 它和下面那行的「支/收」不是一个口径 —— 那是**本期**的进出。
							     分两行摆就是为了让这件事看得出来（用户选的版式）。 -->
							<view class="ap-top">
								<text class="ap-name">{{ a.name }}</text>
								<text class="ap-bal num" :class="{ neg: a.balance < 0 }">余额 {{ fmtYuan(a.balance) }}</text>
							</view>
							<view class="ap-nums num">
								<text>支 {{ fmtYuan(acctOf(a.id).expense) }}</text>
								<text class="inc">收 {{ fmtYuan(acctOf(a.id).income) }}</text>
							</view>
						</view>
						<view class="ap-check" :class="{ off: a.id !== accountId }" :style="maskStyle('check', 32, 'var(--md-primary-strong)')"></view>
					</view>

					<!-- 预付管理入口：摆在账户列表**末尾**（预付账户本来就在最后一行，位置对得上）。
					     带同样的角标 —— 用户从首页看过来，「几笔没报回来」是同一个数。
					     ★ 一笔待回收都没有时**也留着**（用户裁定）：那张页面里还挂着「历史记录」，
					       藏了这个入口，结清过的旧账就哪儿都翻不到了。
					     ★ 它是预付**唯一**的入口：「我的」页故意不加第二个（用户裁定）。 -->
					<view class="ap-item pre-entry" @click="goPrepayManage">
						<!-- 图标用**账户图标那套画法**（同一个组件：白图形 + 兜底灰圆底）。
						     颜色不传 = 那个兜底灰 —— 预付账户本身不会出现在账户列表里了，
						     而它的颜色恒为空（不可编辑），所以这里走兜底就是「和它一样」。 -->
						<category-icon icon="svg:hand-coins" name="预" :size="56" />
						<view class="ap-mid">
							<view class="ap-top">
								<text class="ap-name">预付管理</text>
								<text v-if="pendingCount > 0" class="ap-bal pre-bal">待收 {{ pendingCount }} 笔</text>
								<text v-else class="ap-bal">没有待回收</text>
							</view>
						</view>
						<view :style="maskStyle('chevR', 28, 'var(--md-on-surface-variant)')"></view>
					</view>
				</view>
				<view class="af-btns">
					<view class="af-cancel af-press" :class="{ pressing: isPressed('close') }" @touchstart="pressOn('close')"
						@touchend="pressOff" @touchcancel="pressOff" @click="closeAcctPicker"><text>关闭</text></view>
				</view>
			</view>
		</view>

		<!-- 快速切换期间：**日历**（月态弹月历、年态弹年历）。
		     期次胶囊 / 月年分段 / 账户筛选都没动 —— 这里只换了弹层里的内容，
		     所以没有多出一套时间导航。格子上带当天的收支，它同时是选期器和分布视图 -->
		<view v-if="showPeriodPicker" class="af-scrim" :class="{ closing: ppClosing }" @click="closePeriodPicker">
			<view class="af-blocker"></view>
			<view class="af-card" :class="{ closing: ppClosing }" @click.stop>
				<view class="af-grab"></view>
				<period-calendar :mode="mode" :year="calYear" :month="calMonth" :today="todayStr"
					:values="periodValues" @pick="onCalendarPick" />
				<view class="af-btns">
					<view class="af-cancel af-press" :class="{ pressing: isPressed('cancel') }" @touchstart="pressOn('cancel')"
						@touchend="pressOff" @touchcancel="pressOff" @click="closePeriodPicker"><text>取消</text></view>
				</view>
			</view>
		</view>

		<!-- 自绘确认框（easycom 自动注册） -->
		<confirm-dialog ref="confirmDlg" />

		<!-- 自绘 tabBar（Task 4.5） -->
		<app-tabbar current="index" />
	</view>
</template>
<script>
	import {
		getMonthlyData,
		getYearlyData,
		getAccountTotals,
		deleteRecord,
		decorateRecord
	} from '@/services/record.js'
	// 角标要的「还有几笔没报回来」（预付唯一入口的那个数）
	import { getPendingCount } from '@/services/prepay.js'
	import {
		listAccounts
	} from '@/services/account.js'
	import {
		getMeta,
		setMeta,
		hasMeta
	} from '@/services/meta.js'
	import {
		maskStyle
	} from '@/services/icons.js'
	import {
		fmtYuan,
		fmtPercent,
		dayLabel,
		monthLabel
	} from '@/services/format.js'
	import tabSwipe from '@/services/tab-swipe.js'
	import pressFx from '@/services/press.js'
	import PeriodCalendar from '@/components/period-calendar/period-calendar.vue'
	import { todayKey } from '@/services/calendar.js'
	// 懒加载的切片逻辑（与分类明细页共用一份，可被 scripts/lazy-repro.mjs 覆盖）
	import {
		sliceGroups
	} from '@/services/lazy.js'

	// 管理模式：按住一行不动多久算长按；位移超过多少就认定「在滑列表」而取消长按。
	// 取值与分类管理页同一组（同一个手势在两个页面应当是同一个手感）。
	const LONG_PRESS_MS = 450
	const MOVE_TOLERANCE = 8
	// 管理态两枚图标**淡出**的时长：CSS 动画 0.18s，元素则由这个定时器摘掉 —— 两处是同一个数，
	// 改一个就要改另一个（CSS 那边注释里也写了这句）。
	const ACTS_OUT_MS = 180
	const DEFAULT_TAGLINE = '今天也要认真存钱'
	// 流水列表懒加载：首屏只渲染这么多行，滚到底再补一批（见 visibleGroups / onReachBottom）。
	// 数的是**流水条数**而不是分组数 —— 年视图里一个月能压着几百笔，按组分批等于没分；
	// 按行数封顶，首屏的节点数才与这期间记了多少笔无关。
	const LAZY_ROWS = 60

	export default {
		components: { PeriodCalendar },
		mixins: [tabSwipe, pressFx],
		data() {
			return {
				statusBarHeight: 0,
				// 左右滑切页：明细是最左的 tab：只能往左滑（去右边的「我的」）。
				// 反方向没有相邻 tab —— 不出手，连转场都不播（用户反馈：会「动一下」再弹回）。
				swipeDirs: [-1],
				mode: 'month', // 'month' | 'year'
				month: '', // 'YYYY-MM'
				year: 0, // 年视图用
				summary: {
					income: 0,
					expense: 0
				},
				groups: [],
				totalCount: 0,
				// 懒加载：当前渲染到第几行（真正切的是 visibleGroups），滚到底再 +LAZY_ROWS。
				// 数据仍是**全量**查回来的 —— 合计、页头、分组小计都要全量才算得对。
				shownRows: LAZY_ROWS,
				// 列表滚动位置（只用来「切期回到顶部」——用户自己滚不会回写这里，
				// scroll-view 是单向绑定）
				scrollTop: 0,
				// 这一块能不能滚：由 measureList() 按「内容是否真的超过可用高度」决定。
				// 内容装得下就把 scroll-y 关掉 —— scroll-view 内部认的「内容高度」跟它
				// 渲染出来的框高对不上（真机实测：框 707、内容 280，却滚了 75px），
				// 跟它算不明白，干脆按我们自己量到的数决定让不让它滚
				listScrollable: false,
				// 上一次 load 的「期间 + 账户」指纹：变了才把 shownRows 收回首屏。
				// 从记一笔返回是**同一期间重查**，那时不该把用户滚到的位置打回顶部。
				loadKey: '',
				loadError: false,
				tagline: DEFAULT_TAGLINE,
				// 签名编辑底部卡片
				showTagEdit: false,
				tagEditClosing: false, // 退场动画标志（showTagEdit 撑到播完才清）
				tagEditTimer: null,
				taglineInput: '',
				// 管理模式（长按一行不动进入，见 onRowPressStart）
				manageMode: false,
				actsAlive: false, // 图标是否在 DOM 里（比 manageMode 多活 ACTS_OUT_MS，用来播淡出）
				actsClosing: false,
				actsTimer: null,
				pressTimer: null,
				pressMoved: false, // 这一次按压中手指动过 → 取消长按（滑列表不该触发）
				pressFired: false, // 这一次按压已经进过管理模式（用来吞掉随后派生出的那次 click）
				pressStartX: 0,
				pressStartY: 0,
				loadToken: 0, // 请求令牌：快速切期丢弃晚到响应（收口审查 M1）
				// M6 账户筛选（null = 全部）
				accounts: [],
				accountId: null,
				// 还有几笔预付没报回来（角标 + 弹层里那行「预付管理」都用它）。
				// 0 = 两个地方都不显示数字
				pendingCount: 0,
				// 本期各账户的收支（`[{id, income, expense}]`），账户筛选弹层里显示的是它，
				// **不是账户余额** —— balance 是累计到今天的，与用户正在看的这一期无关
				acctTotals: [],
				acctToken: 0,
				showAcctPicker: false,
				apClosing: false,
				apTimer: null,
				// 快速切换期间
				showPeriodPicker: false,
				ppClosing: false,
				ppTimer: null,
				// 滚到哪一组（形如 'g-2026-10-15'）。★ 只在「点日历」时设，用户一动手指就清掉 ——
				// 不清的话，之后任何一次重渲染都会把列表拽回那一天
				scrollIntoView: ''
			}
		},
		computed: {
			/**
			 * 各账户余额合计 —— 「全部账户」那一行右端显示的。
			 *
			 * ★ 与 services/account.js 的 `getTotalAssets()` 是同一个算法（那边就是
			 *   `listAccounts()` 求和），而这一页手上已经有那份列表了，所以直接算，
			 *   不再多查一次库。口径不会走散 —— 两边求的都是同一个 `balance` 字段。
			 */
			totalBalance() {
				return this.accounts.reduce((n, a) => n + a.balance, 0)
			},
			/**
			 * 懒加载切出来的那一段（数据全量在手，只有渲染按需放）。
			 * 纯函数在 services/lazy.js —— 首页与分类明细共用一份，边界另有脚本覆盖。
			 */
			lazySlice() {
				return sliceGroups(this.groups, this.shownRows)
			},
			// 模板真正 v-for 的就是它，不是 groups
			visibleGroups() {
				return this.lazySlice.groups
			},
			// 还有没渲染出来的（滚到底要不要继续补）
			hasMore() {
				return this.lazySlice.more
			},
			periodLabel() {
				if (this.mode === 'year') return `${this.year}年`
				if (!this.month) return ''
				const [y, m] = this.month.split('-')
				return `${y}年${Number(m)}月`
			},
			// 账户按钮文案：未筛 = 「全部账户」（用户裁定：写全，不要只写「全部」——
			// 弹层里那一行本来就叫「全部账户」，两处该是同一个词。与分类明细页同一份）
			accountName() {
				const a = this.accounts.find((x) => x.id === this.accountId)
				return a ? a.name : '全部账户'
			},
			// 筛选弹层里列的账户就是 this.accounts —— 预付账户已经被 listAccounts 滤掉了
			// （服务层是唯一真源，页面不再自己过滤一遍）
			balance() {
				return this.summary.income - this.summary.expense
			},
			// 定稿：结余正数不加号，负数带减号（复用 fmtYuan，恒两位小数）
			balanceText() {
				return `${this.balance >= 0 ? '' : '-'}${this.fmtYuan(Math.abs(this.balance))}`
			},
			/** 点期次时弹的日历看哪一期 */
			calYear() {
				return this.mode === 'year' ? this.year : Number(this.month.slice(0, 4))
			},
			calMonth() {
				return Number(this.month.slice(5, 7)) || 1
			},
			/** 画「今天」那一圈用的 */
			todayStr() {
				return todayKey()
			},
			/**
			 * 喂给日历的每格数字：当天的**净收支**（分）。
			 *
			 * ★ 用**全量** groups，不是 visibleGroups —— 后者是懒加载切过的、只有渲染出来那一段，
			 *   而日历要看整月/整年。
			 */
			periodValues() {
				const out = {}
				for (const g of this.groups) out[g.key] = (g.income || 0) - (g.expense || 0)
				return out
			},
			// 能不能往后翻：不允许切到「当天之后」（用户裁定）。'YYYY-MM'/年份用字符串比较即可
			canForward() {
				const d = new Date()
				const p = (n) => String(n).padStart(2, '0')
				if (this.mode === 'year') return this.year < d.getFullYear()
				return this.month < `${d.getFullYear()}-${p(d.getMonth() + 1)}`
			},
			// 储蓄率 = 100 − 支出率；恒两位小数（用户裁定：20% 也显示成 20.00%）
			rateText() {
				return this.summary.income > 0 ?
					fmtPercent(100 - (this.summary.expense / this.summary.income) * 100) :
					'—'
			}
		},
		/**
		 * 两枚操作图标的进出：`manageMode` 只表达「是不是在管理模式」，图标自己多活 ACTS_OUT_MS
		 * 用来播淡出。
		 *
		 * 为什么挂 watch 而不是在退出处逐个加：退出的路径有四条（点任意处、点行本身、安卓返回键、
		 * onHide），它们都只写一句 `this.manageMode = false` —— 挂在这里只有一处，将来加路径也不会漏。
		 */
		watch: {
			manageMode(on) {
				clearTimeout(this.actsTimer) // 先撤上一次的收尾：快速进出时旧定时器会把图标摘掉
				if (on) {
					this.actsAlive = true
					this.actsClosing = false // 摘掉 .closing → 重新挂上 actsIn，快速回场也是淡入
				} else {
					this.actsClosing = true // 先淡出，等动画放完再摘元素
					this.actsTimer = setTimeout(() => {
						this.actsAlive = false
						this.actsClosing = false
					}, ACTS_OUT_MS)
				}
			},
			// 列表内容变了就重量一次：切期/切账户的重查、空态↔列表的切换、
			// 以及滚到底补了一批（shownRows 变大）
			'groups.length'() {
				this.$nextTick(this.measureList)
			},
			shownRows() {
				this.$nextTick(this.measureList)
			}
		},
		onLoad() {
			const si = uni.getSystemInfoSync()
			this.statusBarHeight = si.statusBarHeight || 0
			const d = new Date()
			const p = (n) => String(n).padStart(2, '0')
			this.month = `${d.getFullYear()}-${p(d.getMonth() + 1)}`
			this.year = d.getFullYear()
		},
		onReady() {
			this.measureList()
		},
		// 首次显示也会触发 onShow（在 onLoad 之后）；从记一笔/我的返回时刷新
		onShow() {
			this.load()
			this.loadTagline()
			this.loadAccounts() // M6：账户名/余额可能刚在账户页改过
		},
		/**
		 * 离开本页时退出管理模式。
		 *
		 * 为什么挂在生命周期上、而不是在「边缘滑切页」那个方法里清：tab 页是 switchTab
		 * **复用**的（只是被藏起来），模式会活过这一次切页 —— 长按进入模式再切到「我的」，
		 * 回来时整页还在抖。会离开本页的路径不止一条（边缘滑切页、点 tabBar、去记账页、
		 * App 切后台…），挂在每一处迟早会漏掉一处，而 onHide 是**所有**路径的公共出口。
		 * 点 tabBar 那条路另有 onPageClick 兜着（那是点击）。
		 */
		onHide() {
			this.manageMode = false
		},
		/** 安卓返回键：确认框开着时，返回＝取消（返回 true 消费掉事件） */
		onBackPress() {
			const dlg = this.$refs.confirmDlg
			if (dlg && dlg.visible) {
				dlg.cancel()
				return true
			}
			if (this.manageMode) {
				this.manageMode = false // 返回键先退出管理模式（与分类管理页同规）
				return true
			}
			if (this.showAcctPicker) {
				this.closeAcctPicker()
				return true
			}
			if (this.showPeriodPicker) {
				this.closePeriodPicker()
				return true
			}
			return false
		},
		methods: {
			/**
			 * 列表滚到底：把懒加载的门槛再抬一批（模板随之多渲染 LAZY_ROWS 行）。
			 *
			 * 触发者是 **scroll-view 的 @scrolltolower**，不是页面的 onReachBottom ——
			 * 页头固定后整页不再滚动，页面级那个钩子永远等不到。
			 */
			onListLower() {
				if (!this.hasMore) return
				this.shownRows += LAZY_ROWS
			},
			/**
			 * 量出列表内容有没有超过可用高度，据此决定这一块能不能滚。
			 *
			 * 为什么不让 CSS 自己判断：这一块折腾过很多轮 —— .page 试过 min-height / 100vh /
			 * 甚至锁死高度，真机上**总差那么一丁点**（内容明明不多，却刚好能拖出一个卡片间距）。
			 * 根因是 App 端 scroll-view 内部认的「内容高度」跟它渲染出来的框高对不上
			 * （真机实测：框高 707、内容只有 280，却滚了 75px），跟它算不明白。
			 * 所以改成：我们自己量，量到装得下就把 scroll-y 关掉 —— 物理上没得滚。
			 *
			 * ★ 锚点是 .list-body 的 **top**（只由它上面的页头决定，不受它自己多高影响），
			 *   拿窗口高减出来就是可用高度 —— 用「它自己的高度」就成了循环依赖。
			 * ★ 容器高度本身**不锁**（交回 CSS 的 flex: 1），锁成「测量那一瞬的内容高」的话，
			 *   列表里任何动态展开都会被裁掉一截。
			 */
			measureList() {
				const q = uni.createSelectorQuery().in(this)
				q.select('.list-body').boundingClientRect()
				q.select('.list-inner').boundingClientRect()
				q.exec((res) => {
					const b = res && res[0]
					const inner = res && res[1]
					if (!b) return // 空态时这一块不存在，本来也不需要滚
					const avail = Math.max(0, uni.getSystemInfoSync().windowHeight - b.top)
					const content = inner ? inner.height : 0
					this.listScrollable = content > avail + 1 // +1 容差躲浮点
				})
			},
			maskStyle, // 模板里直接用
			fmtYuan, // 由 services/format.js 提供（金额格式化只保留一份）
			// ★ 搬到 format.js 之后**仍要在这里挂一次**：模板与 load() 里写的都是 this.dayLabel，
			//   而 import 进来的名字只活在模块作用域里，不会自动变成实例上的方法。
			//   只改 import、删掉 methods 里这两行的那一版，真机首页直接白屏（this.dayLabel is not a function）。
			dayLabel,
			monthLabel,
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
					console.error('[index] 账户加载失败', e) // 非关键：失败就只显示「全部」
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
				this.load() // 汇总 / 图表 / 列表同一批参数，时间不重置
			},
			/** 弹层末尾那行「预付管理」：先收弹层再跳 —— 否则返回时它还盖在首页上 */
			goPrepayManage() {
				this.closeAcctPicker()
				uni.navigateTo({ url: '/pages/prepay/prepay' })
			},
			// ---- 快速切换期间（点期次弹日历；点格子＝选期，顺带滚到那天）----
			openPeriodPicker() {
				if (this.ppTimer) clearTimeout(this.ppTimer)
				this.ppClosing = false
				this.showPeriodPicker = true
			},
			/**
			 * 点日历上的一格。月态给 'YYYY-MM-DD'，年态给 'YYYY-MM'。
			 *
			 * 月态点到别人的月份（前后月那几格）＝**先切到那个月**，所以日历自己就是翻月器，
			 * 不需要额外的 ‹ › 按钮；切不切期由下面那个比较判断，不用写分支。
			 */
			async onCalendarPick(key) {
				if (this.mode === 'year') {
					// 年态点某月 → 切到月视角看那个月（年视角下点月，多半是想看细节了）
					this.month = key
					this.year = Number(key.slice(0, 4))
					this.closePeriodPicker()
					this.setMode('month')
					return
				}
				const toMonth = key.slice(0, 7)
				const changed = this.month !== toMonth
				if (changed) this.month = toMonth
				this.closePeriodPicker()
				if (changed) await this.load()
				this.scrollToDay(key)
			},
			/**
			 * 滚到某一天。两步都不能少：
			 *
			 * ① **先让那天落在渲染范围内** —— 列表是懒加载切片的（visibleGroups），
			 *    目标节点还没渲染时 `scroll-into-view` 会**静默失败**（不报错、就是不动）。
			 *    所以先按全量 groups 累加行数，把它前面的都算进来，把 shownRows 抬够。
			 * ② `$nextTick` 之后才设 scrollIntoView —— 得等新节点真的在 DOM 里。
			 */
			scrollToDay(dateKey) {
				let rows = 0
				let hit = false
				for (const g of this.groups) {
					rows += g.records.length
					if (g.key === dateKey) {
						hit = true
						break
					}
				}
				// 那天没有流水（列表里根本没有这一组）：没有可滚的目标，指令也别留下 ——
				// 否则 rows 会一路加到全量，白白把整期都渲染出来
				if (!hit) return
				if (rows > this.shownRows) this.shownRows = rows
				this.$nextTick(() => { this.scrollIntoView = 'g-' + dateKey })
			},
			/** 用户自己一滚，就清掉「滚到某天」的指令（留着的话下次重渲染会被拽回去） */
			onListScroll() {
				if (this.scrollIntoView) this.scrollIntoView = ''
			},
			closePeriodPicker() {
				if (!this.showPeriodPicker || this.ppClosing) return
				this.ppClosing = true
				this.ppTimer = setTimeout(() => {
					this.showPeriodPicker = false
					this.ppClosing = false
				}, 200)
			},
			setMode(m) {
				if (this.mode === m) return
				this.mode = m
				this.load()
			},
			shiftPeriod(delta) {
				if (delta > 0 && !this.canForward) return // 已是最新一期：静默返回（按钮另有置灰）
				const p = (n) => String(n).padStart(2, '0')
				if (this.mode === 'year') {
					this.year += delta
				} else {
					const [y, m] = this.month.split('-').map(Number)
					const d = new Date(y, m - 1 + delta, 1) // Date 自动进位跨年
					this.month = `${d.getFullYear()}-${p(d.getMonth() + 1)}`
				}
				this.load()
			},
			/** 当前视图的起止日（'YYYY-MM-DD'）—— 账户收支那一项要按同一个期间算 */
			periodRange() {
				if (this.mode === 'year') return { start: `${this.year}-01-01`, end: `${this.year}-12-31` }
				const [y, m] = this.month.split('-').map(Number)
				const last = new Date(y, m, 0).getDate() // 下个月的第 0 天 = 本月最后一天（闰年 2 月自动对）
				return { start: `${this.month}-01`, end: `${this.month}-${String(last).padStart(2, '0')}` }
			},
			/**
			 * 本期这个账户的收支（这一期没记过账的账户 → 0 / 0）。
			 * 账户**筛选**弹层里显示的是它，不是 `a.balance` —— 余额是累计到今天的，
			 * 摆在满屏某一期的数据旁边就是个假数字。
			 */
			acctOf(id) {
				return this.acctTotals.find((x) => x.id === id) || { income: 0, expense: 0 }
			},
			async load() {
				const token = ++this.loadToken
				try {
					const period = this.periodRange()
					// 账户收支与主查询并发：它只服务筛选弹层，但**每次切期都要跟着换**，
					// 否则弹层里还留着上一期的数
					const [data, totals] = await Promise.all([
						this.mode === 'month' ?
							getMonthlyData(this.month, this.accountId) :
							getYearlyData(this.year, this.accountId),
						getAccountTotals(period)
					])
					if (token !== this.loadToken) return // 已切期，晚到响应丢弃
					this.acctTotals = totals.accounts
					// 明细行要不要带上「这笔属于哪个账户」：只在「全部账户」视图下带 ——
					// 筛了某个账户时，满行重复同一个名字是噪音（用户裁定）。
					// 账户名本身在 REC_SELECT 里已经取回（fa.name → fromName），这里只决定显不显示。
					const deco = { showAccount: this.accountId == null }
					const list = this.mode === 'month' ?
						data.days.map((d) => ({
							key: d.date,
							label: this.dayLabel(d.date),
							income: d.income,
							expense: d.expense,
							records: d.records.map((r) => decorateRecord(r, deco))
						})) :
						data.months.map((m) => ({
							key: m.month,
							label: this.monthLabel(m.month),
							income: m.income,
							expense: m.expense,
							records: m.records.map((r) => decorateRecord(r, deco))
						}))
					this.groups = list
					this.totalCount = list.reduce((n, g) => n + g.records.length, 0)
					// 懒加载进度：**只在换了期间或账户时归零**。onShow 的每次重查（从记一笔返回）
					// 指纹不变，于是保留用户已经滚出来的那些行 —— 否则滚到第 200 行回来，列表
					// 啪地缩回首屏 60 行，人还以为记录丢了。
					const key = `${this.mode}|${this.month}|${this.year}|${this.accountId}`
					if (key !== this.loadKey) {
						this.loadKey = key
						this.shownRows = LAZY_ROWS
						// 换了期间就回到列表顶部。scroll-view 只在值**变化**时响应，
						// 所以在 0 上再设一次 0 是没用的 —— 先抖半像素，人眼看不出来
						this.scrollTop = this.scrollTop === 0 ? 0.5 : 0
					}
					this.summary = {
						income: data.income,
						expense: data.expense
					}
					// 预付角标：它说的是「此刻还有几笔挂着」，与本页看的期间无关，所以不进上面那批
					// 并发查询。单独兜底 —— 它失败不该把整页数据一起拖红。
					try {
						this.pendingCount = await getPendingCount()
					} catch (e) {
						console.warn('[index] 预付角标读取失败', e)
					}
					this.loadError = false
				} catch (e) {
					console.error('[index] 数据加载失败', e)
					if (token !== this.loadToken) return // 已被取代的请求失败不该顶掉当前看板
					this.loadError = true
				}
			},
			async loadTagline() {
				try {
					// 「键不存在」= 从没设过 → 默认签名；「键存在但为空」= 用户显式清空 → 显示
					// 「没有签名」。getMeta 对这两种情况都返回 ''，所以要靠 hasMeta 区分 ——
					// 少了这一步，清空会被当成没设过、又变回默认签名（用户反馈的正是这个）。
					const v = await getMeta('tagline')
					this.tagline = (await hasMeta('tagline')) ? v : DEFAULT_TAGLINE
				} catch (e) {
					console.error('[index] 签名读取失败', e) // 非关键数据，失败保持默认
				}
			},
			// ---- 签名编辑（点击首页签名触发；存 meta 表，跨页共享事实源 = 数据库）----
			openTagEdit() {
				if (this.tagEditTimer) clearTimeout(this.tagEditTimer) // 退场中途重开：掐掉定时器
				this.tagEditClosing = false
				this.taglineInput = this.tagline // 预填当前值
				this.showTagEdit = true
			},
			closeTagEdit() {
				if (!this.showTagEdit || this.tagEditClosing) return
				this.tagEditClosing = true
				this.tagEditTimer = setTimeout(() => {
					this.showTagEdit = false
					this.tagEditClosing = false
				}, 200)
			},
			async saveTagline() {
				if (this.tagEditClosing) return // 退场动画期间的残影点击：忽略
				const v = this.taglineInput.trim()
				try {
					await setMeta('tagline', v) // 空串 = 没有签名（**不是**恢复默认，用户裁定）
					this.tagline = v
					this.closeTagEdit()
					uni.showToast({
						title: v ? '签名已保存' : '已清空签名',
						icon: 'success'
					})
				} catch (e) {
					console.error('[index] 签名保存失败', e)
					uni.showToast({
						title: '保存失败',
						icon: 'none'
					})
				}
			},
			// 行展示：主标题 = 备注 || 分类名（分类已删时兜底文案）；有备注时副行显示分类
			// 行展示：主标题 = 备注 || 分类名；有备注时副行显示分类名。
			// 分类已被删除（联查不到）时图标显示叉叉，而不是拿备注首字去凑一个色圆——
			// 旧写法传的是 mainTitle，会把备注的首字当成分类图标，看着像另一个分类
			// 行装饰已搬到 services/record.js 的纯函数 decorateRecord（三态规则放页面里
			// 就只能靠真机看；搬过去之后它成了唯一可脚本测的形态，见 transfer-repro 第 5 组）
			// ---- 左滑（touch；front 的 touch-action: pan-y 把纵向滚动交还系统）----
			/** 左右滑：往左滑 → 切到「我的」（在 tabBar 上它就在本页右边） */
			onTabSwipe(dir) {
				if (dir === -1) uni.switchTab({ url: '/pages/mine/mine' })
			},
			/**
			 * 点页面里**任何**地方都退出管理模式（用户裁定）。
			 *
			 * 挂在页面根上，而不是给每块内容各挂一个监听：模式是页面级的唯一状态（manageMode），
			 * 退出它的条件也只该有一处 —— 挂在各块内容上，迟早会有新加的区块忘记挂，
			 * 于是那一块就成了「点了不退」的黑洞。行自己 @click.stop（见 onRowTap），
			 * 所以「点行本身」也由它负责退。
			 */
			onPageClick() {
				if (this.manageMode) this.manageMode = false
			},
			/**
			 * 点一行：① 吞掉长按抬手派生出的那次 click（否则刚进管理模式就被自己退掉）；
			 * ② 管理模式里点行本身也退出 —— 与提示条上「点任意处退出」的说法一致。
			 */
			onRowTap() {
				const swallowed = this.pressFired
				this.pressFired = false
				if (swallowed) return
				if (this.manageMode) this.manageMode = false
			},
			// ---- 管理模式：按住一行不动进入（与分类管理页同一套做法）----
			/**
			 * 按住 LONG_PRESS_MS 不动 → 进管理模式：当页所有流水抖动、右上角出角标。
			 * 「不动」由位移判定（超过 MOVE_TOLERANCE 就取消）—— 否则滑列表会误触发。
			 * 与记一笔长按退格、tab 圆钮的按下态同一路数：手写计时而不用 @longpress
			 * （移动端 webview 的长按事件触发时机不稳）。
			 */
			onRowPressStart(e) {
				const t = e.touches && e.touches[0]
				if (!t) return
				this.pressStartX = t.clientX
				this.pressStartY = t.clientY
				this.pressMoved = false
				this.pressFired = false
				if (this.manageMode) return // 已经在管理模式里：不必再进一次
				if (this.pressTimer) clearTimeout(this.pressTimer)
				this.pressTimer = setTimeout(() => {
					this.pressTimer = null
					this.pressFired = true
					this.manageMode = true
					// 触觉反馈：模式变了但画面只是「右侧图标淡入」，先震一下（与分类页同法）
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
			// 编辑：右上角角标「编辑」→ 带 id 进记账页（编辑模式）；返回时 onShow 重查
			onEditTap(r) {
				this.manageMode = false // 要离开这一页了，模式跟着退掉
				uni.navigateTo({
					url: '/pages/record/edit?id=' + r.id
				})
			},
			// 删除：二次确认 → 删除后整页重查（小计/汇总自动一致）
			onDelete(rec) {
				// **不退管理模式**：连着删几笔是常见动作，退掉就得重新长按一次
				// 自绘确认框：点「取消」、点遮罩、按返回键都算取消（理由见 category.vue）
				this.$refs.confirmDlg.open({
					title: '确认删除',
					message: `「${rec.mainTitle}」删除后不可恢复，确定吗？`,
					confirmText: '删除',
					cancelText: '取消',
					danger: true,
					onConfirm: async () => {
						try {
							await deleteRecord(rec.id)
							uni.showToast({
								title: '已删除',
								icon: 'success'
							})
							this.load()
						} catch (e) {
							console.error('[index] 删除失败', e)
							uni.showToast({
								title: '删除失败',
								icon: 'none'
							})
						}
					}
				})
			},
			// dayLabel / monthLabel 已搬到 services/format.js —— 「分类明细」页要用同一套分组头文案。
			// 留在页面里各写一份，那个「月不补零、日补零」的形状迟早会走散。
		}
	}
</script>

<style lang="less">

	// 页面容器本身不许滚（能滚的只有下面那块 scroll-view）。App 端的页面 body 默认是
	// **可滚且带回弹**的 —— 光给 .page 写 overflow: hidden 管不到它那一层，内容哪怕只差
	// 几个像素，拖起来整页也会动。pages.json 那边另有 app-plus.bounce: none 收口。
	page {
		overflow: hidden;
	}

	.page {
		// 钉死在视口上：页头固定、只有列表滚。
		// ★ 用 fixed + 四边 0，**不要用 100vh** —— App 端 vh 与 webview 的真实可视高度不是一个
		//   东西（页面容器还会给原生 tabBar 留空间），差出来的那一截正好让整页能滚「一点点」，
		//   现象是「内容不多却拖得动、还停得住」。fixed 没有中间量可算错。
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		bottom: 0;
		box-sizing: border-box;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		background: var(--md-surface-container);
	}

	// 固定区（大标题 → 列表头）：不伸缩、不滚动，永远占着上面那一块
	.head-fixed {
		flex: none;
	}

	// 列表滚动区：把父容器剩下的高度全吃掉。
	// ★ 只写 flex: 1 + min-height: 0，**千万别**再补一句 height: 0（我加过，真机上翻了车）：
	//   uni-app 的 scroll-view 会渲染成 <uni-scroll-view><div height:100%>… 的包装，
	//   那个 100% 参照的是外层的**计算**高度 —— 外层一旦写成 height: 0，内层就解析成 0，
	//   于是 scrollHeight > clientHeight 恒成立：只有两条记录也照样能滚出一片空白。
	//   而 flex: 1 的 flex-basis 本来就是 0%，height: 0 纯属多余且有害。
	.list-body {
		flex: 1;
		min-height: 0;
	}

	// 滚动内容的包裹层：measureList() 靠它量「内容总高」（列表顶层是多个 .group，
	// 没有这一层就只能去猜最后一个节点是谁）。它自己不需要任何样式，
	// 写这条规则是为了让它在本页有定义 —— 静态 class 没定义的话跨页样式门会拦
	.list-inner {
		display: block;
	}

	.appbar {
		padding: 20rpx 40rpx 4rpx;

		.title-row {
			// 签名按钮的绝对定位包含块（见 .tagline-btn）
			position: relative;
			display: flex;
			align-items: baseline;
			gap: 20rpx;
		}

		.app-title {
			// 设计感全部来自**字重 / 字号 / 字距 / 颜色**四个维度，不依赖自定义字体。
			//
			// 曾经试过霞鹜文楷（子集到 3.8KB、base64 内联）：编译产物完全正确，但真机上
			// 一直是兜底字体。根因是**App 端 webview 的 @font-face 不接受 data URL**
			// （平台级约束，静默忽略、不报错）。真要用自定义字体，得把字体文件放
			// `static/` 并用 `@/static/...` 引用（根路径 `/static/...` 在 App 端也无效）。
			display: flex;
			align-items: baseline;
			// ★ 标题**永不参与收缩**：签名已改成绝对定位（见下），本就不占行内宽度；这一条是第二道
			// 保险 —— 标题被挤窄的直接表现就是按字折行（中文可以任意两字之间断行），而字一折，
			// 整块标题+签名区就跟着变高（用户反馈）。nowrap 再兜一层：即便被挤，也不折。
			flex-shrink: 0;
			white-space: nowrap;

			.t-brand {
				font-size: 66rpx;
				font-weight: 700;
				letter-spacing: 1rpx;
				color: var(--md-on-surface);
			}

			.t-kind {
				margin-left: 8rpx;
				font-size: 42rpx;
				font-weight: 400;
				letter-spacing: 6rpx;
				color: var(--md-on-surface-variant);
			}
		}

		.tagline-btn {
			// ★ 绝对定位：让它**彻底退出**标题行的宽度分配。此前它是行内 flex 项 + max-width，
			//   于是与标题争宽度 —— 签名一长就把标题压窄，中文随之按字折行，整块标题+签名区
			//   跟着变高（用户反馈）。绝对定位之后，标题行的高度**只由标题决定**：签名多长
			//   都挤不到标题，也撑不高这一行。
			//
			//   bottom: 0 把**底边钉死** —— 签名折成两行时向上长，底边与单行时一模一样
			//   （用户裁定「保证底部仍然是现在位置」）。
			position: absolute;
			right: 0;
			bottom: 0;
			max-width: 400rpx;
			// max-width 要含 padding，否则外宽会到 400+76=476rpx，窄屏上照样把行撑爆
			box-sizing: border-box;
			// 右侧给笔留位：20(右边距) + 26(笔) + 10(间隙)
			padding: 6rpx 56rpx 6rpx 20rpx;
			border-radius: 999rpx;

			.tagline {
				// 显式 block，不依赖父级是不是 flex：行盒高度只由自己算，
				// 下面那支笔的定位（钉在第一行中线）才是可预测的
				display: block;
				font-size: 26rpx;
				// 比标题轻一档：签名是陪衬，靠「更小 + 更细 + 次级色」退到标题后面
				font-weight: 300;
				color: var(--md-on-surface-variant);
				// 允许折行（原来是 nowrap + 省略号，永远只有一行）
				white-space: normal;
				word-break: break-all;
				line-height: 1.35;
			}

			// 没有签名：淡一档，读作占位而不是内容
			&.empty .tagline {
				color: var(--md-outline);
			}

			.tagline-pen {
				// ★ 笔也绝对定位，钉在**第一行**的中线上：这样它永远与「没有签名」四个字同处
				//   一行 —— 不管签名折成几行、不管父级是块还是 flex，都不存在「笔被挤到下一行」
				//   的可能（用户反馈的正是这个）。行内 flex 给不了这个保证：容器一变窄，
				//   flex 行就可能把图标甩到下一行。
				//   中线 = padding-top(6) + 行高(26 × 1.35 ≈ 35.1) / 2 ≈ 23.5rpx
				position: absolute;
				right: 20rpx;
				top: 23.5rpx;
				transform: translateY(-50%);
			}
		}

	}

	.month-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 20rpx 40rpx 24rpx;
	}

	.month-chip {
		display: flex;
		align-items: center;
		background: var(--md-surface);
		border-radius: 999rpx;
		padding: 8rpx 12rpx;

		.chev {
			width: 60rpx;
			height: 60rpx;
			border-radius: 50%;
			display: flex;
			align-items: center;
			justify-content: center;

			// 已是最新一期：置灰（与分类管理页的 ↑↓ 同一手法）
			&.off {
				opacity: 0.25;
			}
		}

		.period-label {
			min-width: 220rpx;
			text-align: center;
			font-size: 28rpx;
			font-weight: 600;
			color: var(--md-on-surface);
		}
	}

	.mode-seg {
		position: relative;
		display: flex;
		// 用填充底代替 1rpx 描边：真机上那条发丝线看着像脏边（用户反馈）
		background: var(--md-surface);
		border-radius: 999rpx;
		overflow: hidden;

		// 滑动指示块：宽度 = 一个按钮（各占一半），translateX 由模板按模式给
		.seg-thumb {
			position: absolute;
			top: 0;
			bottom: 0;
			left: 0;
			width: 50%;
			border-radius: 999rpx;
			// 实色主色：淡染色块（#cce3de）与填充底（#e4eae5）几乎同色，看不出选中（用户反馈）
			background: var(--md-primary);
			transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
		}

		.seg-btn {
			position: relative; // 压在滑动块之上
			z-index: 1;
			width: 80rpx;
			height: 64rpx;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 26rpx;
			font-weight: 500;
			color: var(--md-on-surface-variant);

			&.on {
				color: var(--md-on-primary);
				font-weight: 600;
			}
		}
	}

	.summary {
		margin: 0 32rpx 8rpx;
		background: var(--md-surface);
		border-radius: 56rpx;
		padding: 32rpx 44rpx 28rpx;

		.sum-row {
			display: flex;
			position: relative; // 给下面那条分隔线做定位上下文
			// 不写 align-items：默认 stretch，两格等高、标签必定在同一行。
			// 原来是 flex-end（底对齐）—— 某一格的金额换行时会把它的标签压低，两格就错开了。
		}

		// 分隔线：**绝对定位钉在整行 50%**。
		// 早先它是右格的 border-left，位置由两格的外宽决定 —— 于是 padding、box-sizing、
		// flex 的分配方式全都掺和进来，实测一直偏左（现算过是 padding 加在宽度之外造成的
		// 20.5rpx，但改 box-sizing 后真机仍偏）。改成独立元素之后，位置只由 left: 50% 决定，
		// 上面那些变量再也影响不到它。
		.sum-div {
			position: absolute;
			left: 50%;
			top: 0;
			bottom: 0;
			width: 1rpx;
			background: var(--md-outline-variant);
		}

		.stat {
			flex: 1;
			// ★ 分隔线落在正中间，靠的是这一条。本项目**没有全局 box-sizing 重置**
			// （默认是 content-box），于是 .stat+.stat 那 40rpx 的 padding-left 会**加在
			// 宽度之外**：右格外宽 = 左格 + 41rpx，分隔线被推到 W/2 − 20.5rpx，肉眼就是「偏左」。
			// 改成 border-box，padding 与 1rpx 的分隔线都算进那 50% 里。
			box-sizing: border-box;
			// 另一道保险：flex 项默认 min-width:auto，内容一旦宽过 flex-basis 就撑不回去。
			// （这个管的是「内容撑宽」，上面那条管的是「padding 撑宽」，两回事。）
			min-width: 0;

			.k {
				font-size: 25rpx;
				color: var(--md-on-surface-variant);
			}

			.v {
				display: block;
				margin-top: 4rpx;
				font-size: 42rpx;
				font-weight: 600;
				color: var(--md-on-surface);

				&.income {
					color: var(--md-income);
				}
			}
		}

		// 分隔线已改由 .sum-div 绝对定位画（见上），这里只留文字避让
		.stat+.stat {
			padding-left: 40rpx;
		}

		.sum-sub {
			margin-top: 24rpx;
			font-size: 25rpx;
			color: var(--md-on-surface-variant);

			.b {
				color: var(--md-primary-strong);
				font-weight: 600;
			}
		}
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

	// 账户筛选按钮（列表头上，取代原来的「左滑可编辑 / 删除」提示）
	.acct-btn {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 6rpx;
		max-width: 240rpx;
		padding: 8rpx 18rpx;
		border-radius: 999rpx;
		background: var(--md-surface);
		// 角标要挂在它的右上角
		position: relative;

		.acct-t {
			min-width: 0;
			font-size: 26rpx;
			color: var(--md-on-surface);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		// 待回收笔数：不占按钮自己的高度（绝对定位挂在右上角外沿），
		// 免得首页这一行的排版被一个圆点撑开
		.badge {
			position: absolute;
			top: -8rpx;
			right: -8rpx;
			min-width: 32rpx;
			height: 32rpx;
			padding: 0 8rpx;
			box-sizing: border-box;
			border-radius: 999rpx;
			background: var(--md-error);
			display: flex;
			align-items: center;
			justify-content: center;

			.badge-t {
				font-size: 20rpx;
				font-weight: 600;
				color: var(--md-on-primary);
			}
		}
	}

	.group-head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		padding: 16rpx 32rpx 12rpx; // 左右 32rpx 与下方 swipe 卡片对齐（原 16rpx 会凸出卡外）

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

	// 每行一张圆角卡片 + 行间距。
	// 2026-10-03 用户裁定：① 加圆角（早先定的是直角）；② 取消「左滑露出编辑/删除」，
	// 改成**长按不动进入管理模式**（右侧出现两枚线条操作图标：笔 / 垃圾桶）。
	// **首页不抖**，且**进编辑态行高不变**（用户裁定 2026-10-03）—— 两枚图标走绝对定位，不参与行高。
	.row {
		position: relative;
		margin: 0 32rpx 12rpx;
		border-radius: 28rpx;
		background: var(--md-surface);
		display: flex;
		align-items: center;
		gap: 28rpx;
		padding: 22rpx 28rpx;

		// 进编辑态时右侧内距 28 → 96rpx，金额因此往左让 —— 让这条动起来，金额就是「被挤过去」
		// 而不是瞬移（退出时反向滑回）。**只过渡 padding-right**：上下内距没有变化点，
		// 写成 padding 只会让别处改动也变得黏糊。0.22s ease-out 与项目其余过渡同一档。
		//
		// ★ 2026-10-09 撤过一次「按下反馈」：曾经给 .row 加过 `.pressing`（底色深一档 +
		//   scale(0.9)），用户反馈要去掉 —— 长按成立的信号回到只有「右侧图标淡入 + 一下震动」。
		//   所以这里**不要**再顺手把 background/transform 加回 transition：那是给按下态用的，
		//   没有那个状态就只会让别处的改动变黏。
		transition: padding-right 0.22s ease-out;

		// 管理态：给右侧两枚图标让出横向空间 —— 金额靠这条内距往左挤。
		// 96rpx = 图标盒 44rpx + 与金额的间隔 24rpx + 行本身的右内距 28rpx（改 .act 尺寸时这条要跟着算）。
		&.managing {
			padding-right: 96rpx;
		}

		// 右侧上下两枚线条图标。**绝对定位**（不在布局流里）—— 不管它们多大、两枚之间留多宽，
		// 行高都恒等于普通态（用户裁定：进编辑态列表高度不变）。代价就是上面那条写死的补偿内距。
		// 不带圆底：图形本身就是按钮，靠内边距撑出点按范围（内边距不画东西，视觉上仍是裸线）。
		// 编辑跟随主题色（换肤跟着变），删除是语义红。
		.acts {
			position: absolute;
			top: 0;
			bottom: 0; // 上下都贴满 → 子项整体垂直居中，不用 transform
			right: 28rpx; // 与行右内距对齐：图标右缘与金额右缘同一条竖线
			display: flex;
			flex-direction: column;
			// ★ 居中是**按现有子项**算的，这正是要的效果，别改成固定高度：
			//   两枚（编辑 + 删除）时一上一下；调整流水只有删除一枚（编辑按钮在模板里被
			//   v-if 拿掉了），它就落在行的正中央 —— 单独一枚按钮居中才顺手。
			//   曾经为了「和上下其他行的删除按钮对齐」把它钉死在下方，用户否掉了。
			justify-content: center;
			gap: 16rpx;
			z-index: 2;
			// 两枚一起淡入，0.18s —— 比金额的 0.22s 稍快，读起来是「图标先到、金额被推走」
			animation: actsIn 0.18s ease-out;

			// 退出：反向淡出。0.18s 与 JS 的 ACTS_OUT_MS 是同一个数（元素靠那个定时器摘掉）。
			// forwards 把最后一帧（全透明）留住，否则动画一结束元素会闪回不透明再被摘掉。
			// pointer-events 关掉：淡出的这 180ms 里不该还能点到删除。
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

			// 标题行：标题 + 「预付」标识并排（只有预付那类流水才有标识）。
			// 标识**不能**直接塞进 .txt —— 那是 column 容器，塞进去会另起一行
			.t-row {
				display: flex;
				align-items: center;
				gap: 10rpx;
			}

			// 「预付」标识：这一笔的金额照样走支出那套（红字、减号），
			// 这枚小胶囊只说明「它其实是垫出去的钱，等着收回来」
			.pre-tag {
				flex-shrink: 0;
				padding: 2rpx 12rpx;
				border-radius: 999rpx;
				font-size: 20rpx;
				color: var(--md-primary-strong);
				background: var(--md-primary-container);
			}

			// 「结清」标识：**线框胶囊、没有底色**（用户裁定）—— 与「预付」那枚实心的一对比，
			// 一眼分得清哪个是「还在外面挂着」、哪个是「已经收尾留下的」。
			// 文字与「预付」那枚同色（主色），两枚摆在一行才像一套
			.settled-tag {
				flex-shrink: 0;
				padding: 2rpx 12rpx;
				border-radius: 999rpx;
				border: 2rpx solid var(--md-outline-variant);
				font-size: 20rpx;
				color: var(--md-primary-strong);
			}

			.t {
				// flex 子项默认 min-width:auto，不写这句上面的 ellipsis 不生效（长标题会顶破行）
				min-width: 0;
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

			// 转账不是收支：金额不带正负号，也不用收入/支出的颜色。
			// 用次级色是把「它不算收支」这件事直接画出来（与汇总卡把它排除在外是同一条道理）。
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

		// 错误态的重试键（与 pages/record/detail.vue 的同名规则保持一致）
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

	.list-foot-pad {
		// 只垫出「固定 tabBar + 中央凸出圆钮」需要的高度，再多一点点呼吸。
		// 几何（见 app-tabbar.vue 的 .tb-center）：圆钮顶边距页面底 =
		//   34rpx(bottom) + 120rpx(高) = 154rpx，而 tabBar 顶边是 110rpx → 圆钮凸出 44rpx。
		// 所以 154 是**必须让开**的高度，剩下的 46rpx 让「没有更多了」与圆钮顶边之间
		// 留下约 50rpx 的空 —— 也就是「比记一笔那个圆钮高一点」（用户裁定）。
		// 原来写死 240rpx，多出整整 90rpx 的空白。
		// 安全区补进来：否则带 Home 条的机型上 tabBar 整体上移，这段留白会被吃掉。
		// ⚠ 必须与 pages/mine/mine.vue 的 .page 的 padding-bottom 保持一致（用户裁定两页一致）。
		//   这两个值原先各写各的（这边 240、那边 170），就是这么走散的 —— 两处都留了这句交叉引用。
		height: calc(200rpx + constant(safe-area-inset-bottom));
		height: calc(200rpx + env(safe-area-inset-bottom));
	}


	// 签名编辑卡片：提示语与字数计数同一行
	.sig-foot {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: 20rpx;
		margin-top: 16rpx;

		.af-hint {
			margin-top: 0; // 间距由外层给，免得和计数不在同一基线上
		}

		.sig-count {
			flex-shrink: 0;
			font-size: 23rpx;
			color: var(--md-outline);
		}
	}

	.sig-input {
		width: 100%;
		height: 84rpx;
		background: var(--md-surface-container);
		border-radius: 24rpx;
		// 右侧给「清空 ×」让位（.clr-btn 贴右 10rpx、命中区 44rpx）
		padding: 0 68rpx 0 28rpx;
		font-size: 28rpx;
		color: var(--md-on-surface);
		box-sizing: border-box;
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
			border-radius: 999rpx; // 胶囊：与「全部账户」同一形状（用户裁定），选中态因此也是一条胶囊

			&.on {
				background: var(--md-primary-container);
			}

			// 末尾那行「预付管理」：不是账户、不参与筛选，所以**不要**选中态那种胶囊感。
			// 上面一条分隔线把它和账户列表分开 —— 它是「去另一个页面」，不是一个可筛的项。
			&.pre-entry {
				margin-top: 14rpx;
				padding-top: 28rpx;
				border-top: 2rpx solid var(--md-outline-variant);
				border-radius: 20rpx;

				.pre-bal {
					color: var(--md-primary-strong);
					font-weight: 600;
				}
			}

			// 「全部账户」：无图标（用户裁定）。份量加在「更深的中性底 + 更大更粗的主色文字」上，
			// 与「被选中」的绿底区分开——它因此**永远**醒目，而选中态仍是绿底 + 对勾。
			// 做成**胶囊形**是关键：方形整块读起来像分区标题（标题不可点），而胶囊是
			// 本 App 里「按钮」的形状语言（保存键、重试键都是圆角实心），一眼就知道能点。
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

			// 名字行与「支 / 收」行上下两行。挤成一行时，长金额会把名字压没 ——
			// 而账户名才是用户在这一屏里真正要找的东西。
			//
			// ★ 2026-10-09：这一格改成**吃掉整行余宽**（原先它与 .ap-gap 各占一半，
			//   名字行的右端其实落在行的中点）。加余额之后余额要贴右边缘，才必须撑满；
			//   对勾本来就靠右，去掉 .ap-gap 之后位置一点没变。
			.ap-mid {
				flex: 1;
				min-width: 0;
				display: flex;
				flex-direction: column;
				gap: 6rpx;
			}

			// 名字那一行：左名字、右余额。用 baseline 对齐 —— 名字 28rpx、余额 26rpx，
			// 按中心对齐会让两者看着一高一低。
			.ap-top {
				display: flex;
				align-items: baseline;
				justify-content: space-between;
				gap: 16rpx;
			}

			.ap-name {
				min-width: 0;
				font-size: 28rpx;
				color: var(--md-on-surface);
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			// 账户余额（累计到**今天**，与下一行的「支 / 收」不是一个口径 —— 那是本期的）。
			// 因此它比名字小一档、走中性色，不做成第三个「数字」跟着收支排。
			// **不加粗**（用户裁定）：明细这一行里名字才是要找的东西，余额是补充信息 ——
			// 加粗会让它跟名字抢。
			// flex-shrink: 0：名字再长也不许把它挤没（它这一行就两个东西）。
			.ap-bal {
				flex-shrink: 0;
				font-size: 26rpx;
				color: var(--md-on-surface-variant);

				// 负数（信用卡欠着、账户透支）——与账户页同一个 `.neg` 语义
				&.neg {
					color: var(--md-error);
				}
			}

			// 「全部账户」那一行是**汇总**，余额留一档份量 —— 与它那行更大更粗的名字呼应。
			// 明细行不加粗、汇总行加粗，这个差别本身就是「这一行不是某个账户」的提示。
			&.all .ap-bal {
				font-weight: 500;
			}

			// 本期该账户的收支（**不是余额**）：支出走中性色、收入走收入色，
			// 与首页汇总卡、分类占比同一套语义色
			.ap-nums {
				display: flex;
				gap: 24rpx;
				font-size: 24rpx;
				color: var(--md-on-surface-variant);

				.inc {
					color: var(--md-income);
				}
			}

			// 勾**恒占位**（未选中的用 visibility 藏起来）—— 它是布局的一部分。
			// 用 v-if 的话，勾一出现就把左边挤窄，余额和「支 / 收」跟着往里缩，
			// 同一个列表里选中项与未选中项的排版就不一样了（用户反馈的原话：
			// 「当前选择项会有一个打勾，破坏了原有排版」）。
			// 与「记一笔」类型切换那处同一个做法（那边是为了文字不跳动）。
			.ap-check {
				flex-shrink: 0;

				&.off {
					visibility: hidden;
				}
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
