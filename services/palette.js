/**
 * services/palette.js —— 全 App 唯一的色板（10 个颜色）
 *
 * 为什么单独一个文件：**图标/账户/分类的颜色与主题预设必须是同一套**（用户裁定
 * 「图标色板和主题色板保持一致」），而它们原来各写各的 —— 色板在 icons.js、色相表在
 * theme.js、预置分类的颜色在 db.js。三处一份数据迟早走散（本项目已经为此返过工）。
 *
 * 本文件**不 import 任何东西**：这是它存在的技术前提。db.js 是底层模块（meta.js 依赖它），
 * 而主题与色板又要被 db.js 用（预置分类的颜色）—— 把色板放在 theme.js 里就会成环
 * （db.js → theme.js → meta.js → db.js），放在这里则三方都干净。
 *
 * ## 每个颜色有两个身份
 *
 *   · `{hue, sat}` —— 主题用它派生 16 个 token（sat 是**饱和度系数**，0 = 纯灰）。
 *   · `color`     —— 色板格子的颜色，也是分类/账户实际存在库里的值。
 *
 * `color` 是**手写**的，不是从主题派生：主题的主色只有 ~15% 饱和度（很灰），把分类图标
 * 染成那个浓度会一片没血色。两者是同一色相的两个浓度档 —— 同族、不同用途。
 * 石墨（sat 0）的 `color` 取的是 category-icon 的兜底灰，于是「选中灰」与「留空」渲出来
 * 一模一样（这条不变量从 M3 起就在，别改）。
 *
 * 排序即两个色板的格子顺序：**色相升序，石墨灰收尾**。相邻两格「不许看着一样」由
 * scripts/theme-repro.mjs 第 4.5 组守着（色相差 ≥ 20° 或 饱和度差 ≥ 0.25）。
 */

/** hsl → #rrggbb。色相取模到 [0,360)，s/l 为百分数。 */
export function hslToHex(h, s, l) {
	const hue = ((h % 360) + 360) % 360
	const sat = s / 100
	const lig = l / 100
	const c = (1 - Math.abs(2 * lig - 1)) * sat
	const hp = hue / 60
	const x = c * (1 - Math.abs((hp % 2) - 1))
	const m = lig - c / 2
	let r, g, b
	if (hp < 1) [r, g, b] = [c, x, 0]
	else if (hp < 2) [r, g, b] = [x, c, 0]
	else if (hp < 3) [r, g, b] = [0, c, x]
	else if (hp < 4) [r, g, b] = [0, x, c]
	else if (hp < 5) [r, g, b] = [x, 0, c]
	else [r, g, b] = [c, 0, x]
	const to = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')
	return '#' + to(r) + to(g) + to(b)
}

/** 相对亮度（sRGB，WCAG 口径）。 */
function luminance(hex) {
	const ch = [1, 3, 5].map((i) => {
		const v = parseInt(hex.substr(i, 2), 16) / 255
		return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
	})
	return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2]
}

