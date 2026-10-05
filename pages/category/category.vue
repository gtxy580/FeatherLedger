<template>
	<view class="page" :style="[{ paddingTop: statusBarHeight + 'px' }, themeVars]" @click="exitModes">
		<!-- 头部：与其他管理页（账户/主题/数据）同一套（用户裁定「要和它们一致」）。
         原来是系统导航栏 —— 那是它看着与众不同的原因 -->
		<view class="top">
			<view class="icon-btn" @click="goBack">
				<view :style="maskStyle('chevL', 44, 'var(--md-on-surface)')"></view>
			</view>
			<text class="title">分类管理</text>
			<view class="icon-btn"></view>
		</view>
		<!-- 支出/收入：与首页月年、记一笔收支同一套滑动分段 -->
		<view class="seg-wrap">
			<view class="seg">
				<view class="seg-thumb" :class="{ right: type === 2 }"></view>
				<view class="seg-btn" :class="{ on: type === 1 }" @click="setType(1)"><text>支出</text></view>
				<view class="seg-btn" :class="{ on: type === 2 }" @click="setType(2)"><text>收入</text></view>
			</view>
		</view>

		<!-- 模式提示条：进入删除/排序模式时说明当前能做什么、怎么退出 -->
		<view v-if="manageMode" class="hint-bar">
			<text class="hint-text">按住格子可拖动排序；点右上角 − 删除；点任意处退出</text>
		</view>

		<view class="list">
			<template v-for="(c, ci) in catList" :key="c.id">
				<!-- 主分类行 -->
				<view class="row top-row" :style="topRowStyle(c.id)">
					<view class="row-main" @click="toggleSubs(c)">
						<view :id="'catic-' + c.id">
							<category-icon :icon="c.icon" :color="c.color" :name="c.name" :size="76" />
						</view>
						<text class="row-name">{{ c.name }}</text>
						<view v-if="c.subs.length" class="row-arrow" :class="{ up: expandedId === c.id }"></view>
					</view>
					<view class="ops">
						<view class="op" :class="{ off: ci === 0 }" @click.stop="move(c, -1)">
							<view :style="maskStyle('chevUp', 32, 'var(--md-on-surface-variant)')"></view>
						</view>
						<view class="op" :class="{ off: ci === catList.length - 1 }" @click.stop="move(c, 1)">
							<view :style="maskStyle('chevDown', 32, 'var(--md-on-surface-variant)')"></view>
						</view>
						<view class="op" @click.stop="openEditTop(c)">
							<view :style="maskStyle('pencil', 30, 'var(--md-primary-strong)')"></view>
						</view>
						<view class="op" @click.stop="askDelete(c)">
							<view :style="maskStyle('trash', 30, 'var(--md-error)')"></view>
						</view>
					</view>
				</view>

				<!-- 子分类宫格：行内展开；点图标编辑、长按出删除 ×、排序模式可拖动 -->
				<view v-if="expandedId === c.id" :id="'subgrid-' + c.id" class="sub-zone"
					:class="{ closing: panelClosing, 'manage-mode': manageMode && expandedId === c.id }"
					@click.stop="onZoneTap">
					<view class="sub-grid">
						<view v-for="(s, si) in gridSubs(c)" :key="s.id" class="sub-cell"
							:class="{ dragging: following && dragIndex === si, jiggle: manageMode && !(following && dragIndex === si) }"
							:style="cellShiftStyle(s.id)" @touchstart="onCellStart($event, c, si)"
							@touchmove="onCellMove" @touchend="onCellEnd(c, si)" @touchcancel="onCellEnd(c, si)">
							<!-- 抖动放在内层：外层 .sub-cell 要留给 FLIP 的位移 transform，两个 transform 会互相覆盖 -->
							<view class="cell-inner" :style="{ animationDelay: (si % 4) * 60 + 'ms' }">
								<view :id="'subic-' + s.id" class="sub-ic">
									<category-icon :icon="s.icon" :color="s.color || c.color" :name="s.name"
										:size="64" />
									<view v-if="manageMode" class="del-badge" @click.stop="onSubDelete(s)">
										<text>−</text>
									</view>
								</view>
								<text class="sub-name">{{ s.name }}</text>
							</view>
						</view>
						<view class="sub-cell add" @click.stop="onAddTap(c)">
							<view class="sub-ic add-ring">
								<view :style="maskStyle('plus', 32, 'var(--md-primary-strong)')"></view>
							</view>
							<text class="sub-name">新增</text>
						</view>
					</view>
					<text v-if="!c.subs.length" class="sub-empty">还没有子分类，点「新增」建一个</text>
				</view>
			</template>

			<!-- 新增主分类：列表末尾的普通行 -->
			<view class="row add-top-row" @click.stop="openEditTop(null)">
				<view class="add-chip"><text>+</text></view>
				<text class="add-text">新增主分类</text>
			</view>

			<!-- 空态 -->
			<view v-if="!catList.length && !loading" class="empty">
				<text class="empty-text">{{ type === 1 ? '支出' : '收入' }}分类还没有，点上面的「新增主分类」建一个</text>
			</view>
		</view>

		<!-- 编辑卡片 -->
		<view v-if="showEdit" class="af-scrim" :class="{ closing: editClosing }" @click="closeEdit">
			<view class="af-blocker"></view>
			<view class="af-card" :class="{ closing: editClosing }" @click.stop>
				<view class="af-grab"></view>
				<text class="af-title">{{ edTitle }}</text>

				<view class="af-icons">
					<view v-for="k in iconKeys" :key="k" class="af-ic" @click="pickIcon(k)">
						<view class="af-ring" :class="{ on: edIcon === k }">
							<category-icon :icon="'svg:' + k" :color="edCardColor" :size="56" />
						</view>
					</view>
				</view>

				<view class="af-row">
					<view class="af-preview">
						<category-icon :icon="edIcon ? 'svg:' + edIcon : ''" :color="edCardColor"
							:name="edName || edIconChar" :size="80" />
					</view>
					<view class="clr-wrap">
						<input class="af-name" v-model="edName" placeholder="分类名称，如「早餐」" :maxlength="nameMax"
							:cursor-spacing="kbSpacing" placeholder-class="af-ph" />
						<view v-if="edName" class="clr-btn" @click="edName = ''">
							<view :style="maskStyle('x', 26, 'var(--md-on-surface-variant)')"></view>
						</view>
					</view>
				</view>

				<view class="af-colors">
					<view v-for="cc in afColors" :key="cc" class="af-color" :class="{ on: edSwatchOn(cc) }"
						:style="{ backgroundColor: cc }" @click="edColor = edColor === cc ? '' : cc"></view>
				</view>
				<view class="af-hint-wrap">
					<text class="af-hint">不选图标则用名称首字，再点一次取消选中；不选颜色则主分类用默认灰、子分类跟随主分类。</text>
					<text v-if="edName" class="af-count"
						:class="{ full: nameCount >= nameMax }">{{ nameCount }}/{{ nameMax }}</text>
				</view>

				<view class="af-btns">
					<view class="af-cancel af-press" :class="{ pressing: isPressed('cancel') }"
						@touchstart="pressOn('cancel')" @touchend="pressOff" @touchcancel="pressOff" @click="closeEdit">
						<text>取消</text>
					</view>
					<view class="af-done af-press" :class="{ pressing: isPressed('ok') }" @touchstart="pressOn('ok')"
						@touchend="pressOff" @touchcancel="pressOff" @click="confirmEdit"><text>确定</text></view>
				</view>
			</view>
		</view>

		<!-- 图标飞行幻影：从格子飞向预览圆（easycom 自动注册） -->
		<icon-fly ref="fly" />

		<!-- 自绘确认框（easycom 自动注册） -->
		<confirm-dialog ref="confirmDlg" />
	</view>
