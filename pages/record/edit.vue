<template>
	<view class="page" :style="[{ paddingTop: statusBarHeight + 'px' }, themeVars]">
		<!-- 顶栏 -->
		<view class="ed-top">
			<view class="icon-btn" @click="goBack">
				<view :style="maskStyle('x', 44, 'var(--md-on-surface)')"></view>
			</view>
			<text class="title">{{ recordId == null ? '记一笔' : '编辑' }}</text>
		</view>

		<!-- 金额：元直输（用户裁定），显示恒两位小数；灰色小字「元」标单位。
		     转账态要输两个数（转账金额 / 手续费），所以这里变成两行 —— 见 .aline 的注释。
		     金额**不**配「清空 ×」（用户裁定）：清空改由**长按键盘上的退格键**完成，
		     见 bsDown —— 那也是计算器的通用手势，且不占着这一行最右边 -->
		<view class="amount-display" :class="{ dual: type === 3 }">
			<!-- 算式：只在用过 +/− 之后出现（用户裁定）。显示的是**实时结果**，
			     正在输入的那一笔在这里看得到 —— 计算器的老分工：上面写算式，大数是结果。
			     算式属于**当前焦点那一行**，所以小字跟着那一行走（转账态两行） -->
			<text v-if="calcExpr && !feeFocused" class="expr num">{{ calcExpr }}</text>
			<view v-if="type === 3" class="aline" :class="{ on: !feeFocused }" @click="focusFee(false)">
				<text class="alabel">转账金额</text>
				<text class="v num" :style="{ fontSize: amtPx(feeFocused ? 52 : 80) }">{{ amountDisplay }}</text><text
					class="u">元</text>
			</view>
			<view v-else class="aline">
				<text class="v num" :style="{ fontSize: amtPx(92) }">{{ amountDisplay }}</text><text class="u">元</text>
			</view>
			<text v-if="calcExpr && feeFocused" class="expr num">{{ calcExpr }}</text>
			<view v-if="type === 3" class="aline" :class="{ on: feeFocused }" @click="focusFee(true)">
				<text class="alabel">手续费</text>
				<text class="v num" :style="{ fontSize: amtPx(feeFocused ? 80 : 52) }">{{ feeDisplay }}</text><text class="u">元</text>
			</view>
		</view>

		<!-- 支出 / 收入 / 转账 -->
		<view class="seg-wrap">
			<view class="seg">
				<!-- 滑动指示块：三段各占三分之一，位置由 .pos-1/.pos-2/.pos-3 给 -->
				<view class="seg-thumb" :class="'pos-' + type"></view>
				<view class="seg-btn" :class="{ on: type === 1 }" @click="setType(1)">
					<!-- 勾图标恒占位（未选中 visibility 隐藏）：选中时文字不跳动，滑动动画才顺 -->
					<view class="seg-ic" :class="{ off: type !== 1 }" :style="maskStyle('check', 34, '#ffffff')"></view>
					<text>支出</text>
				</view>
				<view class="seg-btn" :class="{ on: type === 2 }" @click="setType(2)">
					<view class="seg-ic" :class="{ off: type !== 2 }" :style="maskStyle('check', 34, '#ffffff')"></view>
					<text>收入</text>
				</view>
				<view class="seg-btn" :class="{ on: type === 3 }" @click="setType(3)">
					<view class="seg-ic" :class="{ off: type !== 3 }" :style="maskStyle('check', 34, '#ffffff')"></view>
					<text>转账</text>
				</view>
			</view>
		</view>

		<!-- 分类区：点主分类，其子分类宫格在该行下方展开（行内展开），后续行被向下挤；
         内容放不下时整个分类区内部滚动，页面本身不滚动 -->
		<view v-if="type !== 3" class="cat-zone">
			<template v-for="(row, ri) in catRows" :key="'r' + ri">
				<view class="cat-row">
					<view v-for="c in row" :key="c.id" class="cat"
						:class="{ on: pickedParentId === c.id, 'has-subs': c.subs.length > 0 }" @click="toggleParent(c)">
						<!-- 这层包装原是为飞行幻影的落点加的（落点要落在图标本身，而不是整格）。
						     飞行动画取消后它已没有作用，**但保留**：动它只会改变「图标作为 .cat 的 flex 项」
						     这个结构，没有好处、只有风险 —— 真要清理，等哪次动这一行时顺手做 -->
						<view>
							<category-icon :icon="displayIcon(c)" :color="displayColor(c)" :name="displayName(c)"
								:size="88" />
						</view>
						<view class="cat-head">
							<text class="cat-name">{{ displayName(c) }}</text>
							<view v-if="c.subs.length" class="cat-arrow" :class="{ up: expandedId === c.id }"></view>
						</view>
					</view>
				</view>
				<!-- 展开面板：与网格左右同边距（同一容器内边距）；每个主分类必有「新增」入口 -->
				<view v-if="row.some((c) => c.id === expandedId)" class="sub-panel" :class="{ closing: panelClosing }"
					:style="{ '--tail-x': ((row.findIndex((c) => c.id === expandedId) + 0.5) * 25) + '%' }">
					<view class="sub-grid">
						<view v-for="s in expandedSubs" :key="s.id" class="sub-cell" :class="{ born: bornId === s.id }"
							@click="pickSub(s)">
							<view class="sub-ic" :class="{ on: isSubPicked(s) }">
								<category-icon :icon="s.icon" :color="s.color || expandedCat.color" :name="s.name"
									:size="64" />
							</view>
							<text class="sub-name">{{ s.name }}</text>
						</view>
						<view class="sub-cell add" @click="openAddForm">
							<view class="sub-ic add-ring">
								<view :style="maskStyle('plus', 32, 'var(--md-primary-strong)')"></view>
							</view>
							<text class="sub-name">新增</text>
						</view>
					</view>
				</view>
			</template>
		</view>

		<!-- 转入账户（转账态）：分类宫格**原位**换成账户宫格 —— 用户已经学会「在宫格里点一格」，
		     4 列、选中态、格子尺寸统统沿用分类宫格那一套。数据源是 this.accounts
		     （onShow 里 loadAccounts 已经拉好，不需要新增加载） -->
		<view v-else class="cat-zone">
			<view class="zone-t">转入账户</view>
			<!-- 每 4 个一行 —— 与分类宫格**同一条规矩**：`.cat-row` 不换行、`.cat` 是 flex:1，
			     所以一行塞几个必须由数据切片决定，不能靠自动换行（塞 5 个就都挤成 1/5 宽） -->
			<view v-for="(row, ri) in acctRows" :key="'a' + ri" class="cat-row">
				<view v-for="a in row" :key="a.id" class="cat" :class="{ on: a.id === toAccountId }"
					@click="pickToAccount(a)">
					<view>
						<category-icon :icon="a.icon" :color="a.color" :name="a.name" :size="88" />
					</view>
					<view class="cat-head">
						<text class="cat-name">{{ a.name }}</text>
					</view>
				</view>
			</view>
		</view>

		<!-- 备注 + 日期 -->
		<view class="meta-row">
			<view class="field">
				<view :style="maskStyle('note', 36, 'var(--md-on-surface-variant)')"></view>
				<view class="clr-wrap">
					<!-- cursor-spacing 必须有：App 端键盘默认是 adjustPan（只保证输入框可见，
					     不保证它**下面**的内容可见），给光标留出 400rpx 才让这一行与日期/时刻那行
					     都露在键盘上方。子分类那个输入框一直有，这个漏了 —— 真机反馈「挡住下方」 -->
					<input class="note-input" v-model="note" placeholder="备注（选填）" maxlength="50"
						placeholder-class="note-ph" :cursor-spacing="kbSpacing" />
					<view v-if="note" class="clr-btn" @click="note = ''">
						<view :style="maskStyle('x', 26, 'var(--md-on-surface-variant)')"></view>
					</view>
				</view>
			</view>
		</view>

		<!-- 「日期」「时刻」拆成两个胶囊（用户裁定）：各点各的，把对应那一组滚轮调进下面那张卡片。
		     与备注挤在同一行会把备注压得太窄，所以单独一行、两半平分 -->
		<view class="dt-row">
			<view class="field dt" @click="openPicker('date')">
				<view :style="maskStyle('cal', 30, 'var(--md-primary-strong)')"></view>
				<text class="dt-k">日期</text>
				<text class="dt-v num">{{ dateText }}</text>
			</view>
			<view class="field dt" @click="openPicker('time')">
				<view :style="maskStyle('clock', 30, 'var(--md-primary-strong)')"></view>
				<text class="dt-k">时刻</text>
				<text class="dt-v num">{{ timeText }}</text>
			</view>
		</view>

		<!-- 自绘键盘：左 3 列 flex-wrap（末行 . 0 退格），右侧保存键纵贯 4 行 -->
		<view class="keypad">
			<view class="keys">
				<!-- 0-9 与小数点：同一套键位由 v-for 渲染（见 KEYPAD_KEYS） -->
				<view v-for="k in KEYPAD_KEYS" :key="k" class="key num af-press"
					:class="{ pressing: isPressed(k) }" @touchstart="pressOn(k)" @touchend="pressOff"
					@touchcancel="pressOff" @click="tapKey(k)">{{ k }}</view>
				<!-- 长按 = 清空金额（用户裁定）。自己用 touchstart/touchend 计时，不用 @longpress ——
				     移动端 webview 的长按事件触发时机不稳（tab 中央圆钮的按下态也是因此手写的） -->
				<view class="key af-press" :class="{ pressing: isPressed('bs') }" @touchstart="bsDown" @touchend="bsUp"
					@touchcancel="bsUp" @click="tapBackspace">
					<view :style="maskStyle('backspace', 46, 'var(--md-on-surface-variant)')"></view>
				</view>
			</view>
			<view class="right-col">
				<!-- 账户：右列顶部一格（与一行数字键等高，约 1/4 右列），点击弹底部卡片选 -->
				<view class="key-acct" :class="{ dual: type === 3 }" @click="openAcctPicker">
					<!-- 转账态这个键是**转出**方（转入方在宫格里），所以要把它标出来 -->
					<text v-if="type === 3" class="key-acct-k">转出</text>
					<view class="key-acct-row">
						<text class="key-acct-t">{{ acctName }}</text>
						<view :style="maskStyle('chevUp', 24, 'var(--md-on-surface-variant)')"></view>
					</view>
				</view>
				<!-- 加减：**同一行两个小键**（用户裁定），保存仍占下面 2 行 ——
				     右列 4 行 = 账户 1 + 加减 1 + 保存 2。点一下就把当前这一笔折进累计、
				     挂上符号，金额栏从下一笔起实时算 -->
				<view class="key-ops">
					<view class="key-op af-press" :class="{ pressing: isPressed('opAdd') }" @touchstart="pressOn('opAdd')"
						@touchend="pressOff" @touchcancel="pressOff" @click="tapOp('+')"><text>+</text></view>
					<view class="key-op af-press" :class="{ pressing: isPressed('opSub') }" @touchstart="pressOn('opSub')"
						@touchend="pressOff" @touchcancel="pressOff" @click="tapOp('-')"><text>-</text></view>
				</view>
				<view class="key-save af-press" :class="{ pressing: isPressed('keySave') }" @touchstart="pressOn('keySave')"
					@touchend="pressOff" @touchcancel="pressOff" @click="save"><text>保存</text></view>
			</view>
		</view>

		<!-- 选择日期：自绘 picker-view 底部卡片——系统 <picker> 弹层是独立 webview，页面样式够不着，
         上轮的运行时类覆盖真机未命中，弃之改自绘（与 tabBar/键盘同一先例） -->
		<view v-if="showPicker" class="af-scrim" :class="{ closing: pvClosing }" @click="closePicker">
			<view class="af-blocker"></view>
			<view class="af-card" :class="{ closing: pvClosing }" @click.stop>
				<view class="af-grab"></view>
				<text class="af-title">{{ pvMode === 'time' ? '选择时刻' : '选择日期' }}</text>
				<!-- 选中行由 .pv-capsule 自己画（uni 的指示条按列各画一条，两列就会断开）；
				     indicator-style 只留高度，保证滚轮的选中槽与胶囊对齐 -->
				<view class="pv-wrap">
					<view class="pv-capsule"></view>
					<picker-view v-if="pvMode === 'date'" class="pv-view pv-h" :value="pvIndex"
						indicator-style="height: 88rpx;" @change="onPvChange">
						<picker-view-column>
							<view v-for="y in pvYears" :key="y" class="pv-item">{{ y }}年</view>
						</picker-view-column>
						<picker-view-column>
							<view v-for="m in pvMonths" :key="m" class="pv-item">{{ m }}月</view>
						</picker-view-column>
						<picker-view-column>
							<view v-for="d in pvDays" :key="d" class="pv-item">{{ d }}日</view>
						</picker-view-column>
					</picker-view>
					<!-- 时刻滚轮：时/分两列，下标即值（0~23 / 0~59），所以 timeIndexes 的结果能直接喂给 :value -->
					<picker-view v-else class="pv-view pv-h" :value="pvTimeIndex"
						indicator-style="height: 88rpx;" @change="onPvTimeChange">
						<picker-view-column>
							<view v-for="h in pvHours" :key="h" class="pv-item">{{ h }}时</view>
						</picker-view-column>
						<picker-view-column>
							<view v-for="m in pvMinutes" :key="m" class="pv-item">{{ m }}分</view>
						</picker-view-column>
					</picker-view>
				</view>
				<view class="af-btns">
					<view class="af-cancel af-press" :class="{ pressing: isPressed('cancel') }" @touchstart="pressOn('cancel')"
						@touchend="pressOff" @touchcancel="pressOff" @click="closePicker"><text>取消</text></view>
					<view class="af-done af-press" :class="{ pressing: isPressed('ok') }" @touchstart="pressOn('ok')"
						@touchend="pressOff" @touchcancel="pressOff" @click="confirmPicker"><text>确定</text></view>
				</view>
			</view>
		</view>

		<!-- 新增子分类：底部向上弹出卡片（图标 + 名称 + 颜色） -->
		<view v-if="showAddForm" class="af-scrim" :class="{ closing: afClosing }" @click="closeAdd">
			<view class="af-blocker"></view>
			<view class="af-card" :class="{ closing: afClosing }" @click.stop>
				<view class="af-grab"></view>
				<text class="af-title">新增子分类</text>
				<view class="af-icons">
					<view v-for="k in iconKeys" :key="k" class="af-ic" @click="pickIcon(k)">
						<!-- 选中态（主题色圆底 + 弹一下变大）的画法记在 App.vue 的 .af-ring 上 -->
						<view class="af-ring" :class="{ on: afIcon === k }">
							<category-icon :icon="'svg:' + k" :color="afCardColor" :size="56" />
						</view>
					</view>
				</view>
				<view class="af-row">
					<view class="af-preview">
						<category-icon :icon="afIcon ? 'svg:' + afIcon : ''" :color="afCardColor" :name="afName || '子'"
							:size="80" />
					</view>
					<view class="clr-wrap">
						<input class="af-name" v-model="afName" placeholder="子分类名称，如「早餐」" :maxlength="nameMax" :cursor-spacing="kbSpacing"
							placeholder-class="af-ph" />
						<view v-if="afName" class="clr-btn" @click="afName = ''">
							<view :style="maskStyle('x', 26, 'var(--md-on-surface-variant)')"></view>
						</view>
					</view>
				</view>
				<view class="af-colors">
					<view v-for="c in afColors" :key="c" class="af-color" :class="{ on: afSwatchOn(c) }"
						:style="{ backgroundColor: c }" @click="afColor = afColor === c ? '' : c"></view>
				</view>
				<view class="af-hint-wrap">
					<text class="af-hint">不选图标则用名称首字，再点一次取消选中；不选颜色则跟随主分类</text>
					<text v-if="afName" class="af-count"
						:class="{ full: nameCount >= nameMax }">{{ nameCount }}/{{ nameMax }}</text>
				</view>
				<view class="af-btns">
					<view class="af-cancel af-press" :class="{ pressing: isPressed('addCancel') }" @touchstart="pressOn('addCancel')"
						@touchend="pressOff" @touchcancel="pressOff" @click="closeAdd"><text>取消</text></view>
					<view class="af-done af-press" :class="{ pressing: isPressed('addOk') }" @touchstart="pressOn('addOk')"
						@touchend="pressOff" @touchcancel="pressOff" @click="confirmAdd"><text>确定</text></view>
				</view>
			</view>
		</view>

		<!-- 选择账户：底部卡片（记账必须落到某一个账户，所以没有「全部」这一项） -->
		<view v-if="showAcctPicker" class="af-scrim" :class="{ closing: apClosing }" @click="closeAcctPicker">
			<view class="af-blocker"></view>
			<view class="af-card" :class="{ closing: apClosing }" @click.stop>
				<view class="af-grab"></view>
				<text class="af-title">选择账户</text>
				<view class="ap-list">
					<!-- 空态也要说人话：此前列表为空时整张卡片看着像「空白页」 -->
					<view v-if="!accounts.length" class="ap-empty">
						<text class="ap-empty-t">账户还没加载出来，稍等或返回重进本页</text>
					</view>
					<view v-for="a in accounts" :key="a.id" class="ap-item" :class="{ on: a.id === accountId }"
						@click="pickAccount(a)">
						<category-icon :icon="a.icon" :color="a.color" :name="a.name" :size="56" />
						<text class="ap-name">{{ a.name }}</text>
						<text class="ap-bal num">{{ fmtYuan(a.balance) }} 元</text>
						<view v-if="a.id === accountId" class="ap-check" :style="maskStyle('check', 32, 'var(--md-primary-strong)')"></view>
					</view>
				</view>
				<view class="af-btns">
					<view class="af-cancel af-press" :class="{ pressing: isPressed('acctClose') }" @touchstart="pressOn('acctClose')"
						@touchend="pressOff" @touchcancel="pressOff" @click="closeAcctPicker"><text>关闭</text></view>
				</view>
			</view>
		</view>
	</view>