/** 白字压在某个颜色上的对比度。 */
function contrastOnWhite(hex) {
	const a = luminance('#ffffff')
	const b = luminance(hex)
	return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/**
 * 某个色板色**作为主题主色**时用的 s / l。
 *
 * 主色 = **色板这一格的颜色本身**（同色相、同饱和度 —— 主题因此和图标底色一样鲜艳），
 * 只把亮度压到「白字读得清」（≥ 3.45）那一档：主色要托住「记一笔」按钮、tab 圆钮里那支笔。
 *
 * ★ 为什么必须按色相各给一档 s（2026-10-03 用户反馈「陶土、琥珀、玫红还是发灰」）：
 *   **HSL 的饱和度不是感知均匀的** —— 同一个 s 下，暖色（红/橙/黄/玫红）能给出的彩度
 *   远低于冷色。早先全表共用一个 s（照抄默认绿的设计值），于是绿蓝看着正常，红橙黄读成
 *   脏棕 / 脏玫瑰。现在每个色用自己那一档：暖色 35~40%、冷色 24~32%，正是色板里
 *   图标底色那几档 —— 主题与色板成了同一个浓度，只差亮度。
 */
function primaryOf(p) {
	const m = /hsl\(([\d.]+),\s*([\d.]+)%,\s*([\d.]+)%\)/.exec(p.color || '')
	if (!m) return { s: 0, l: 50 } // 石墨（十六进制）：无彩色，给一个中性档
	const h = +m[1]
	const sat = +m[2]
	let l = +m[3]
	while (l > 20 && contrastOnWhite(hslToHex(h, sat, l)) < 3.45) l -= 1
	return { s: sat, l }
}

/**
 * 10 个颜色。hue/sat 给主题，color 给图标底色。
 * 石墨的 key 沿用旧主题的 `graphite`；已选过它的设备靠 loadAccent 认 key，不受影响。
 */
const RAW = [
	{ key: 'green', name: '松绿', hue: 154.05, sat: 1, color: 'hsl(154, 28%, 44%)' },
	{ key: 'terracotta', name: '陶土', hue: 8, sat: 1, color: 'hsl(8, 40%, 50%)' },
	// 这一格换过四次，教训写在下面（全是用户一句「看着脏 / 太橙」逼出来的）：
	//   hue 33「琥珀」= #ab7f49 → 棕。**暗掉的橙就是棕**，怎么调都脏。
	//   hue 50「芥黄」= #98883a → 橄榄。**暗掉的黄就是橄榄**，同样脏。
	//   hue 30「蜜橘」= #e07000 → 用户说太橙。
	//   现为 hue 36 = #e58c06（蜜橘）：比橙黄一档，两行都还干净。
	// ★ 病根之一：前两版把**暖色的饱和度照抄了绿蓝那一档**（s≈40）。白字约束**只压亮度、
	//   不压饱和度** —— 橙黄在 l≈46 还能有 200 上下的彩度（那两版只有 98）。暖色要「干净」，
	//   得把饱和度顶上去，不是跟着冷色走。
	// ★ 病根之二（选档时看出来的）：**越往黄走，压深后的主色越偏橄榄**（hue 48 的色板很黄，
	//   但它的主色 #a5870d 是橄榄）—— 因为黄的明度高，为托住白字要压得更深。所以「再黄一点」
	//   有上限：hue 40 上下是「更黄」与「不脏」的交界，再往上就是上一版那条橄榄路。
	//   候选四档与截图见 docs/design/palette-candidates.mjs（本格选的是第 1 列 A）。
	{ key: 'amber', name: '蜜橘', hue: 36, sat: 1, color: 'hsl(36, 95%, 46%)' },
	{ key: 'olive', name: '苔绿', hue: 88, sat: 1, color: 'hsl(88, 26%, 46%)' },
	// 青碧的色相从 174 挪到 178：174 与松绿的 154.05 只差 19.9°，**刚好卡在
	// theme-repro 第 4.5 组那条「≥ 20°」的线下**（门当场就报了出来）。松绿的色相是
	// 默认主题逐 token 复现的基准，不能动，所以挪这一格。
	{ key: 'teal', name: '青碧', hue: 178, sat: 1, color: 'hsl(178, 28%, 42%)' },
	{ key: 'blue', name: '靛蓝', hue: 213, sat: 1, color: 'hsl(213, 32%, 56%)' },
	{ key: 'iris', name: '鸢尾', hue: 255, sat: 1, color: 'hsl(255, 28%, 58%)' },
	{ key: 'wisteria', name: '紫藤', hue: 292, sat: 1, color: 'hsl(292, 24%, 56%)' },
	{ key: 'rose', name: '玫红', hue: 340, sat: 1, color: 'hsl(340, 35%, 58%)' },
	// 石墨：唯一的非彩色。color 就是 category-icon 的兜底灰（见文件头）
	{ key: 'graphite', name: '石墨', hue: 0, sat: 0, color: '#8A958E' }
]

/**
 * 10 个颜色，每个再挂一个 `primary`（主色的 s/l，见 primaryOf）。
 * `sat` 留着：石墨靠它把整套 token 压成灰；将来若要「低饱和」档也用得上。
 * ⚠ 现在 10 个里只有石墨的 sat 不是 1 —— 曾经的「灰调」档（陶土/苔绿 0.5）因为
 *   用户反馈「发灰」已撤：灰不灰由色相那一档 s 决定，不是靠整体降饱和。
 */
export const PALETTE = RAW.map((p) => ({ ...p, primary: primaryOf(p) }))

/** 10 个可选的图标底色（分类 / 账户 / 子分类）——**就是上面那 10 个的 color**。 */
export const PALETTE_COLORS = PALETTE.map((p) => p.color)

/** 按 key 取色板颜色。预置分类/账户的种子色用它，避免在那两张表里重抄一遍色值。 */
export function paletteColor(key) {
	const p = PALETTE.find((x) => x.key === key)
	return p ? p.color : ''
}