</template>

<script>
	import {
		getCategoriesGrouped,
		createCategory,
		updateCategory,
		deleteCategory,
		moveCategory,
		reorderCategories,
		countRecordsByCategory,
		CATEGORY_NAME_MAX
	} from '@/services/category.js'
	import {
		maskStyle,
		CATEGORY_ICON_KEYS
	} from '@/services/icons.js'
	import {
		PALETTE_COLORS,
		paletteColor as pal
	} from '@/services/palette.js'
	import pressFx from '@/services/press.js'

	const LONG_PRESS_MS = 450 // 按住多久算长按（进入删除模式）
	const MOVE_TOLERANCE = 8 // 位移超过它就认为不是点击/长按（滑动列表或拖拽）

	export default {
		mixins: [pressFx],
		data() {
			return {
				type: 1, // 1=支出 2=收入
				cats: {
					expense: [],
					income: []
				},
				statusBarHeight: 0,
				loading: true,
				expandedId: null, // 行内展开子分类宫格的主分类 id
				panelClosing: false,
				panelTimer: null,
				moving: false, // ↑↓排序 / 删除的防重入
				// 长按进入的「整理模式」：格子抖动 + 右上角出 − + 可直接拖动排序
				manageMode: false,
				subOrder: [], // 整理期间的本地顺序（只在松手时才落库）
				dragIndex: -1,
				following: false, // 幻影是否已经起来（手指真正移动后才起，轻点不闪一下）
				suppressZoneTap: false, // 抑制「长按/拖拽抬手」派生出的那一次 click，否则一松手就被退出整理模式
				cellRects: [], // 排序模式进入时量一次各格子矩形，拖动时据此判断手指在哪个格子上
				flip: {}, // 换位动画：id → {dx, dy, animate}，把「跳过去」变成「滑过去」
				flipTimer: null,
				startX: 0,
				startY: 0,
				pressMoved: false,
				pressFired: false,
				pressTimer: null,
				// 编辑卡片
				showEdit: false,
				editClosing: false,
				editTimer: null,
				saving: false,
				edId: null, // null = 新增
				edParentId: null, // null = 主分类
				edName: '',
				edIcon: '', // ICONS 的 key（不带 svg: 前缀）；空 = 用名称首字
				edColor: '', // PALETTE_COLORS 之一（= 主题色板，同一套 10 个）；空 = 主分类用组件默认、子分类跟随主分类色
			}
		},
		computed: {
			catList() {
				return this.type === 1 ? this.cats.expense : this.cats.income
			},
			// 名称上限来自服务层（同一个数只留一个源）；模板要读它
			nameMax() {
				return CATEGORY_NAME_MAX
			},
			// 实时字数，口径同输入框 maxlength（见 account.vue 同一处的说明）
			nameCount() {
				return this.edName.length
			},
			iconKeys() {
				return CATEGORY_ICON_KEYS
			},
			afColors() {
				return PALETTE_COLORS
			},
			edTitle() {
				const sub = this.edParentId != null
				if (this.edId != null) return sub ? '编辑子分类' : '编辑主分类'
				return sub ? '新增子分类' : '新增主分类'
			},
			/**
			 * 预览圆里还没名字时显示的字：主分类「主」、子分类「子」（用户裁定）。
			 * 原来一律「分」——于是「新增主分类」与「新增子分类」两张卡片看着一模一样，
			 * 光看预览圆分不出自己在加哪一级。
			 * （账户卡是「账」、记一笔的子分类表单是「子」，本条让分类页与它们同一规矩。）
			 */
			edIconChar() {
				return this.edParentId == null ? '主' : '子'
			},
			/** 卡片里的图标/预览用色：选了颜色用颜色，否则子分类跟随主分类、主分类用组件默认灰 */
			edCardColor() {
				if (this.edColor) return this.edColor
				if (this.edParentId == null) return ''
				const p = this.catList.find((c) => c.id === this.edParentId)
				return p ? p.color : ''
			},
			/** 当前展开的主分类（子分类宫格所属的主分类）——必须是 computed，方法名当值用会取到函数本身 */
			expandedCat() {
				return this.catList.find((c) => c.id === this.expandedId) || null
			}
		},
		onLoad() {
			this.statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 0
		},
		onShow() {
			this.load() // 与首页/记账页同规：每次显示重查，页面不持有真相
		},
		/** 安卓返回键：确认框开着时，返回＝取消（返回 true 消费掉事件，不退出页面） */
		onBackPress() {
			const dlg = this.$refs.confirmDlg
			if (dlg && dlg.visible) {
				dlg.cancel()
				return true
			}
			return false
		},
		onUnload() {
			// 页面卸载时清掉所有定时器，避免回调打到已销毁的页面实例上
			if (this.pressTimer) clearTimeout(this.pressTimer)
			if (this.panelTimer) clearTimeout(this.panelTimer)
			if (this.editTimer) clearTimeout(this.editTimer)
			if (this.flipTimer) clearTimeout(this.flipTimer) // 换位动画的收尾定时器（M4 审查钉的漏网）
		},
		methods: {
			goBack() {
				uni.navigateBack() // 自绘头部的返回键（原来靠系统导航栏）
			},
			// 色板高亮放 methods（模板里当函数调用；放 computed 会报 not a function，已被 check-pages 拦）
			/** 同上（edit.vue）：留空 = 跟随主分类/默认灰，色板要跟着亮，不能一格都不亮 */
			edSwatchOn(c) {
				return (this.edCardColor || pal('graphite')) === c
			},
			maskStyle,
			async load() {
				try {
					const data = await getCategoriesGrouped()
					this.cats = data
					// 展开的分组可能已被删掉：失联即收起并退出所有模式
					if (this.expandedId != null && !this.catList.some((c) => c.id === this.expandedId)) {
						if (this.panelTimer) clearTimeout(this.panelTimer)
						this.panelClosing = false
						this.expandedId = null
						this.exitModes()
					}
					// 整理模式下重查（例如刚删掉一个子分类）：用新树重建本地顺序与格子矩形
					if (this.manageMode && this.expandedId != null) {
						const p = this.catList.find((c) => c.id === this.expandedId)
						if (p) {
							this.subOrder = [...p.subs]
							this.measureCells(p.id).then((rects) => {
								this.cellRects = rects
							})
						} else {
							this.exitModes()
						}
					}
					this.loading = false
				} catch (e) {
					console.error('[category] 分类加载失败', e)
					uni.showToast({
						title: '分类加载失败',
						icon: 'none'
					})
				}
			},
			setType(t) {
				if (this.consumeManage()) return
				if (this.type === t) return
				this.type = t
				if (this.panelTimer) clearTimeout(this.panelTimer)
				this.panelClosing = false
				this.expandedId = null
				this.exitModes()
			},
			/** 宫格里的子分类：整理模式下用本地顺序，否则用树里的顺序 */
			gridSubs(c) {
				return this.manageMode && this.expandedId === c.id ? this.subOrder : c.subs
			},
			/** 换位动画的内联样式：FLIP 的「先反向位移」那一步，下一帧再归零滑回去 */
			cellShiftStyle(id) {
				const f = this.flip[id]
				if (!f) return {}
				return {
					transform: `translate(${f.dx}px, ${f.dy}px)`,
					transition: f.animate ? 'transform 0.18s ease-out' : 'none'
				}
			},
			errText(e, fallback) {
				return String((e && e.message) || '').replace('SQL执行失败: ', '') || fallback
			},

			// ---- 行内展开/收起 ----
			toggleSubs(c) {
				if (this.consumeManage()) return
				if (this.expandedId === c.id) {
					this.closeSubs()
					return
				}
				if (this.panelTimer) clearTimeout(this.panelTimer)
				this.panelClosing = false
				this.expandedId = c.id
				this.exitModes()
			},
			closeSubs() {
				if (this.expandedId == null || this.panelClosing) return
				this.panelClosing = true
				this.panelTimer = setTimeout(() => {
					this.expandedId = null
					this.panelClosing = false
					this.exitModes()
				}, 200)
			},

			// ---- 主分类的上下移（保留按钮式：整行条目，按钮比拖拽直观）----
			/**
			 * ↑↓ 排序：**本地先换位、落库随后跟上**。
			 *
			 * 为什么不是「等落库 → load() → 再量新位置补偿」：那样中间必然有一帧
			 * 「顺序已换、补偿还没贴上」，就是一瞬闪动。补偿位移与换位要在**同一次 DOM 补丁**里
			 * （两处 reactive 赋值在同一 tick，Vue 合成一次更新）才不闪。
			 *
			 * 补偿量也不用再量：相邻两行换位时**槽位几何没变**（行高一致），
			 * 「我的新位置」＝「原来那个槽位那一行的旧位置」，直接从换位前量到的 rects 算。
			 * 注意 boundingClientRect 给的是 px（不是 rpx）。
			 */
			async move(c, dir) {
				if (this.consumeManage()) return
				if (this.moving) return
				this.moving = true
				try {
					const key = this.type === 1 ? 'expense' : 'income'
					const list = this.cats[key]
					const beforeRects = await this.measureTopRows() // 顺序 === list
					const i = list.findIndex((x) => x.id === c.id)
					const j = i + dir
					if (i < 0 || j < 0 || j >= list.length) return
					const arr = list.slice()
					const [item] = arr.splice(i, 1)
					arr.splice(j, 0, item)

					const shift = {};
					[list[i].id, list[j].id].forEach((id) => {
						const from = list.findIndex((x) => x.id === id)
						const to = arr.findIndex((x) => x.id === id)
						if (!beforeRects[from] || !beforeRects[to]) return
						shift[id] = {
							dx: beforeRects[from].left - beforeRects[to].left,
							dy: beforeRects[from].top - beforeRects[to].top,
							animate: false
						}
					})
					if (this.flipTimer) clearTimeout(this.flipTimer)
					this.flip = shift // 先反向位移到旧位置（无过渡）
					this.cats = {
						...this.cats,
						[key]: arr
					} // 同一 tick：顺序与补偿一起上屏

					setTimeout(() => {
						const done = {}
						Object.keys(shift).forEach((id) => {
							done[id] = {
								dx: 0,
								dy: 0,
								animate: true
							}
						})
						this.flip = done // 下一帧归零：有过渡，于是两行对滑（「挤」过去）
						this.flipTimer = setTimeout(() => {
							this.flip = {}
						}, 260)
					}, 20)

					await moveCategory(c.id, dir)
					await this.load() // 以库里的顺序为准（本地换位只是为了让动画立刻开始）
				} catch (e) {
					console.error('[category] 排序失败', e)
					uni.showToast({
						title: this.errText(e, '排序失败'),
						icon: 'none'
					})
					await this.load() // 失败：把顺序拉回库里的真相
				} finally {
					this.moving = false
				}
			},
			/** 量每个主分类行当前的位置（顺序与 catList 一致；boundingClientRect 给的是 px，不是 rpx） */
			measureTopRows() {
				return new Promise((resolve) => {
					uni.createSelectorQuery()
						.in(this)
						.selectAll('.top-row')
						.boundingClientRect((rects) => resolve(rects || []))
						.exec()
				})
			},
			/**
			 * 主分类行的换位样式。与 cellShiftStyle 分开：那条是拖动时的**跟手**动画
			 * （0.18s ease-out），这条是点击换位，用项目的回弹缓动更有「挤」的感觉。
			 */
			topRowStyle(id) {
				const f = this.flip[id]
				if (!f) return {}
				return {
					transform: `translate(${f.dx}px, ${f.dy}px)`,
					transition: f.animate ? 'transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)' : 'none'
				}
			},

			// ---- 删除：主分类与子分类共用（子分类的 subs 恒为空，文案自动短一截）----
			/** 主分类行垃圾桶的入口：整理模式下先退出（不执行删除） */
			async askDelete(c) {
				if (this.consumeManage()) return
				this.performDelete(c)
			},
			/**
			 * 删除确认与执行（无模式守卫的版本，由 askDelete / onSubDelete 分别决定退出时机）
			 * @param {Object} c 分类节点（主分类或子分类）
			 * @param {boolean} [exitAfter] 确认删除成功后是否退出整理模式
			 */
			async performDelete(c, exitAfter = false) {
				if (this.moving) return
				let n = 0
				try {
					n = await countRecordsByCategory(c.id)
				} catch (e) {
					console.error('[category] 统计流水失败', e) // 统计失败不该挡住删除，退化为不显示笔数
				}
				const subPart = c.subs.length ? `该分类下的 ${c.subs.length} 个子分类会一并删除。` : ''
				const recPart = n ? `已有的 ${n} 笔流水会保留，并在明细里显示为「已删除分类」。` : ''
				// 自绘确认框：点「取消」、点遮罩、按返回键**都算取消**（系统 uni.showModal 在 App 端
				// 是原生对话框，点遮罩关不掉）。只有 onConfirm 会真的删。
				this.$refs.confirmDlg.open({
					title: '确认删除',
					message: `删除「${c.name}」后不可恢复。${subPart}${recPart}确定吗？`,
					confirmText: '删除',
					cancelText: '取消',
					danger: true,
					onConfirm: async () => {
						this.moving = true
						try {
							const {
								removedSubs
							} = await deleteCategory(c.id)
							if (exitAfter) this.exitModes() // 只有真删成功了才退出；取消或失败都留在整理模式
							await this.load()
							uni.showToast({
								title: removedSubs ? `已删除（含 ${removedSubs} 个子分类）` : '已删除',
								icon: 'success'
							})
						} catch (e) {
							console.error('[category] 删除失败', e)
							uni.showToast({
								title: this.errText(e, '删除失败'),
								icon: 'none'
							})
						} finally {
							this.moving = false
						}
					}
				})
			},

			// ---- 模式切换：删除模式与排序模式互斥，都靠点空白/再点按钮退出 ----
			exitModes() {
				this.manageMode = false
				this.subOrder = []
				this.dragIndex = -1
				this.following = false
				this.cellRects = []
				this.flip = {}
				if (this.flipTimer) {
					clearTimeout(this.flipTimer)
					this.flipTimer = null
				}
				if (this.$refs.fly && this.$refs.fly.followEnd) this.$refs.fly.followEnd()
			},
			/**
			 * 整理模式下的统一守卫：**任何**操作入口先调它。
			 * 用户裁定「整理模式下点击整个页面任意位置都退出，不管是什么按钮」——所以其它按钮
			 * 在整理模式下只负责退出、不再执行自己的动作；唯一例外是删除 −，它删完也退出。
			 * @returns {boolean} true = 本次点击已被「退出」消费，调用方应立即 return
			 */
			consumeManage() {
				if (!this.manageMode) return false
				this.exitModes()
				return true
			},
			/**
			 * 长按进入整理模式：格子抖动 + 右上角出 − + 可拖动排序
			 * @param {Object} c 该宫格所属的主分类
			 * @param {number} i 触发长按的格子下标——直接作为拖拽候选，让同一次手势能继续拖
			 */
			enterManage(c, i) {
				this.manageMode = true
				this.subOrder = [...c.subs]
				this.dragIndex = Number.isInteger(i) ? i : -1
				this.following = false
				this.flip = {}
				if (uni.vibrateShort) uni.vibrateShort({
					fail: () => {}
				}) // 触觉反馈：告诉用户模式变了
				this.$nextTick(() => {
					this.measureCells(c.id).then((rects) => {
						this.cellRects = rects
					})
				})
			},
			/** 宫格空白处（含格子之间的间隙）点击：只负责退出模式 */
			onZoneTap() {
				if (this.suppressZoneTap) {
					this.suppressZoneTap = false // 这一次 click 是长按/拖拽抬手派生的，不当作「点其他处」
					return
				}
				this.consumeManage()
			},
			/** 「新增」格子：删除/排序模式下先退出模式，不弹卡片 */
			onAddTap(c) {
				if (this.consumeManage()) return
				this.openEditSub(c, null)
			},
			/**
			 * 点图标右上角的 −：走确认弹窗，**确认删除成功后才退出**整理模式。
			 * 取消弹窗则什么都不做、保持整理模式（用户裁定：不能点一下就退出）。
			 * 所以这里不能走 askDelete——它开头有 consumeManage 守卫，会先把模式退掉。
			 */
			onSubDelete(s) {
				this.performDelete(s, true)
			},
			// ---- 宫格触摸：区分 点击 / 长按 / 拖动 ----
			measureCells(parentId) {
				return new Promise((resolve) => {
					uni.createSelectorQuery()
						.in(this)
						.selectAll('#subgrid-' + parentId + ' .sub-cell')
						.boundingClientRect((rects) => resolve(rects || []))
						.exec()
				})
			},
			onCellStart(e, c, i) {
				const t = e.touches[0]
				this.startX = t.clientX
				this.startY = t.clientY
				this.pressMoved = false
				this.pressFired = false
				if (this.manageMode) {
					// 记下候选拖拽项，但**先不起幻影**：手指没动就抬手（例如轻点 −）不该闪一下图标
					this.dragIndex = i
					this.following = false
					return
				}
				if (this.pressTimer) clearTimeout(this.pressTimer)
				this.pressTimer = setTimeout(() => {
					this.pressTimer = null
					this.pressFired = true
					// 把触发这次长按的格子下标传进去：进入整理模式后**同一次手势可以接着拖**，
					// 不必抬手再按第二次（审查 Important 2）
					this.enterManage(c, i)
				}, LONG_PRESS_MS)
			},
			onCellMove(e) {
				const t = e.touches[0]
				if (!this.pressMoved) {
					if (Math.abs(t.clientX - this.startX) > MOVE_TOLERANCE || Math.abs(t.clientY - this.startY) >
						MOVE_TOLERANCE) {
						this.pressMoved = true
						if (this.pressTimer) {
							clearTimeout(this.pressTimer)
							this.pressTimer = null
						}
					}
				}
				if (!this.manageMode || this.dragIndex < 0) return
				if (!this.following) {
					// 手指真的移动了：这时才把图标「拎起来」
					const s = this.gridSubs(this.expandedCat)[this.dragIndex]
					if (s) {
						this.$refs.fly.followBegin({
							icon: s.icon,
							color: s.color || this.expandedCat.color,
							name: s.name,
							fromRpx: 64,
							x: t.clientX,
							y: t.clientY,
							scale: 1.2,
							level: 'page'
						})
					}
					this.following = true
				}
				this.$refs.fly.followTo(t.clientX, t.clientY)
				// 实时交换：手指落在哪个格子就与哪个换位；「新增」格子不是合法目标
				const target = this.cellRects.findIndex(
					(r) => t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom
				)
				if (target < 0 || target >= this.subOrder.length || target === this.dragIndex) return
				this.swapTo(target)
			},
			/**
			 * 交换 dragIndex 与 target 两格，并用 FLIP 让被挤走的格子「滑」到新位置。
			 *
			 * 补偿量与 ↑↓ 那条路同一套：拖拽开始时量好的 cellRects 就是**槽位**矩形（格子按下标填槽，
			 * 换位只换内容、不换槽），所以「我的新位置」= cellRects[新下标]，不必等渲染后再量一次
			 * ——既不会闪那一帧，连拖时也不再受上一次动画未归零的干扰（量的是槽位，不是活坐标）。
			 */
			swapTo(target) {
				const from = this.dragIndex
				const arr = this.subOrder.slice()
				const [item] = arr.splice(from, 1)
				arr.splice(target, 0, item)

				const shift = {}
				arr.forEach((s, to) => {
					const at = this.subOrder.findIndex((x) => x.id === s.id)
					if (at < 0 || !this.cellRects[at] || !this.cellRects[to]) return
					const dx = this.cellRects[at].left - this.cellRects[to].left
					const dy = this.cellRects[at].top - this.cellRects[to].top
					if (Math.abs(dx) > 1 || Math.abs(dy) > 1) shift[s.id] = {
						dx,
						dy,
						animate: false
					}
				})

				if (this.flipTimer) clearTimeout(this.flipTimer)
				this.flip = shift // 先反向位移到旧槽位（无过渡）
				this.subOrder = arr // 同一 tick：顺序与补偿一起上屏
				this.dragIndex = target

				setTimeout(() => {
					const done = {}
					Object.keys(shift).forEach((id) => {
						done[id] = {
							dx: 0,
							dy: 0,
							animate: true
						}
					})
					this.flip = done // 下一帧归零：有过渡，于是「滑」过去
					this.flipTimer = setTimeout(() => {
						this.flip = {}
					}, 220)
				}, 20)
			},
			onCellEnd(c, i) {
				if (this.pressTimer) {
					clearTimeout(this.pressTimer)
					this.pressTimer = null
				}
				const wasLong = this.pressFired
				const wasMoved = this.pressMoved
				this.pressFired = false
				this.pressMoved = false

				if (this.manageMode) {
					// 必须用 wasMoved（方法开头已把 this.pressMoved 清成 false），
					// 读 this.pressMoved 会让 dragged 恒为 false —— 拖拽排序就永远不会落库
					const dragged = this.dragIndex >= 0 && wasMoved
					this.dragIndex = -1
					if (this.following && this.$refs.fly && this.$refs.fly.followEnd) this.$refs.fly.followEnd()
					this.following = false
					// 只有「长按」或「拖动」抬手才抑制那次派生的 click（否则一松手就退出整理模式）；
					// 普通轻点抬手不抑制，好让「点其他格子＝退出」照常生效
					this.suppressZoneTap = wasLong || dragged
					if (dragged) {
						this.persistOrder(c)
						this.$nextTick(() => {
							this.measureCells(c.id).then((rects) => {
								this.cellRects = rects // 顺序变了，格子位置也变了，下一次拖拽要用新的矩形
							})
						})
					}
					// 点/长按格子本体：**这里不能退出**。退出交给 click 冒泡到 .sub-zone 的 onZoneTap——
					// 若在此处退出，手指一离开就退出，右上角 − 的 click 事件永远等不到（这就是「点 − 删不掉」的根因）
					return
				}
				if (wasLong) return // 长按已经进了整理模式，这一次不算点击
				if (wasMoved) return // 位移了：是滑动列表/拖拽，不是点击
				const s = this.gridSubs(c)[i]
				if (s) this.openEditSub(c, s)
			},
			/** 松手才落库；顺序没变就一次库都不写 */
			async persistOrder(parent) {
				const ids = this.subOrder.map((s) => s.id)
				const before = parent.subs.map((s) => s.id)
				if (ids.join(',') === before.join(',')) return
				try {
					await reorderCategories(ids)
					await this.load()
				} catch (e) {
					console.error('[category] 保存排序失败', e)
					uni.showToast({
						title: this.errText(e, '保存排序失败'),
						icon: 'none'
					})
					await this.load() // 落库失败：回到库里的真实顺序，不留下假的本地顺序
				}
			},

			// ---- 编辑卡片：新增主分类 / 新增子分类 / 编辑已有，共用一个卡片 ----
			/**
			 * 新建时的默认颜色：从可选色板里随机取一个（用户裁定）——比一律给默认灰有生气。
			 * 只用于**新建主分类**与**新建账户**；新建子分类仍留空（空 = 跟随主分类色，那比随机更对）。
			 */
			pickRandomColor() {
				return PALETTE_COLORS[Math.floor(Math.random() * PALETTE_COLORS.length)]
			},
			openEditTop(c) {
				if (this.editTimer) clearTimeout(this.editTimer)
				if (this.consumeManage()) return
				this.editClosing = false
				this.edId = c ? c.id : null
				this.edParentId = null
				this.edName = c ? c.name : ''
				this.edIcon = c && c.icon.startsWith('svg:') ? c.icon.slice(4) : ''
				this.edColor = c ? c.color : this.pickRandomColor()
				this.showEdit = true
			},
			openEditSub(parent, s) {
				if (this.editTimer) clearTimeout(this.editTimer)
				if (this.consumeManage()) return
				this.editClosing = false
				this.edId = s ? s.id : null
				this.edParentId = parent.id
				this.edName = s ? s.name : ''
				this.edIcon = s && s.icon.startsWith('svg:') ? s.icon.slice(4) : ''
				this.edColor = s ? s.color : ''
				this.showEdit = true
			},
			closeEdit() {
				if (!this.showEdit || this.editClosing) return
				this.editClosing = true
				this.editTimer = setTimeout(() => {
					this.showEdit = false
					this.editClosing = false
				}, 200)
			},
			/**
			 * 卡片里点图标：只改选中态（用户裁定：**取消飞行动画**，改由选中态自己「弹一下变大」，
			 * 见 App.vue 的 .af-ring —— 反馈因此不再需要一次跨屏动画）。
			 */
			pickIcon(k) {
				this.edIcon = this.edIcon === k ? '' : k // 再点一次 = 取消选中（退回名称首字）
			},
			async confirmEdit() {
				if (this.editClosing || this.saving) return // 退场动画期间的残影点击忽略；防重复提交
				const name = this.edName.trim()
				if (!name) {
					uni.showToast({
						title: '分类名称不得为空哦',
						icon: 'none'
					})
					return
				}
				this.saving = true
				const icon = this.edIcon ? 'svg:' + this.edIcon : ''
				try {
					if (this.edId == null) {
						await createCategory({
							name,
							type: this.type,
							parentId: this.edParentId,
							icon,
							color: this.edColor
						})
						if (this.edParentId != null) this.expandedId = this.edParentId // 新增子分类后展开父分组，让用户看见结果
					} else {
						await updateCategory(this.edId, {
							name,
							icon,
							color: this.edColor
						})
					}
					await this.load()
					this.closeEdit()
					uni.showToast({
						title: '已保存',
						icon: 'success'
					})
				} catch (e) {
					console.error('[category] 保存失败', e)
					uni.showToast({
						title: this.errText(e, '保存失败'),
						icon: 'none'
					})
				} finally {
					this.saving = false
				}
			}
		}
	}