</template>

<script>
	import {
		getCategoriesGrouped,
		createCategory,
		CATEGORY_NAME_MAX
	} from '@/services/category.js'
	import {
		addRecord,
		getRecord,
		saveTransfer,
		updateRecord,
		MAX_AMOUNT_CENTS
	} from '@/services/record.js'
	import {
		listAccounts
	} from '@/services/account.js'
	import {
		getMeta,
		setMeta
	} from '@/services/meta.js'
	import {
		maskStyle,
		CATEGORY_ICON_KEYS
	} from '@/services/icons.js'
	import { PALETTE_COLORS, paletteColor as pal } from '@/services/palette.js'
	import {
		fmtYuan,
		yuanToCents,
		fitAmountScale,
		sumTerms,
		pushTerm,
		hhmmNow,
		timeIndexes,
		timeFromIndexes
	} from '@/services/format.js'
	import pressFx from '@/services/press.js'

	// 金额那一行留给数字的宽度（rpx）：整宽 750 − 两侧留白 − 标签与「元」。
	// 这几个数是照着 `.amount-display` 的 Less 量出来的（转账行 padding 48×2、
	// 标签 26rpx/字（转账金额 4 字 / 手续费 3 字）、间距 16×2、「元」26+8），
	// 都留了余量 —— 估宽宁可保守：估大了会把「转账金额」挤成两行（真机反馈过）。
	// ★ 改那套 Less 的尺寸时要跟着改这里。
	const AMT_BOX = { single: 690, transfer: 460, fee: 490 }
	// 字号再挤也不缩过五成（下限，保证还看得清）
	const AMT_MIN_SCALE = 0.5

	// 数字键盘的键位（按屏幕上的显示顺序）。原来是 11 份几乎相同的 <view> ——
	// 加按下反馈要靠 key 区分每一个键，顺手收成一个 v-for：改一处，11 个键一起改。
	const KEYPAD_KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0']

	export default {
		mixins: [pressFx],
		data() {
			return {
				KEYPAD_KEYS, // 模板用（v-for 渲染数字键）
				statusBarHeight: 0,
				cats: {
					expense: [],
					income: []
				},
				type: 1, // 1=支出 2=收入
				amountInput: '0', // 元直输（用户裁定）：字符串即「元」，显示层恒两位小数
				toAccountId: null, // 转账的**转入**方。accountId 是转出方，两者不能混用（会互相顶掉）
				feeInput: '0', // 手续费（元直输，与 amountInput 同一套语义）
				feeFocused: false, // 键盘当前作用于哪一行：false = 转账金额，true = 手续费

				// 金额加减（用户裁定：+ / − 键，金额栏实时算、算式小字在金额上方）。
				// calcTerms = 算式片段，数与符号交替（如 ['8', '+']），存的是**用户敲的原串**
				// （算式照原样显示，连敲到一半的「0.」也不改写）；正在输入的那一笔不在里面 —— 它就是
				// amountInput。最后一片是符号时说明算式在跑（见 calcOp）。
				// ★ 算式属于**当前焦点那一行**：换成手续费去输，或换类型（支出/收入/转账），
				//   都先把算式结算成结果落回那一格再清空（用户裁定），所以无需记「哪一行」。
				// 累计不另存字段：由 format.js 的 sumTerms 从片段现算 —— 唯一真源，退格才退得干净
				calcTerms: [],

				note: '',
				date: '', // 'YYYY-MM-DD'
				time: '', // 'HH:MM'（24 小时制）；空串 = 没有时刻（老流水）
				pvMode: 'date', // 卡片里那组滚轮在滚什么：'date' = 年/月/日，'time' = 时/分
				pvHours: [], // 时列（0~23；下标即值，所以直接喂给 picker-view 的 :value）
				pvMinutes: [], // 分列（0~59）
				pvTimeIndex: [0, 0], // 时刻滚轮停在哪；每次打开时刻滚轮都按 this.time 现算
				pickedParentId: null, // 已选主分类
				pickedSub: null, // 已选子分类；null = 用主分类本身
				expandedId: null, // 行内展开子分类面板的主分类 id
				showAddForm: false,
				afClosing: false, // 新增子分类卡片正在播放退场动画（showAddForm 撑到播完才清）
				afTimer: null,
				afIcon: '', // 新增子分类所选图标（CATEGORY_ICON_KEYS 的 key；空 = 不选，用名称首字）；存库时补 svg: 前缀
				afName: '',
				afColor: '', // 空串 = 跟随主分类色
				bornId: null, // 新增成功后播放弹入动画的子分类 id
				showPicker: false,
				pvClosing: false, // 日期卡片退场标志（同 afClosing）
				pvTimer: null,
				pvYears: [], // 自绘日期滚轮数据（纯数字，模板里补 年/月/日 后缀）
				pvMonths: [],
				pvDays: [],
				pvIndex: [0, 0, 0],
				recordId: null, // 非空 = 编辑模式（路由参数 id）；新增模式为 null
				// M6 账户
				accounts: [],
				accountId: null, // 必选；新增时默认取 meta.lastAccountId，没有则第一个账户
				acctToken: 0,
				showAcctPicker: false,
				apClosing: false, // 账户卡片退场标志（与 pvClosing 同机制）
				apTimer: null,
				panelClosing: false, // 子分类面板正在播放收回动画（expandedId 撑到动画结束才清空）
				panelTimer: null, // 收回动画的定时器句柄（非响应式用途，放 data 仅为声明）
				saving: false,
				loadToken: 0,
				// 退格键的长按检测（长按 = 清空金额）。计时器必须在松手时清掉，
				// 否则一次短按也会在 350ms 后触发清空 —— 那等于把「删一位」变成「全清」。
				bsTimer: null,
				bsLong: false // 这一次按压已判成长按：用来吞掉随之补发的那次 click
			}
		},
		computed: {
			catList() {
				return this.type === 1 ? this.cats.expense : this.cats.income
			},
			// 子分类名上限来自服务层（同一个数只留一个源）；模板要读它
			nameMax() {
				return CATEGORY_NAME_MAX
			},
			// 实时字数，口径同输入框 maxlength（见 account.vue 同一处的说明）
			nameCount() {
				return this.afName.length
			},
			// 主分类每行切 4 个：展开面板以「行」为单位插到对应行下方，把后续行挤下去
			catRows() {
				const rows = []
				for (let i = 0; i < this.catList.length; i += 4) rows.push(this.catList.slice(i, i + 4))
				return rows
			},
			/** 转入账户宫格：与 catRows 同一条规矩，每 4 个一行（`.cat` 是 flex:1，不换行） */
			acctRows() {
				const rows = []
				for (let i = 0; i < this.accounts.length; i += 4) rows.push(this.accounts.slice(i, i + 4))
				return rows
			},
			expandedCat() {
				return this.catList.find((c) => c.id === this.expandedId) || null
			},
			expandedSubs() {
				return this.expandedCat ? this.expandedCat.subs : []
			},
			// 元直输（用户裁定：输入 125 就是 125 元），显示层恒两位小数。
			// 手写字符串拼接：真机 webview 忽略 toLocaleString 的位数选项（上版 "0" 不显示成
			// "0.00"），与 index 页 fmtYuan 同根因同修法，不再依赖 Intl
			// ★ calcCentsNow 是 computed（值），写成 this.calcCentsNow() 会让 render 直接抛错、
			//   整页数字都不出来 —— check-pages 的「computed 被当函数调用」现在也查脚本里这一半
			amountDisplay() {
				return fmtYuan(this.lineCents(false))
			},
			// 手续费显示：与 amountDisplay 同一套手写格式化（恒两位小数、千分位）
			feeDisplay() {
				return fmtYuan(this.lineCents(true))
			},
			/**
			 * 金额字号的缩放系数（≤1）：太长就整体缩，删几位、放得下了就恢复（用户裁定）。
			 * **两行共用同一个系数** —— 只缩正在输入的那一行，两行会不成比例（用户要的是「相应变小」）。
			 * 取更吃紧的那一行：都按各自**被聚焦时**的基准字号算，所以切焦点时系数不变、
			 * 只有 80/52 那档在换 —— 切来切去不会突然跳字号。
			 */
			amtScale() {
				const base = this.type === 3 ? 80 : 92
				const box = this.type === 3 ? AMT_BOX.transfer : AMT_BOX.single
				let k = fitAmountScale(this.amountDisplay.length, base, box, AMT_MIN_SCALE)
				if (this.type === 3) {
					k = Math.min(k, fitAmountScale(this.feeDisplay.length, 80, AMT_BOX.fee, AMT_MIN_SCALE))
				}
				return k
			},
			/** 算式在跑吗（片段最后一片是符号） */
			calcOp() {
				return this.calcTerms.length ? this.calcTerms[this.calcTerms.length - 1] : ''
			},
			/** 算式的实时结果（分）；**没在算时是 null** —— 用 null 区分「结果就是 0」和「没在算」 */
			calcCentsNow() {
				if (!this.calcOp) return null
				const cur = this.curInput()
				// 折算式这一步抽在 format.js（sumTerms）—— 页内逻辑脚本盖不住，
				// 上一轮就是这一片没被盖住才把 bug 送到真机
				return sumTerms(cur ? this.calcTerms.concat([cur]) : this.calcTerms)
			},
			/**
			 * 金额上方那行小字：算式（用户裁定：只在用过 +/− 之后出现）。
			 * 数与符号都**照用户敲的原样**写（用户裁定：敲「0.」时那个小数点也要显示出来）——
			 * 算式是「我刚敲了什么」的账本，补零、抹点都会让人对不上自己输的数。
			 */
			calcExpr() {
				if (!this.calcOp) return ''
				const parts = this.calcTerms.slice()
				if (this.curInput()) parts.push(this.curInput())
				return parts.join(' ')
			},
			// 分类图标可选清单（用户裁定 8×3=24，工具图标不进选择器）
			iconKeys() {
				return CATEGORY_ICON_KEYS
			},
			afColors() {
				return PALETTE_COLORS
			},
			// 卡片内图标/预览用色：选了颜色用颜色，否则跟随主分类
			afCardColor() {
				return this.afColor || (this.expandedCat ? this.expandedCat.color : '')
			},
			// 账户行显示名：账户还没加载出来时给占位文案
			acctName() {
				const a = this.accounts.find((x) => x.id === this.accountId)
				return a ? a.name : '选择账户'
			},
			dateText() {
				if (!this.date) return ''
				let text
				if (this.date === this.todayStr()) text = '今天'
				else {
					const [y, m, d] = this.date.split('-')
					const md = `${Number(m)}月${Number(d)}日`
					// 往年要带年份：日期滚轮的年份列有 11 年，只显示「12月25日」看不出是去年
					text = Number(y) === new Date().getFullYear() ? md : `${y}年${md}`
				}
				return text
			},
			/** 那一行右边那颗：'14:08'；没有时刻的老流水显示「未填」
			 *  —— 空串得有个说法，不然那颗胶囊就是空的 */
			timeText() {
				return this.time || '未填'
			}
		},
		async onLoad(options) {
			this.statusBarHeight = (uni.getSystemInfoSync().statusBarHeight) || 0
			this.date = this.todayStr()
			// 默认是「记账时刻」（用户裁定）：新增一笔时把当前时分带上，用户不用每次去点
			this.time = hhmmNow()
			const id = Number(options && options.id)
			if (Number.isInteger(id) && id > 0) {
				this.recordId = id
				await this.loadRecord(id)
			}
		},
		onShow() {
			this.loadCategories() // M2 语义：每次显示刷新分类（新增后返回也能看到）
			this.loadAccounts() // M6：账户可能刚在账户页被改名/删除
		},
		methods: {
			// ---- 色板高亮（放在 methods：模板里是当函数调用的；放进 computed 会报
			//      「$options.afSwatchOn is not a function」——这一条已被 check-pages 拦）----
			/**
			 * 色板上该高亮哪一格 = 这个分类**实际会渲成什么颜色**。
			 *
			 * 关键：「留空」不是「没有颜色」，而是「跟随主分类」；主分类也没色时渲染用兜底灰。
			 * 所以留空时色板必须跟着亮某格 —— 否则用户点开「新增子分类」，看到的是**一格都不亮**，
			 * 会以为没给它颜色（用户反馈）。图标那栏没这个问题：它按名称首字渲染，本来就是「没选」。
			 */
			afSwatchOn(c) {
				return (this.afCardColor || pal('graphite')) === c
			},
			maskStyle,
			// 账户选择卡片里显示余额用。**import 了还必须挂到 methods**：
			// 模板里 `_ctx.fmtYuan` 取的是实例成员，只 import 会在渲染时抛
			// `_ctx.fmtYuan is not a function`，整页白屏（真机踩过）
			fmtYuan,
			/** 编辑模式回填：分类树必须先到位，才能把 categoryId 反查成 父/子 选中态 */
			async loadRecord(id) {
				try {
					const r = await getRecord(id)
					if (!r) {
						uni.showToast({ title: '流水不存在', icon: 'none' })
						setTimeout(() => uni.navigateBack(), 800)
						return
					}
					this.type = r.type
					this.accountId = r.accountId // 账户早于分类回填设好：loadAccounts 只在「没选中」时才动它
					this.toAccountId = r.toAccountId
					this.feeInput = r.feeAmount ? this.centsToInput(r.feeAmount) : '0'
					this.feeFocused = false
					this.amountInput = this.centsToInput(r.amount)
					this.note = r.note
					this.date = r.date
					this.time = r.time || ''
					await this.loadCategories()
					this.pickByCategoryId(r.categoryId)
				} catch (e) {
					console.error('[edit] 流水回填失败', e)
					uni.showToast({ title: '回填失败', icon: 'none' })
				}
			},
			/** 分 → 元直输字符串：12550 → '125.5'。去掉尾随 0，否则一次退格删不掉一位小数 */
			centsToInput(cents) {
				return String(Number((cents / 100).toFixed(2)))
			},
			/** categoryId 反查选中态；分类已被删除时两者都留空，保存会被「请选择分类」拦住 */
			pickByCategoryId(categoryId) {
				if (categoryId == null) return
				for (const c of this.catList) {
					if (c.id === categoryId) {
						this.pickedParentId = c.id
						this.pickedSub = null
						return
					}
					const sub = c.subs.find((x) => x.id === categoryId)
					if (sub) {
						this.pickedParentId = c.id
						this.pickedSub = sub
						return
					}
				}
			},
			todayStr() {
				const d = new Date()
				const p = (n) => String(n).padStart(2, '0')
				return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
			},
			async loadCategories() {
				const token = ++this.loadToken
				try {
					const data = await getCategoriesGrouped()
					if (token !== this.loadToken) return
					this.cats = data
					// 刷新后展开项可能已被删除：失联即收起（硬收，不走收回动画）
					if (this.expandedId != null && !this.catList.some((c) => c.id === this.expandedId)) {
						if (this.panelTimer) clearTimeout(this.panelTimer)
						this.panelClosing = false
						this.expandedId = null
					}
				} catch (e) {
					console.error('[edit] 分类加载失败', e)
					uni.showToast({
						title: '分类加载失败',
						icon: 'none'
					})
				}
			},
			/**
			 * 账户列表 + 默认选中。默认值只在「当前没选中 / 选中的账户已不存在」时才动，
			 * 免得 onShow 刷新把用户已经选好的账户顶掉。
			 */
			async loadAccounts() {
				const token = ++this.acctToken
				try {
					const list = await listAccounts()
					if (token !== this.acctToken) return
					this.accounts = list
					if (this.accountId != null && list.some((a) => a.id === this.accountId)) return
					const last = Number(await getMeta('lastAccountId')) || 0
					// await 之后必须复查（收尾审查钉的竞态）：本页 onLoad 的 loadRecord 与我们并发跑，
					// 它可能刚刚把「这一笔的账户」填好；只在那一刻判一次守卫会把用户/流水已定的账户顶掉
					if (token !== this.acctToken) return
					if (this.accountId != null && list.some((a) => a.id === this.accountId)) return
					const pick = list.find((a) => a.id === last) || list[0]
					this.accountId = pick ? pick.id : null
				} catch (e) {
					console.error('[edit] 账户加载失败', e)
					uni.showToast({
						title: '账户加载失败',
						icon: 'none'
					})
				}
			},
			// ---- 选择账户（底部卡片，与日期卡片同机制）----
			openAcctPicker() {
				if (this.apTimer) clearTimeout(this.apTimer) // 退场中途重开：掐掉定时器
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
			pickAccount(a) {
				this.accountId = a.id
				this.closeAcctPicker()
			},
			// ---- 网格展示：选中了子分类时，该分类格显示子分类的样子 ----
			pickedFor(c) {
				return this.pickedParentId === c.id ? this.pickedSub : undefined
			},
			displayIcon(c) {
				const s = this.pickedFor(c)
				return s ? s.icon : c.icon
			},
			displayColor(c) {
				const s = this.pickedFor(c)
				return (s && s.color) || c.color
			},
			displayName(c) {
				const s = this.pickedFor(c)
				return s ? s.name : c.name
			},
			// 切换收支：两组分类不同，已选与展开内容作废（硬收，不走收回动画）
			setType(t) {
				if (this.type === t) return
				// 换类型也先把算式结算掉（用户裁定）：支出算到一半切收入，结果要落在金额上，
				// 否则算式跨着类型跑，金额栏显示的数与存进去的对不上
				this.commitCalc()
				const wasTransfer = this.type === 3
				this.type = t
				this.pickedParentId = null
				this.pickedSub = null
				this.feeFocused = false
				// 跨态残留必须清掉：转账切回收支要清转入方，收支切到转账要清分类与手续费。
				// 不清的话，编辑一条老记录再切模式会存下「既转账又有分类」的行 ——
				// 那正是服务层不变量禁止的状态，保存时会被拒、而用户不知道为什么。
				if (wasTransfer) this.toAccountId = null
				if (t !== 3) this.feeInput = '0'
				if (this.panelTimer) clearTimeout(this.panelTimer)
				this.panelClosing = false
				this.expandedId = null
			},
			/** 转入账户：点宫格里的一格 */
			pickToAccount(a) {
				this.toAccountId = a.id
			},
			/**
			 * 焦点落在哪一行（只决定键盘作用于谁，不改变任何归属）。
			 * **换行 = 这一笔算完了**（用户裁定）：算式结算成结果落回原那一格、算式清空；
			 * 之后新起的算式算的是新焦点那一行（转账态：转账金额 ↔ 手续费各算各的）。
			 */
			focusFee(on) {
				const next = !!on
				if (next === this.feeFocused) return
				this.commitCalc()
				this.feeFocused = next
			},
			/**
			 * 把算式结算成结果：写回它所属的那一格（就是当前焦点行），算式清空。
			 * 换焦点行、换类型（支出/收入/转账）都走它 —— 用户裁定「计算结果清空算式」。
			 * 没有算式时什么都不做（注意不是「把 0 写回去」）。
			 */
			commitCalc() {
				if (!this.calcOp) return
				this.setCurInput(this.centsToInput(this.calcCentsNow))
				this.calcTerms = []
			},
			/**
			 * 某一行的金额字号（px）：基准字号 × 缩放系数。
			 * 标题（转账金额/手续费）与「元」**不缩** —— 用户裁定：只缩金额，别把标题挤到换行。
			 */
			amtPx(baseRpx) {
				return uni.upx2px(Math.round(baseRpx * this.amtScale)) + 'px'
			},
			/**
			 * 某一行的**有效金额**（分）：算式正算着这一行就用实时结果，否则就是那一格里的数。
			 * 金额栏、手续费栏、保存三处共用 —— 显示的与存进去的必须是同一个数。
			 */
			lineCents(isFee) {
				if (this.calcOp && this.feeFocused === isFee) return this.calcCentsNow
				return yuanToCents(isFee ? this.feeInput : this.amountInput)
			},
			/** 当前焦点行对应的输入串 */
			curInput() {
				return this.feeFocused ? this.feeInput : this.amountInput
			},
			setCurInput(v) {
				if (this.feeFocused) this.feeInput = v
				else this.amountInput = v
			},
			// ---- 金额键盘（元直输，显示恒两位小数）----
			// 键盘一律作用于**当前焦点行**（转账态有两行：转账金额 / 手续费）
			tapKey(k) {
				const cur = this.curInput()
				if (k === '.') {
					// 清空后这一格是空串（不再是 '0'），先敲小数点要补个 0 ——
					// 否则算式里会出现 '.5' 这种看着像笔误的数
					if (!cur.includes('.')) this.setCurInput(cur === '' ? '0.' : cur + '.')
					return
				}
				const [int, dec = ''] = cur.split('.')
				if (cur.includes('.')) {
					if (dec.length >= 2) return // 小数 ≤ 2 位
				} else if (int.length >= 8) return // 整数 ≤ 8 位（上限 99999999.99 = 9999.99万）
				this.setCurInput(cur === '0' ? k : cur + k)
			},
			/**
			 * + / − 键（用户裁定）：把当前这一笔折进累计、把符号挂上去，金额栏从下一笔起就实时算。
			 *
			 * 算式只算**金额**那一行，所以点 +/− 顺手把焦点收回来 —— 转账态正在改手续费时
			 * 尤其需要，否则算式挂在金额上、键盘却还在手续费上，看着像算错了行。
			 * 连点两个符号 = 改主意：还没输数就只换符号，不把 0 折进去。
			 */
			tapOp(op) {
				// 算式作用于**当前焦点那一行**（用户裁定：切到手续费之后算的就是手续费），
				// 所以这里不抢焦点 —— 抢了就等于把算式按在金额上
				const v = this.curInput()
				// 怎么接进片段（三种情形，以及「上一次的符号必须留着」）写在 format.js 的
				// pushTerm 里 —— 这段判断连续两轮出过错，钉在纯函数上才有断言盖得住
				this.calcTerms = pushTerm(this.calcTerms, v, op)
				this.setCurInput('') // 空串 = 还没输下一笔（算式里就看不到多余的 0.00）
			},
			/**
			 * 退格：一格一位地退，**算式也跟着退**（用户裁定：8 + 5 要能先删 5、再删 +、再删 8）。
			 * 这一格退空了就退掉最后那个符号，并把上一笔**放回输入格** —— 它回到正在编辑的位置，
			 * 算式里就不再重复它（否则会变成「8 + 5」+ 输入格还有个 5）。
			 */
			tapBackspace() {
				// 刚长按清空过，就别再删一位（松手后浏览器还会补一次 click）
				if (this.bsLong) {
					this.bsLong = false
					return
				}
				const cur = this.curInput()
				if (this.calcTerms.length) {
					if (cur) {
						this.setCurInput(cur.length > 1 ? cur.slice(0, -1) : '')
						return
					}
					const terms = this.calcTerms.slice(0, -1) // 丢掉最后那个符号
					this.setCurInput(terms.length ? terms[terms.length - 1] : '')
					this.calcTerms = terms.slice(0, -1)
					return
				}
				// 没有算式（或正在改手续费）时，就是一个普通输入格
				this.setCurInput(cur.length > 1 ? cur.slice(0, -1) : '')
			},
			/**
			 * 按住退格 350ms = **清空金额**（用户裁定：金额不另配清空 ×）。
			 * 350ms 与 uni 自己的 longpress 阈值一致；这也是计算器长按删除键的通用手势。
			 *
			 * 为什么手写计时而不用 @longpress：移动端 webview 里长按事件的触发时机不稳，
			 * 本项目 tab 中央圆钮的按下态同样是改成 touchstart/touchend 才可靠的。
			 * 另：这里**不做连删**（按住一直删）—— 用户要的是「就会清空」，一步到位。
			 */
			bsDown() {
				// 按下反馈与长按计时是同一根手指的两件事，都挂在这两个处理器上 ——
				// 模板里就不必为一个键写两套 touch 事件（同一个属性写不了两次）
				this.pressOn('bs')
				this.bsLong = false
				if (this.bsTimer) clearTimeout(this.bsTimer)
				this.bsTimer = setTimeout(() => {
					this.bsTimer = null
					this.bsLong = true
					// 长按 = 整条不要了：当前焦点那一行清空，金额的算式也一起撤
					// （一格一位地退是**短按**的事，见 tapBackspace）
					this.setCurInput('')
					this.calcTerms = []
					// 触觉反馈：手指还按着、屏幕上只是数字变成 0.00，给一下确认（与分类页同法）
					if (uni.vibrateShort) uni.vibrateShort({ fail: () => {} })
				}, 350)
			},
			/** 松手 / 手势被取消：撤掉计时器。短按因此只剩 click 那一次「删一位」 */
			bsUp() {
				this.pressOff()
				if (this.bsTimer) {
					clearTimeout(this.bsTimer)
					this.bsTimer = null
				}
			},
			// ---- 自绘滚轮（picker-view 在页面内、样式可控；系统 <picker> 是独立 webview）----
			// 一张卡片一个滚轮、两组内容（用户裁定：点「日期」滚日期、点「时刻」滚时刻），
			// 靠 pvMode 决定渲染哪一组列 —— 两组列的高度/胶囊/确定按钮都是同一套
			openPicker(mode) {
				if (this.pvTimer) clearTimeout(this.pvTimer)
				this.pvClosing = false
				this.pvMode = mode
				if (mode === 'time') {
					// 时/分两列是定值，建一次就够
					if (!this.pvHours.length) {
						for (let h = 0; h < 24; h++) this.pvHours.push(h)
						for (let m = 0; m < 60; m++) this.pvMinutes.push(m)
					}
					// 老流水没有时刻：滚轮落在「此刻」，滚一格就是他要的值（不会停在 0 点）
					this.pvTimeIndex = timeIndexes(this.time || hhmmNow())
					this.showPicker = true
					return
				}
				// 未来日期不允许被滚动到（用户裁定）：列表只建到今天，滚轮根本滚不出未来
				const nowY = new Date().getFullYear()
				this.pvYears = []
				for (let y = nowY - 10; y <= nowY; y++) this.pvYears.push(y)
				const [ys, ms, ds] = this.date.split('-')
				const yi = Math.max(0, this.pvYears.indexOf(Number(ys)))
				this.pvIndex = [yi, 0, 0]
				this.rebuildMonths()
				this.pvIndex = [yi, Math.min(Number(ms) - 1, this.pvMonths.length - 1), 0]
				this.rebuildDays(Number(ds)) // 恢复已选日（跨月自动钳到月末/今日）
				this.showPicker = true
			},
			/** 时刻滚轮：两列都是定值，滚到哪就是哪（不用像日列那样重建） */
			onPvTimeChange(e) {
				this.pvTimeIndex = e.detail.value
			},
			// 月列表随年份收缩：当年只到当前月（年列表本就止于今年）
			rebuildMonths() {
				const y = this.pvYears[this.pvIndex[0]]
				const now = new Date()
				const maxM = y === now.getFullYear() ? now.getMonth() + 1 : 12
				this.pvMonths = []
				for (let m = 1; m <= maxM; m++) this.pvMonths.push(m)
				if (this.pvIndex[1] > maxM - 1) this.pvIndex[1] = maxM - 1 // 越界月钳回（如 12月 → 10月）
			},
			// 月天数随年月变化，尽量保住已选日；当年当月只建到今天
			rebuildDays(keepDay) {
				const y = this.pvYears[this.pvIndex[0]]
				const m = this.pvMonths[this.pvIndex[1]]
				const now = new Date()
				let last = new Date(y, m, 0).getDate()
				if (y === now.getFullYear() && m === now.getMonth() + 1) last = Math.min(last, now.getDate())
				this.pvDays = []
				for (let d = 1; d <= last; d++) this.pvDays.push(d)
				const want = Math.min(keepDay || 1, last)
				this.pvIndex = [this.pvIndex[0], this.pvIndex[1], want - 1]
			},
			onPvChange(e) {
				const prevYi = this.pvIndex[0]
				const prevMi = this.pvIndex[1]
				const prevDay = this.pvDays[this.pvIndex[2]]
				this.pvIndex = e.detail.value
				if (this.pvIndex[0] !== prevYi) this.rebuildMonths() // 换年：月列表随之收缩/放开
				// ★ 只有**年月**变了才重建日列（把已选日尽量保住、并按新月份的天数钳一下）。
				//   用户直接滚**日列**时必须原样放行 —— 重建会把 pvIndex[2] 写回 prevDay，
				//   等于把刚滚到的日子退回去：确定时读到的还是旧日（用户报的 bug），
				//   而且 :value="pvIndex" 是受控的，滚轮会当场弹回原位。
				if (this.pvIndex[0] !== prevYi || this.pvIndex[1] !== prevMi) this.rebuildDays(prevDay)
			},
			confirmPicker() {
				if (this.pvMode === 'time') {
					// 时分就是滚轮里那两列，取出来即合法（列本身就是 0~23 / 0~59）
					this.time = timeFromIndexes(this.pvTimeIndex)
					this.closePicker()
					return
				}
				const y = this.pvYears[this.pvIndex[0]]
				const m = this.pvMonths[this.pvIndex[1]]
				const d = this.pvDays[this.pvIndex[2]]
				const v = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
				if (v > this.todayStr()) {
					uni.showToast({
						title: '日期不能晚于今天',
						icon: 'none'
					})
					return
				}
				this.date = v
				this.closePicker()
			},
			// 日期卡片退场动画（与新增子分类卡片同机制）
			closePicker() {
				if (!this.showPicker || this.pvClosing) return
				this.pvClosing = true
				this.pvTimer = setTimeout(() => {
					this.showPicker = false
					this.pvClosing = false
				}, 200)
			},
			// ---- 行内展开：点主分类即选中，再点同分类收起；子分类面板点选不收起 ----
			toggleParent(c) {
				if (this.pickedParentId !== c.id) this.pickedSub = null // 换主分类：旧子选择作废
				this.pickedParentId = c.id
				if (this.expandedId === c.id) {
					this.closePanel()
					return
				}
				if (this.panelTimer) clearTimeout(this.panelTimer) // 收回中途重开：掐掉收起定时器
				this.panelClosing = false
				this.expandedId = c.id
			},
			isSubPicked(s) {
				return !!(this.pickedSub && this.pickedParentId === this.expandedId && this.pickedSub.id === s.id)
			},
			// 再点已选子分类 = 取消选中、回退用主分类（用户裁定，替代「不选子分类」按钮）。
			// 选与取消都保持面板展开，只有点主分类按钮才收起（用户裁定）
			/** 点子分类 = 切换选中（用户裁定：**取消飞行动画**，选中态自己会「变大 + 呼吸」） */
			pickSub(s) {
				this.pickedParentId = this.expandedId
				this.pickedSub = this.pickedSub && this.pickedSub.id === s.id ? null : s
			},
			/**
			 * 卡片里点图标：只改选中态（用户裁定：**取消飞行动画**，改由选中态自己
			 * 「变大 + 呼吸 + 白边 + 投影」表达，见 App.vue 的 .af-ring）。
			 */
			pickIcon(k) {
				this.afIcon = this.afIcon === k ? '' : k // 再点一次 = 取消选中
			},
			// 面板收回动画：expandedId 撑到动画播完再清空（v-if 才不会瞬间拆节点）
			closePanel() {
				if (this.expandedId == null || this.panelClosing) return
				this.panelClosing = true
				this.panelTimer = setTimeout(() => {
					this.expandedId = null
					this.panelClosing = false
				}, 200)
			},
			openAddForm() {
				// 默认不选图标 → 预览用名称首字（用户裁定）
				if (this.afTimer) clearTimeout(this.afTimer) // 退场中途重开：掐掉定时器
				this.afClosing = false
				this.afIcon = ''
				this.afName = ''
				this.afColor = ''
				this.showAddForm = true
			},
			// 退场动画：showAddForm 撑到 afOut 播完再清（v-if 才不会瞬间拆节点）
			closeAdd() {
				if (!this.showAddForm || this.afClosing) return
				this.afClosing = true
				this.afTimer = setTimeout(() => {
					this.showAddForm = false
					this.afClosing = false
				}, 200)
			},
			async confirmAdd() {
				if (this.afClosing) return // 退场动画期间的残影点击：忽略（防重复提交）
				const name = this.afName.trim()
				if (!name) {
					uni.showToast({
						title: '子分类名称不得为空哦',
						icon: 'none'
					})
					return
				}
				try {
					await createCategory({
						name,
						type: this.type,
						parentId: this.expandedId,
						icon: this.afIcon ? 'svg:' + this.afIcon : '', // 不选图标存空串 → 页面用名称首字
						color: this.afColor // 空串存库，展示时回退父色
					})
					await this.loadCategories()
					// 新树里找回刚加的子分类（expandedCat 是旧引用，不能直接用）
					const parent = (this.type === 1 ? this.cats.expense : this.cats.income)
						.find((c) => c.id === this.expandedId)
					const sub = parent && parent.subs.find((s) => s.name === name)
					if (sub) {
						this.bornId = sub.id // 新格子弹一下
						this.pickedParentId = parent.id
						this.pickedSub = sub
					}
					this.closeAdd() // 带退场动画收起
					this.afName = ''
					this.afColor = ''
					uni.showToast({
						title: '已添加',
						icon: 'success'
					})
				} catch (e) {
					console.error('[edit] 新增子分类失败', e)
					const msg = String(e.message || '').replace('SQL执行失败: ', '') || '新增失败'
					uni.showToast({
						title: msg,
						icon: 'none'
					})
				}
			},
			// ---- 保存 ----
			async save() {
				if (this.saving) return
				// 算式在跑就用实时结果 —— 显示的与存进去的必须是同一个数，
				// 否则会出现「看着 35.00、存进去 10.00」这种最坏的错
				const amountCents = this.lineCents(false)
				if (amountCents <= 0) {
					uni.showToast({
						title: this.calcOp ? '金额要大于 0' : '请输入金额',
						icon: 'none'
					})
					return
				}
				// 转账态：两端账户都必须有，且不能是同一个（服务层也拦，这里只是体验层先说话）
				if (this.type === 3) {
					if (this.accountId == null) {
						uni.showToast({ title: '请选择转出账户', icon: 'none' })
						return
					}
					if (this.toAccountId == null) {
						uni.showToast({ title: '请选择转入账户', icon: 'none' })
						return
					}
					if (this.toAccountId === this.accountId) {
						uni.showToast({ title: '转入与转出不能是同一个账户', icon: 'none' })
						return
					}
				} else if (this.pickedParentId == null) {
					uni.showToast({
						title: '请选择分类',
						icon: 'none'
					})
					return
				}
				if (this.type !== 3 && this.accountId == null) {
					uni.showToast({
						title: '请选择账户',
						icon: 'none'
					})
					return
				}
				if (amountCents > MAX_AMOUNT_CENTS) {
					uni.showToast({
						title: '单笔金额不能超过 9999.99万',
						icon: 'none'
					}) // 文案收口（审查 M2）；键盘 10 位上限的兜底
					return
				}
				// 手续费（仅转账有意义）：空 / 0 / 不合法都按「没有手续费」处理 ——
				// 服务层见到 0 就不会写那第二条记录
				const feeCents = this.type === 3 ? Math.max(0, this.lineCents(true)) : 0
				if (feeCents > MAX_AMOUNT_CENTS) {
					uni.showToast({ title: '手续费不能超过 9999.99万', icon: 'none' })
					return
				}
				const editing = this.recordId != null
				const payload = {
					type: this.type,
					categoryId: this.pickedSub ? this.pickedSub.id : this.pickedParentId,
					accountId: this.accountId,
					toAccountId: null,
					amountCents,
					date: this.date,
					time: this.time,
					note: this.note.trim()
				}
				this.saving = true
				try {
					if (this.type === 3) {
						// 转账：两条记录（转账 + 它那笔手续费）的全部编排都在服务层，
						// 页面只把六个字段递过去，不碰「手续费行该插还是该改」这类判断
						await saveTransfer({
							id: this.recordId,
							accountId: this.accountId,
							toAccountId: this.toAccountId,
							amountCents,
							feeCents,
							date: this.date,
							time: this.time,
							note: this.note.trim()
						})
					} else if (editing) await updateRecord(this.recordId, payload)
					else await addRecord(payload)
					// 记住这次用的账户：下次记账默认就是它（非关键数据，失败不影响已保存的流水）
					try {
						await setMeta('lastAccountId', String(this.accountId))
					} catch (e) {
						console.warn('[edit] 记住账户失败（不影响已保存的流水）', e)
					}
					uni.showToast({
						title: editing ? '已保存' : '已记账',
						icon: 'success'
					})
					setTimeout(() => uni.navigateBack(), 800) // 让 toast 露脸（M2 既有节奏）
					// 兜底：navigateBack 若没把页面带走（本页恰是唯一页面时会发生），
					// saving 不能永久为 true——1.5s 后复位，比导航窗口长，双击仍被挡住
					setTimeout(() => {
						this.saving = false
					}, 1500)
				} catch (e) {
					console.error('[edit] 保存失败', e)
					uni.showToast({
						title: '保存失败',
						icon: 'none'
					})
					this.saving = false
				}
			},
			goBack() {
				uni.navigateBack()
			}
		}
	}
</script>

<style lang="less">
	// 页面固定高度不滚动（反馈：记一笔不该出现滚动条）：
	// box-sizing 让行内 paddingTop 计入 100vh，剩余空间全部交给分类区内部消化
	.page {
		height: 100vh;
		box-sizing: border-box;
		background: var(--md-surface-container);
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}

	.ed-top {
		// 顶部功能区（顶栏 / 金额 / 胶囊）统一 180 + 不透明底色：高于页内飞行幻影 150，
		// 图标飞过上方时被这整片区域遮住（用户裁定）。光有 z-index 不够——这三块原本是
		// 透明的，只改绘制顺序的话幻影照样透过来；必须有与页面同色的不透明背景才算真遮住
		position: relative;
		z-index: 180;
		background: var(--md-surface-container);
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12rpx 24rpx;

		// 顶栏那个保存按钮去掉了（用户裁定），标题改绝对居中 ——
		// 否则 space-between 只剩两个子元素，标题会被推到右边
		.title {
			position: absolute;
			left: 50%;
			top: 50%;
			transform: translate(-50%, -50%);
			font-size: 32rpx;
			font-weight: 600;
			color: var(--md-on-surface);
		}
	}

	.icon-btn {
		width: 84rpx;
		height: 84rpx;
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
	}


	.amount-display {
		position: relative;
		z-index: 180; // 同上：顶部功能区遮挡飞行幻影
		background: var(--md-surface-container); // 不透明才遮得住（见 .ed-top）
		text-align: center;
		padding: 20rpx 0 4rpx;

		// 金额上方的小字算式（用户裁定：只在用过 +/− 之后出现）。
		// display: block 是必须的 —— App 端 <text> 是行内元素，不给块级会跟金额挤在一行
		.expr {
			display: block;
			margin-bottom: 2rpx;
			font-size: 26rpx;
			color: var(--md-on-surface-variant);
		}

		.v {
			font-size: 92rpx;
			font-weight: 600;
			letter-spacing: 1rpx;
			color: var(--md-on-surface);
		}

		.u {
			margin-left: 10rpx;
			font-size: 28rpx;
			color: var(--md-outline); // 灰色小字「元」（反馈裁定）
		}

		// 转账态：两行（转账金额 / 手续费）。
		// ★ 焦点**只决定键盘作用于哪一行**，不改变任何归属 —— 所以不用「选中」那套装饰，
		//   一根线一个底都不加（这个项目两次否掉发丝线，理由是真机上像脏边）。
		//   当前行 80rpx 近黑、另一行 52rpx 次级灰，两行位置固定。
		&.dual {
			// 两行要留出呼吸（用户反馈「太挤」）：每行上下各 10rpx，行与行之间净空 20rpx。
			// 两行字号差得大（当前行 80rpx / 另一行 52rpx），贴在一起时基线看着像错位。
			padding: 6rpx 0 12rpx;

			.aline {
				display: flex;
				align-items: baseline;
				justify-content: center;
				gap: 16rpx;
				padding: 10rpx 48rpx;
			}

			// ★ flex: 0 0 auto + nowrap：标题**不许被数字挤扁**（挤扁了「转账金额」会折成两行，
			//   真机反馈过）。放不下由数字缩字号解决（见 amtPx / amtScale），不靠压标题
			.alabel {
				flex: 0 0 auto;
				white-space: nowrap;
				font-size: 26rpx;
				color: var(--md-on-surface-variant);
			}

			.v {
				flex: 0 0 auto; // 同理：数字按自身宽度占位，只由字号决定放不放得下
				font-size: 52rpx;
				color: var(--md-on-surface-variant);
			}

			.u {
				margin-left: 8rpx;
				font-size: 26rpx;
				color: var(--md-on-surface-variant);
			}

			.aline.on {
				.alabel {
					font-weight: 600;
					color: var(--md-on-surface);
				}

				.v {
					font-size: 80rpx;
					color: var(--md-on-surface);
				}
			}
		}
	}

	.seg-wrap {
		position: relative;
		z-index: 180; // 顶部功能区之一（见 .ed-top）：遮挡页内飞行幻影；仍低于弹层 200/201
		background: var(--md-surface-container); // 不透明才遮得住（见 .ed-top）
		display: flex;
		justify-content: center;
		padding: 12rpx 48rpx 20rpx; // 底部留白（用户裁定）：宫格滚动内容不直接贴住胶囊
	}

	.seg {
		position: relative;
		display: flex;
		// 用填充底代替 1rpx 描边：真机上那条发丝线看着像脏边（用户反馈）
		background: var(--md-surface);
		border-radius: 999rpx;
		overflow: hidden;
		width: 480rpx;

		// 滑动指示块：宽度 = 一半（支出/收入各半），收入时右移 100%
		.seg-thumb {
			position: absolute;
			top: 0;
			bottom: 0;
			left: 0;
			width: 33.333%; // 三段（支出 / 收入 / 转账）各占三分之一
			border-radius: 999rpx;
			// 实色主色：淡染色块（#dce8e1）与填充底（#e4eae5）几乎同色，看不出选中（用户反馈）
			background: var(--md-primary);
			transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);

			&.pos-1 {
				transform: translateX(0);
			}
			&.pos-2 {
				transform: translateX(100%);
			}
			&.pos-3 {
				transform: translateX(200%);
			}
		}

		.seg-btn {
			position: relative; // 压在滑动块之上
			z-index: 1;
			flex: 1;
			height: 80rpx;
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 8rpx;
			font-size: 28rpx;
			font-weight: 500;
			color: var(--md-on-surface-variant);

			&.on {
				color: var(--md-on-primary);
				font-weight: 600;
			}

			.seg-ic.off {
				visibility: hidden; // 占位不显示，保住 label 位置
			}
		}
	}

	// 分类区：flex:1 吃富余空间；min-height:0 允许 flex 子项收缩，内容超高时本区内部滚动
	// 分类区 / 转入账户宫格的小标题（只有转账态用得上）
	.zone-t {
		font-size: 25rpx;
		color: var(--md-on-surface-variant);
		padding: 0 0 8rpx;
	}

	.cat-zone {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 20rpx 36rpx 12rpx;

		&::-webkit-scrollbar {
			display: none; // 内部滚动也不露滚动条
		}
	}

	// 每行固定 4 个主分类（flex:1 等宽），行内展开面板插在本行之后
	.cat-row {
		display: flex;
		gap: 8rpx;

		.cat {
			// 固定 1/4 宽（= 展开面板 .sub-grid 那条规矩）：末行不满 4 个时**保持格宽、从左边排**。
			// 原来用 flex: 1 —— 末行只有 1 个（转账宫的 5 个账户必是 4+1）时那一格会被拉成整行宽，
			// 图标居中，看着像「没从左边排起」（用户反馈）。
			flex: 0 0 calc((100% - 24rpx) / 4); // 24rpx = 行内 3 个 gap（8rpx）
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 10rpx;
			padding: 18rpx 4rpx 14rpx;
			border-radius: 32rpx;
			box-sizing: border-box;

			.cat-head {
				display: flex;
				align-items: center;
				gap: 6rpx;
				max-width: 100%;

				.cat-name {
					font-size: 24rpx;
					color: var(--md-on-surface-variant);
				}

				// 有子分类的主分类：名字后的向下三角，展开时翻转
				.cat-arrow {
					width: 0;
					height: 0;
					border-left: 8rpx solid transparent;
					border-right: 8rpx solid transparent;
					border-top: 10rpx solid var(--md-outline);
					transition: transform 0.2s;

					&.up {
						transform: rotate(180deg);
					}
				}
			}

			// 有子分类的主分类：名字与三角**必须同一行**（用户反馈）。
			// 格宽只有 1/4（约 163rpx），名字到 5 个字就会换行，三角随之落到两行中间，看着像错位。
			// 所以这一格的名字改成单行省略，三角永远贴在名字右边。
			// 只在这一组合下省略：账户宫格共用 .cat-head 但没有三角，那里的名字（最多 8 字）
			// 换行比截断好读。
			&.has-subs {
				.cat-name {
					white-space: nowrap;
					overflow: hidden;
					text-overflow: ellipsis;
					min-width: 0;
				}

				.cat-arrow {
					flex: 0 0 auto;
				}
			}

			&.on {
				background: var(--md-primary-container);

				.cat-name {
					color: var(--md-on-primary-container);
					font-weight: 600;
				}
			}
		}
	}

	// 展开面板：与分类网格左右同边距（同一容器内边距），后续行被自然挤下去
	.sub-panel {
		position: relative;
		margin: 16rpx 0 16rpx;
		padding: 20rpx 24rpx;
		background: var(--md-surface);
		border-radius: 28rpx;
		animation: panelIn 0.22s ease-out;

		// 收回动画（用户裁定）：向下收起；expandedId 撑到播完才清空，v-if 不会瞬间拆节点
		&.closing {
			animation: panelOut 0.2s ease-in forwards;
		}

		// 文字气泡尾巴：与面板同色连成一体，指向本行主分类（--tail-x 由模板按格位算出）
		&::before {
			content: '';
			position: absolute;
			top: -9rpx;
			left: var(--tail-x, 50%);
			width: 20rpx;
			height: 20rpx;
			background: var(--md-surface);
			border-radius: 4rpx;
			transform: translateX(-50%) rotate(45deg);
		}
	}

	@keyframes panelIn {
		from {
			opacity: 0;
			transform: translateY(-10rpx);
		}
	}

	@keyframes panelOut {
		to {
			opacity: 0;
			transform: translateY(-10rpx);
		}
	}

	.sub-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 12rpx;

		.sub-cell {
			width: calc((100% - 36rpx) / 4);
			display: flex;
			flex-direction: column;
			align-items: center;
			// 图标与名字的间距：8rpx 只够静止态。**选中态会放大**，而这一格与别处不同 ——
			// 图标下面紧跟着名字：呼吸到最大（1.34 倍）时白边的下沿落在中心下方约 48rpx，
			// 而名字原来在 40rpx 处 —— 会压到字上。20rpx 让白边下沿离名字还剩约 4rpx。
			// （别处没有这个约束：图标宫格、色板、主题色圆点都是「一行只有圆」。）
			gap: 20rpx;
			padding: 8rpx 4rpx 4rpx;
			box-sizing: border-box;

			// 图标裸圆（组件自带色圆），无背景块
			.sub-ic {
				width: 64rpx;
				height: 64rpx;
				border-radius: 50%;
				// 取消选中时缩回原位、白边与投影一起淡出
				transition: transform 0.22s ease, box-shadow 0.22s ease;

				// 选中态：与图标宫格 / 色板 / 主题色**完全相同**的「变大 + 呼吸 + 白边 + 投影」
				// （selBreathe 定义在 App.vue，全局样式）。原来是 box-shadow 描边环 —— 那类
				// 「细环 + 1px 偏差就显歪」的写法一并退场；白边用 box-shadow 扩散画，不撑盒子。
				&.on {
					transform: scale(1.25);
					box-shadow: 0 0 0 4rpx #ffffff, 0 3rpx 8rpx rgba(0, 0, 0, 0.26);
					animation: selBreathe 1.8s ease-in-out infinite;
				}

				&.add-ring {
					border: 2rpx dashed var(--md-outline);
					display: flex;
					align-items: center;
					justify-content: center;
					box-sizing: border-box;
				}
			}

			.sub-name {
				max-width: 100%;
				font-size: 22rpx;
				color: var(--md-on-surface-variant);
			}

			&.add .sub-name {
				color: var(--md-primary-strong);
			}

			&.born {
				animation: chipBorn 0.4s cubic-bezier(0.3, 1.6, 0.4, 1);
			}
		}
	}

	@keyframes chipBorn {
		from {
			transform: scale(0.4);
			opacity: 0;
		}
	}

	// 「备注」「日期」「时刻」共用的胶囊条：填充底、不描边、图标与文字同一行。
	// ★ 必须写在**两行都能命中**的层上、且常驻 display: flex —— App 端 uni-view 是 display: block，
	//   缺了 flex，里面那枚图标 <view> 就自己占一行、掉到文字上方，胶囊也没了底
	//   （用户反馈「图标和文字不在一行、也不是按钮样式」：原先它嵌在 .meta-row 里，新行一换就全不命中）
	.field {
		flex: 1;
		height: 84rpx;
		background: var(--md-surface);
		border-radius: 24rpx;
		display: flex;
		align-items: center;
		gap: 16rpx;
		padding: 0 28rpx;

		.note-input {
			flex: 1;
			// 右侧给「清空 ×」让位（.clr-btn 贴 .clr-wrap 右边 10rpx、命中区 44rpx）
			padding-right: 68rpx;
			font-size: 27rpx;
			color: var(--md-on-surface);
		}

		&.dt {
			.dt-k {
				font-size: 25rpx;
				color: var(--md-on-surface-variant);
			}

			.dt-v {
				font-size: 27rpx;
				font-weight: 500;
				color: var(--md-on-surface);
			}
		}
	}

	// 备注 + 日期（顶部留白，用户裁定：宫格滚动内容不直接贴住本行）
	.meta-row {
		display: flex;
		gap: 20rpx;
		padding: 20rpx 40rpx 20rpx;
	}

	// 「日期」「时刻」两个胶囊各占一半（用户裁定）：与备注同一行会把备注压太窄，单独一行
	.dt-row {
		display: flex;
		gap: 20rpx;
		padding: 0 40rpx 20rpx;
	}

	.note-ph,
	.af-ph {
		color: var(--md-outline);
	}

	.keypad {
		display: flex;
		gap: 14rpx;
		padding: 0 28rpx calc(28rpx + env(safe-area-inset-bottom));

		.keys {
			flex: 3;
			display: flex;
			flex-wrap: wrap;
			gap: 14rpx;

			.key {
				width: calc((100% - 28rpx) / 3);
				height: 100rpx;
				border-radius: 28rpx;
				background: var(--md-surface);
				display: flex;
				align-items: center;
				justify-content: center;
				font-size: 44rpx;
				font-weight: 500;
				color: var(--md-on-surface);
				box-sizing: border-box;
			}
		}

		// 右列：顶上一格放账户（1 行高），下面保存键占满余下的 3 行——两列总高严丝合缝
		.right-col {
			flex: 1.35;
			display: flex;
			flex-direction: column;
			gap: 14rpx;
		}

		.key-acct {
			height: 100rpx;
			border-radius: 28rpx;
			background: var(--md-surface);
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 6rpx;
			padding: 0 12rpx;
			box-sizing: border-box;

			.key-acct-t {
				min-width: 0;
				font-size: 26rpx;
				font-weight: 500;
				color: var(--md-on-surface);
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			// 账户名 + 下拉箭头**必须同一行**。这个包裹层原来只在 .dual 里才是 flex，
			// 于是支出/收入态下它是个裸 <view> —— App 端 uni-view 是 display: block，
			// 里面的 <view> 箭头就自己占一行、掉到账户名下面（用户反馈）。
			// 现在常驻 flex：转账态与收支态同一个形状，也不再有两处走散的可能。
			.key-acct-row {
				display: flex;
				align-items: center;
				justify-content: center;
				gap: 6rpx;
				max-width: 100%;
			}

			// 转账态：这个键是**转出**方，要在键上标出来（转入方在宫格里）。
			// 100rpx 高装得下「转出」20rpx + 账户名 26rpx 两行。
			&.dual {
				flex-direction: column;
				gap: 2rpx;

				.key-acct-k {
					font-size: 20rpx;
					color: var(--md-on-surface-variant);
				}
			}
		}

		// + / −：同一行两个小键（用户裁定），整行与一行数字键等高（100rpx + 14rpx 间距），
		// 于是「账户 1 行 + 加减 1 行 + 保存 2 行」正好等于数字键区 4 行
		.key-ops {
			display: flex;
			gap: 14rpx;
			height: 100rpx;
		}

		// 与数字键同一种「面」（surface 底、同圆角），只有保存是主按钮 ——
		// 一眼分得出「算」和「存」这两种键
		.key-op {
			flex: 1;
			border-radius: 28rpx;
			background: var(--md-surface);
			display: flex;
			align-items: center;
			justify-content: center;

			text {
				font-size: 44rpx;
				font-weight: 500;
				color: var(--md-on-surface);
			}
		}

		.key-save {
			flex: 1;
			border-radius: 40rpx;
			background: var(--md-primary);
			display: flex;
			align-items: center;
			justify-content: center;

			text {
				font-size: 34rpx;
				font-weight: 600;
				letter-spacing: 4rpx;
				color: #ffffff;
			}
		}
	}

	// 自绘日期滚轮：只定高，外观（透明 + 整行胶囊）在 App.vue 的 .pv-* 里统一
	.pv-h {
		height: 400rpx;

		.pv-item {
			height: 88rpx;
			line-height: 88rpx;
			text-align: center;
			font-size: 30rpx;
			color: var(--md-on-surface);
		}
	}

	// 选择账户卡片：列表行（图标 + 名称 + 余额 + 当前项勾）
	.ap-list {
		max-height: 560rpx;
		overflow-y: auto;
		overscroll-behavior: contain; // 断掉滚动链：滚到头也不把背后的页面带着滚

		.ap-empty {
			padding: 40rpx 12rpx;

			.ap-empty-t {
				font-size: 26rpx;
				color: var(--md-on-surface-variant);
			}
		}

		.ap-item {
			display: flex;
			align-items: center;
			gap: 20rpx;
			padding: 22rpx 24rpx;
			border-radius: 999rpx; // 胶囊：与首页账户筛选同一形状（用户裁定）

			&.on {
				background: var(--md-primary-container);
			}

			.ap-name {
				flex: 1;
				font-size: 28rpx;
				color: var(--md-on-surface);
			}

			.ap-bal {
				font-size: 26rpx;
				color: var(--md-on-surface-variant);
			}

			.ap-check {
				flex-shrink: 0;
			}
		}
	}

</style>
