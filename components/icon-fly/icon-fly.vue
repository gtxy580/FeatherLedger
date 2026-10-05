<template>
	<view v-if="active" class="fly-layer" :style="layerStyle">
		<category-icon :icon="icon" :color="color" :name="name" :size="fromRpx" />
	</view>
</template>

<script>
	/**
	 * 图标飞行图层：把一枚图标从 A 位置飞到 B 位置，飞完回调。
	 * 用途：选中分类图标时，图标飞向「预览圆」（卡片内）或「主分类格」（行内宫格）。
	 *
	 * 为什么是独立图层而不是给原元素加动画：
	 * 原元素还在格子里（它仍是个可选项），飞的是它的**幻影**——这也是「飞向购物车」那类
	 * 交互的通行做法。幻影用 fixed 定位、只动 transform（走合成层，不触发重排）。
	 *
	 * 坐标系：boundingClientRect 与 position:fixed 都以视口为原点，所以直接相减即可，
	 * 不需要减去滚动偏移——这是选 fixed 而不是 absolute 的原因。
	 */
	export default {
		name: 'icon-fly',
		data() {
			return {
				active: false,
				x: 0, // 幻影左上角（px，视口坐标）
				y: 0,
				scale: 1,
				icon: '',
				color: '',
				name: '',
				fromRpx: 56, // 幻影的初始边长（rpx），应与源图标一致
				level: 'page', // 'page' = 页内飞行（可被胶囊遮挡）| 'sheet' = 飞进弹层（压在卡片上）
				followMode: false, // 跟手模式：直接跟随手指，不做补间
				timer: null,
				doneTimer: null
			}
		},
		computed: {
			layerStyle() {
				const px = uni.upx2px(this.fromRpx)
				// 跟手模式以手指为中心，飞行模式以左上角为锚点（起点是量出来的矩形左上角）
				const off = this.followMode ? (px * this.scale) / 2 : 0
				return {
					width: px + 'px',
					height: px + 'px',
					transform: `translate(${this.x - off}px, ${this.y - off}px) scale(${this.scale})`,
					// 跟手要零延迟跟随，补间会让它「追」手指
					transition: this.followMode ? 'none' : 'transform 0.42s cubic-bezier(0.34, 1.5, 0.5, 1)',
					// 页内飞行要能**被支出/收入胶囊遮住**（用户裁定），所以压到胶囊之下；
					// 飞进弹层预览圆的路径反过来——低于卡片就会被卡片挡住，整段动画看不见，
					// 只能压在卡片之上。两种落点谁在上谁在下是互斥的，因此按落点分档。
					zIndex: this.level === 'sheet' ? 300 : 150
				}
			}
		},
		beforeDestroy() {
			if (this.timer) clearTimeout(this.timer)
			if (this.doneTimer) clearTimeout(this.doneTimer)
		},
		methods: {
			/**
			 * 开始跟手：图标浮在手指下方随手指移动，不做补间（拖拽排序用）。
			 * touchmove 会一直派发给 touchstart 的那个元素，所以幻影不吃事件也不影响拖拽。
			 * @param {Object} opts { icon, color, name, fromRpx, x, y, scale, level }
			 */
			followBegin({ icon = '', color = '', name = '', fromRpx = 64, x = 0, y = 0, scale = 1.2, level = 'page' } = {}) {
				if (this.timer) clearTimeout(this.timer)
				if (this.doneTimer) clearTimeout(this.doneTimer)
				this.icon = icon
				this.color = color
				this.name = name
				this.fromRpx = fromRpx
				this.level = level
				this.scale = scale
				this.followMode = true
				this.x = x
				this.y = y
				this.active = true
			},
			/** 跟手过程中的位置更新（入参是触点的 clientX/clientY） */
			followTo(x, y) {
				if (!this.followMode) return
				this.x = x
				this.y = y
			},
			/** 结束跟手：幻影立即消失 */
			followEnd() {
				this.followMode = false
				this.active = false
			},

			/** 在页面实例 ctx 的作用域里量一个选择器的矩形；量不到返回 null */
			rect(ctx, selector) {
				return new Promise((resolve) => {
					uni.createSelectorQuery()
						.in(ctx)
						.select(selector)
						.boundingClientRect((r) => resolve(r || null))
						.exec()
				})
			},
			/**
			 * 播放飞行。
			 * @param {Object} opts
			 * @param {Object} opts.ctx 页面实例（this）——选择器查询必须限定在页面作用域
			 * @param {string} opts.from 源选择器（如 '#ic-utensils'）
			 * @param {string} opts.to 目标选择器（如 '.af-preview'）
			 * @param {string} [opts.icon] 'svg:xxx' | 'img:...' | ''
			 * @param {string} [opts.color]
			 * @param {string} [opts.name] 无图标时的名称首字
			 * @param {number} [opts.fromRpx] 源图标边长（rpx），默认 56
			 * @param {'page'|'sheet'} [opts.level] 落点所在层档，决定幻影压在谁之上，默认 'page'
			 * @param {Function} [opts.onDone] 飞完（或量不到元素跳过动画）后调用。
			 *   注意：选中态**不要**放在这里落定——用户裁定「圆环出现太慢、不跟手」，
			 *   现在两个调用点都在点击时立即改状态，这个回调留作其他用途（如提示、埋点）。
			 */
			async play(opts) {
				const { ctx, from, to, icon = '', color = '', name = '', fromRpx = 56, level = 'page', onDone } = opts
				if (this.timer) clearTimeout(this.timer)
				if (this.doneTimer) clearTimeout(this.doneTimer)
				this.active = false // 连续点击时先收掉上一枚幻影

				const [f, t] = await Promise.all([this.rect(ctx, from), this.rect(ctx, to)])
				// 量不到（元素不在可视区/被条件渲染掉）就跳过动画直接落状态，绝不因此卡住交互
				if (!f || !t || !f.width) {
					if (onDone) onDone()
					return
				}

				this.icon = icon
				this.color = color
				this.name = name
				this.fromRpx = fromRpx
				this.level = level
				this.x = f.left
				this.y = f.top
				this.scale = 1
				this.active = true

				await this.$nextTick()
				// 隔一帧再改终值，浏览器才有「初始态」可过渡（同一帧内改等于没有起点）
				this.timer = setTimeout(() => {
					this.x = t.left + (t.width - f.width) / 2
					this.y = t.top + (t.height - f.height) / 2
					this.scale = t.width / f.width
				}, 20)
				// 等待时长必须 ≥ 过渡时长（0.42s），否则幻影还没落稳就被收掉
				this.doneTimer = setTimeout(() => {
					this.active = false
					if (onDone) onDone()
				}, 460)
			}
		}
	}
</script>

<style lang="less">
	.fly-layer {
		position: fixed;
		top: 0;
		left: 0;
		pointer-events: none; // 幻影不吃点击，飞行期间用户仍能点别处
		// 弹动：y 分量 1.5 > 1 表示曲线冲过终点再回落——位置与缩放同时过冲，
		// 落点是「弹」进去而不是「滑」进去。z-index 由内联样式按层档给（见 layerStyle）
		transition: transform 0.42s cubic-bezier(0.34, 1.5, 0.5, 1);
	}
</style>