</script>

<style lang="less">
	.page {
		min-height: 100vh;
		background: var(--md-surface-container);
	}

	.seg-wrap {
		position: relative;
		z-index: 180; // 顶部功能区：页内飞行幻影从它下方穿过时被遮住
		background: var(--md-surface-container);
		display: flex;
		justify-content: center;
		padding: 20rpx 48rpx 20rpx;
	}

	.seg {
		position: relative;
		display: flex;
		// 用填充底代替 1rpx 描边：真机上那条发丝线看着像脏边（用户反馈）
		background: var(--md-surface);
		border-radius: 999rpx;
		overflow: hidden;
		width: 440rpx;

		.seg-thumb {
			position: absolute;
			top: 0;
			bottom: 0;
			left: 0;
			width: 50%;
			border-radius: 999rpx;
			// 实色主色：淡染色块（#dce8e1）与填充底（#e4eae5）几乎同色，看不出选中（用户反馈）
			background: var(--md-primary);
			transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1); // 与其余胶囊统一：y>1 有轻微过冲，「嗒」一下到位

			&.right {
				transform: translateX(100%);
			}
		}

		.seg-btn {
			position: relative;
			z-index: 1;
			flex: 1;
			height: 76rpx;
			display: flex;
			align-items: center;
			justify-content: center;
			font-size: 28rpx;
			font-weight: 500;
			color: var(--md-on-surface-variant);

			&.on {
				color: var(--md-on-primary);
				font-weight: 600;
			}
		}
	}

	// 模式提示条：删除/排序模式下常驻，说明当前能做什么
	.list {
		padding: 0 24rpx 80rpx; // 本页是 navigateTo 二级页，无自绘 tabBar
	}

	.row {
		display: flex;
		align-items: center;
		background: var(--md-surface);
		border-radius: 24rpx;
		margin-bottom: 12rpx;
		padding: 0 8rpx 0 20rpx;
		min-height: 104rpx;

		.row-main {
			flex: 1;
			min-width: 0;
			display: flex;
			align-items: center;
			gap: 20rpx;
			padding: 14rpx 0;
		}

		.row-name {
			font-size: 30rpx;
			color: var(--md-on-surface);
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
			// 名字要能被压窄：不给 min-width: 0 的话，nowrap 的文字不会缩到内容宽以下，
			// 长名字会把三角顶出这一行（用户反馈：三角该和文字在同一行）
			min-width: 0;
		}

		.row-arrow {
			width: 0;
			height: 0;
			flex: 0 0 auto; // 同上：三角自己不参与压缩，永远留在名字右边
			border-left: 8rpx solid transparent;
			border-right: 8rpx solid transparent;
			border-top: 10rpx solid var(--md-outline);
			transition: transform 0.2s;

			&.up {
				transform: rotate(180deg);
			}
		}
	}

	// 操作区：五个等宽可点区域；禁用态降到 25%，激活态（排序中）高亮
	.ops {
		display: flex;
		flex-shrink: 0;

		.op {
			width: 62rpx;
			height: 84rpx;
			display: flex;
			align-items: center;
			justify-content: center;

			&.off {
				opacity: 0.25;
			}

		}
	}

	// 子分类宫格：行内展开，与记一笔面板同机制（panelIn 进场 / panelOut 收回）
	.sub-zone {
		margin: -4rpx 0 12rpx;
		// 左侧缩进代替原来的竖分隔线：线太抢眼，缩进同样能表达「属于上面那一行」
		padding: 16rpx 0 12rpx 24rpx;
		// 弹出：transform-origin 放在顶边，宫格从主分类行的下沿「长」出来；
		// 缓动的 y 分量 > 1 让 scale 先冲过 1 再回落——读起来是「弹」出来，而不是淡出来
		transform-origin: 50% 0;
		animation: panelIn 0.26s cubic-bezier(0.34, 1.45, 0.5, 1);

		// 收回：反向缩回主分类行，ease-in 让离开有「加速收起」的感觉
		&.closing {
			animation: panelOut 0.2s ease-in forwards;
		}
	}

	@keyframes panelIn {
		from {
			opacity: 0;
			transform: translateY(-16rpx) scale(0.9);
		}
	}

	@keyframes panelOut {
		to {
			opacity: 0;
			transform: translateY(-16rpx) scale(0.9);
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
			gap: 8rpx;
			padding: 12rpx 4rpx 8rpx;
			box-sizing: border-box;

			// 拖动中的那一格：图标已被「拎」到手指下方（幻影跟着手走），原位留一个淡出占位，
			// 视觉上就是「这一格被拿起来了」
			&.dragging {
				opacity: 0.25;
			}

			// 未被拖动的格子轻微抖动
			&.jiggle .cell-inner {
				animation: jiggle 0.3s ease-in-out infinite alternate;
			}

			.cell-inner {
				width: 100%;
				display: flex;
				flex-direction: column;
				align-items: center;
				gap: 8rpx;
			}

			.sub-ic {
				width: 64rpx;
				height: 64rpx;
				border-radius: 50%;
				position: relative; // 删除角标相对它定位

				&.add-ring {
					border: 2rpx dashed var(--md-outline);
					display: flex;
					align-items: center;
					justify-content: center;
					box-sizing: border-box;
				}

				// 删除角标：右上角，红边白底红字——实心红块太抢眼，压在图标上很突兀
				.del-badge {
					position: absolute;
					top: -8rpx;
					right: -8rpx;
					width: 38rpx;
					height: 38rpx;
					border-radius: 50%;
					background: #ffffff;
					border: 2rpx solid var(--md-error);
					display: flex;
					align-items: center;
					justify-content: center;
					box-sizing: border-box;
					z-index: 2;

					text {
						font-size: 30rpx;
						line-height: 30rpx;
						font-weight: 600;
						color: var(--md-error);
					}
				}
			}

			.sub-name {
				max-width: 100%;
				font-size: 22rpx;
				color: var(--md-on-surface-variant);
				white-space: nowrap;
				overflow: hidden;
				text-overflow: ellipsis;
			}

			&.add .sub-name {
				color: var(--md-primary-strong);
			}
		}
	}

	.sub-empty {
		display: block;
		padding: 8rpx 0 8rpx 4rpx;
		font-size: 23rpx;
		color: var(--md-outline);
	}

	.add-top-row {
		background: transparent;
		border: 2rpx dashed var(--md-outline-variant);
		gap: 20rpx;
		padding-left: 24rpx;

		.add-chip {
			width: 56rpx;
			height: 56rpx;
			border-radius: 50%;
			border: 2rpx dashed var(--md-outline);
			display: flex;
			align-items: center;
			justify-content: center;

			text {
				font-size: 34rpx;
				color: var(--md-primary-strong);
			}
		}

		.add-text {
			font-size: 28rpx;
			color: var(--md-primary-strong);
		}
	}

	.empty {
		padding: 120rpx 40rpx 0;
		text-align: center;

		.empty-text {
			font-size: 26rpx;
			color: var(--md-on-surface-variant);
		}
	}

	/* 编辑卡片的外壳样式（.af-scrim/.af-card/.af-icons/.af-row 等）在 App.vue 全局，见 Task 0.5 */
</style>
