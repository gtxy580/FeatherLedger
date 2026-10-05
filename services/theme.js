/**
 * services/theme.js —— 主题色：一个色相派生 16 个 CSS 变量
 *
 * 为什么是「色相 + 每 token 固定偏移」而不是「统一换成一个色相」：
 * 现有 16 个 token 的原始色相并不一致（108 ~ 167）。统一成一个色相会让默认档也偏
 * （#cce3de → #cce3d9）。存偏移后默认档能**精确复现**现值，「不选主题时观感零变化」
 * 才是可断言的；而 h 仍是唯一输入，偏移是编译期常量，设计意图（一个色相驱动整肤）不变。
 */
import { getMeta, setMeta } from './meta.js'
import { PALETTE, hslToHex } from './palette.js'

/**
 * [token, 色相偏移, s(%), l(%)] —— 即 spec §4 表。
 * 偏移 = 该 token 原始色相 − **默认主色的色相 154.05**（= 色板里 `green` 的 hue，
 * 见 palette.js；这里不再单独存一份常量，免得同一个数字两处定义）。
 * s/l 取自现值本身的 HSL（2 位小数，该精度下默认档可精确回算）。
 * 改这张表会被 scripts/theme-repro.mjs 第 1 组断言挡住。
 */
const TOKEN_TEMPLATE = [
	['--md-primary', 0, 0, 0],
	['--md-primary-strong', 1.66, 46.16, 35.69],
	['--md-primary-container', 12.91, 58.22, 84.51],
	['--md-on-primary-container', 5.95, 69.76, 16.86],
	['--md-secondary-container', -9.05, 41.38, 88.63],
	['--md-on-secondary-container', 3.45, 57.14, 16.47],
	['--md-inverse-surface', -6.78, 25.28, 17.06],
	['--md-inverse-on-surface', -46.05, 30.3, 93.53],
	// ★ 2026-10-04「翻底」方案（用户从三张对比稿里选的 C）后，这一族的**角色**是：
	//   surface            = 抬起来的面：卡片 / 弹层 / tabBar / 页面上那些药丸。l=100 → 纯白
	//                        （此时 s 对结果毫无影响，留着只为说明它属于哪一族）
	//   surface-container  = 页面底色 + 白面上的凹槽（输入框、次级按钮）
	//   -high / -highest   = 凹槽的更深两档，只用在白面内部
	//   反过来记也行：**更抬起 = 更白，凹下去 = 更淡的色**。
	// ⚠ 翻底**只换了各处读哪个 token，没改这里的数值** —— 所以默认档仍逐 token 复现
	//   App.vue 的 page{}，theme-repro 第 1 组照旧成立。
	['--md-surface', -14.05, 40.0, 100],
	['--md-surface-container', -22.05, 28.58, 93.14],
	['--md-surface-container-high', -24.05, 25.0, 90.59],
	['--md-surface-container-highest', -16.91, 23.72, 88.43],
	['--md-on-surface', -4.05, 21.42, 10.98],
	['--md-on-surface-variant', -6.78, 15.82, 27.25],
	['--md-outline', -9.05, 10.26, 45.88],
	['--md-outline-variant', -12.23, 19.46, 77.84]
]

/**
 * 主题预设 = **色板本身**（`services/palette.js` 的 PALETTE，10 个）。
 * 顺序即主题页的格子顺序：默认绿打头（用户裁定：默认色也要是可点的一格，从蓝色回绿色
 * 不必绕「恢复默认」），其余按色相升序，石墨灰收尾。
 *
 * ★ 为什么直接引用色板而不是各写一份：**图标/账户/分类的颜色与主题预设必须是同一套**
 *   （用户裁定「图标色板和主题色板保持一致」）。原来两处各写各的 —— 于是出现过
 *   「松绿(154) 与 苔绿(145) 只差 9°、饱和度还一样」这种等于同一套色板的情况。
 *   现在色板是唯一来源，两边的格子顺序也一致。
 *   「相邻两格不许看着一样」由 scripts/theme-repro.mjs 第 4.5 组守着。
 */
export const THEMES = PALETTE

/** 默认预设。 */
export const DEFAULT_THEME = THEMES[0]

/**
 * 由一个**色板条目**派生 16 个变量。纯函数，不碰 DOM、不碰库。
 *
 * 参数从 (hue, sat) 改成整个条目：主色现在要按色相各给一档 s/l（见 palette.js 的
 * primaryOf），那信息挂在条目上（`primary`）。条目就是色板那一格 ——
 * `THEMES === PALETTE`，所以调用处直接传主题对象即可。
 * @param {{hue:number, sat:number, primary?:{s:number,l:number}}} entry 色板条目
 * @returns {Record<string, string>} 如 { '--md-primary': '#rrggbb', ... }
 */
export function buildVars(entry) {
	const sat = entry.sat == null ? 1 : entry.sat
	const out = {}
	for (const [token, off, s, l] of TOKEN_TEMPLATE) {
		// 主色不走模板那一档：它按色相各给一档（暖色的 s 天生要比冷色高才不显灰）
		const isPrimary = token === '--md-primary' && entry.primary
		out[token] = hslToHex(entry.hue + off, isPrimary ? entry.primary.s : s * sat, isPrimary ? entry.primary.l : l)
	}
	return out
}

/** meta 里存这个键（值是预设 key，不是色相——石墨灰色相无意义，存色相分不出来） */
const META_KEY = 'themeAccent'

/** uni storage 里的镜像键。库里的 meta 才是事实来源，这份只是**冷启动首帧**的快通道。 */
const MIRROR_KEY = 'themeAccentMirror'

/** 内存缓存：一处会话内只查一次库。setAccent 会同步刷新它。 */
let cache = null

/**
 * 读当前主题。没设过 / 值认不出 / 空值，一律回落默认绿。
 * @returns {Promise<{key:string,name:string,hue:number,sat:number}>}
 */
export async function loadAccent() {
	if (cache) return cache
	const raw = await getMeta(META_KEY)
	cache = THEMES.find((t) => t.key === raw) || DEFAULT_THEME
	// 自愈：顺手把镜像补上。库里已有值而镜像是空的设备（老库升上来 / 清过 storage /
	// 镜像键被删）不补的话**每次冷启动都会闪绿**，直到用户再点一次色块。
	writeMirror(cache.key)
	return cache
}

/**
 * 切换主题：先落库、成功了再落内存。
 *
 * 顺序不能反：若先写 cache 再落库，一旦 setMeta 抛错（SQLite 写失败），内存里已是新主题
 * 而库里还是旧值——本次会话显示新色、冷启动回退旧色，用户看到「生效了」其实没存上。
 * 反过来的代价是 applyTheme 要多等一次写库，但那本就是 await 链上的一环，无感知。
 * @param {string} key THEMES 里的 key
 */
export async function setAccent(key) {
	const t = THEMES.find((x) => x.key === key)
	if (!t) throw new Error(`未知主题：${key}`)
	await setMeta(META_KEY, t.key)
	cache = t
	writeMirror(t.key)
	return t
}

/**
 * 算出当前主题的 16 条变量，并顺手改掉系统导航栏的底色。
 *
 * **它不碰 DOM，也碰不到。** App 端页面的 JS 跑在**逻辑层**——独立于 webview 的
 * jscore/v8 引擎，`window` / `document` / `location` 一律不存在（这正是 uni 要有
 * createSelectorQuery 的原因）。所以 `document.querySelector(...)` 在真机上是
 * undefined，**任何"运行时写 DOM"的方案都会静默变成空操作**：
 * 计算全做对、一个变量都写不出去、不报错、屏幕毫无变化。
 *
 * 变量只能**声明式**地交给视图层：main.js 的全局 mixin 把这里的返回值存进响应式
 * 对象，各页根节点用 :style 绑它（内联样式由视图层解析，var() 也在那里生效——
 * 这与 maskStyle 的内联 var() 是同一条路径，已被真机证明可行）。
 *
 * 这里只剩 uni 的 API 可用（API 是跨层通信的）：系统导航栏底色在 pages.json 里是
 * 写死的 JSON，用 var 够不着。
 *
 * @returns {Promise<Record<string,string>>} 派生的 16 条变量
 */
export async function applyTheme() {
	const t = await loadAccent()
	const vars = buildVars(t)
	// 现在只有 pages/category/category 还在用系统导航栏（其余五页都是 navigationStyle: custom）。
	try {
		uni.setNavigationBarColor({ frontColor: '#000000', backgroundColor: vars['--md-surface'] })
	} catch (e) {
		// 自定义导航栏的页上是空操作；脚本环境里 uni 未定义。都不该打断换肤。
	}
	return vars
}

/**
 * 把镜像写进 uni storage。**只能在 setMeta 成功之后调**——镜像只允许缓存
 * 「已经落库的值」，否则写库失败时会在库外留下一个假成功。
 * 包 try/catch：复现脚本里没有 uni，storage 个别机型也可能不可用——快通道失效
 * 只是慢一点，不影响正确性。
 */
function writeMirror(key) {
	try {
		uni.setStorageSync(MIRROR_KEY, key)
	} catch (e) {
		// 快通道不可用，忽略
	}
}

/**
 * 冷启动首帧专用：**同步**读镜像并算出 16 条变量。
 *
 * 为什么需要这条快通道：App.vue 的 page{} 兜底是默认绿，而真正的主题要等
 * initDB（建表 → 迁移 → 种子）加一次 meta 查询才读得到——首帧早就画完了，
 * 于是冷启动会明显闪一段绿（不是「最坏一帧」，是整个数据库初始化那段时长）。
 * `uni.getStorageSync` 是同步的，能在首帧渲染前拿到值。库仍是事实来源：
 * onShow 的异步路径随后会用库里的值覆盖它。
 *
 * @returns {Record<string,string>|null} 读不到 / 认不出 → null（调用方保持空对象）
 */
export function mirrorVars() {
	try {
		const raw = uni.getStorageSync(MIRROR_KEY)
		const t = THEMES.find((x) => x.key === raw)
		return t ? buildVars(t) : null
	} catch (e) {
		return null
	}
}
