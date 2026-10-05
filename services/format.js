/**
 * services/format.js —— 共享的显示格式化
 *
 * 金额一律手写字符串拼接，**不得**用 toLocaleString 的位数选项：
 * 真机 webview 会静默忽略 minimumFractionDigits 等参数（M3.5 踩过，100 会显示成 "100"）。
 */

/**
 * 百分数格式化：恒两位小数（用户裁定：20% 也要显示成 20.00%）
 * @param {number} v 已经是「百分数」单位的数值（20.5 表示 20.5%）
 * @returns {string} 如 '20.00%'、'12.35%'；非有限数返回 '—'
 */
export function fmtPercent(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return n.toFixed(2) + '%'
}

/**
 * 分 → 元字符串：千分位 + 恒两位小数
 * @param {number} cents 金额（分），可为负
 * @returns {string} 如 '1,234.50'、'-0.50'
 */
export function fmtYuan(cents) {
  const [int, dec] = (Math.abs(Number(cents) || 0) / 100).toFixed(2).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return (cents < 0 ? '-' : '') + grouped + '.' + dec
}

/**
 * 分 → 元**紧凑**字符串，用于坐标轴标签（如 '0'、'1250'、'1.2万'）。
 * 坐标轴放不下 '1,250.00' 这种带千分位与两位小数的形式；这里只保留读数所需的精度。
 * @param {number} cents 金额（分）
 */
export function fmtYuanShort(cents) {
  const yuan = (Number(cents) || 0) / 100
  if (!Number.isFinite(yuan)) return '0'
  if (Math.abs(yuan) >= 10000) return Math.round((yuan / 10000) * 10) / 10 + '万'
  return String(Math.round(yuan))
}

/**
 * 元直输串 → 分（整数）。**金额一律以分入库，浮点只在这里出现一次。**
 *
 * 用户在键盘上敲的是元（'25.5'），而且随时可能是半成品（'0.'、''）—— 所以按
 * 「解析不出来就是 0」处理。金额、手续费、加减算式共用它，免得每处各写一遍 ×100。
 * 允许负值：25 − 30 这种中间结果要留得住，保存前才拦（页面的提示比键盘上的拦更清楚）。
 *
 * @param {string|number} v 元
 * @returns {number} 分（整数）
 */
export function yuanToCents(v) {
  const n = typeof v === 'number' ? v : parseFloat(v)
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100)
}

/**
 * 金额太长时该缩到几成（记一笔页的金额 / 手续费字号用它）。
 *
 * 估宽用的是「等宽数字」（这两行都带 .num）：宽 ≈ 字数 × 字号 × 系数。
 * 系数取 0.65 偏大 —— 估小了只是白缩一号，估大了就会把「转账金额」这种标题挤成两行
 * （真机反馈过），所以宁可保守。
 *
 * @param {number} chars 显示出来的字符数（含千分位与小数点）
 * @param {number} baseRpx 这一行的基准字号
 * @param {number} boxRpx 这一行留给数字的宽度
 * @param {number} minScale 下限（再长也不缩过它）
 * @returns {number} 0~1（放得下就是 1，删掉几位就恢复）
 */
export function fitAmountScale(chars, baseRpx, boxRpx, minScale) {
  const n = Number(chars) || 0
  if (!n || !(boxRpx > 0) || !(baseRpx > 0)) return 1
  const need = n * baseRpx * 0.65
  if (need <= boxRpx) return 1
  return Math.max(minScale, boxRpx / need)
}

/**
 * 把一个操作数与符号接进算式片段（记一笔页的 + / − 键用它）。
 *
 * 三种情形，**全靠「这一笔输没输」区分**：
 *  · 输了数：接在已有片段后面 —— **上一次的符号必须留着**（8 + 5 之后按 + 要变成
 *    「8 + 5 +」；把上一次那个 + 吞掉是真实踩过的 bug），再挂上新符号；
 *  · 没输数但有片段：把挂着没落地的那个符号换掉（连点两个符号 = 改主意）；
 *  · 什么都没有：按 0 起（算式里写「0 +」，与金额栏显示的 0.00 对得上）。
 *
 * 抽成纯函数的原因很直接：这段判断**连续两轮出过错**，而它在页面里，
 * 脚本只盖得住 format.js 这一侧。
 *
 * @param {string[]} terms 已有片段（数与符号交替）
 * @param {string} v 这一笔（用户敲的原串；空串 = 还没输）
 * @param {string} op '+' 或 '-'
 * @returns {string[]} 新片段
 */
export function pushTerm(terms, v, op) {
  const t = terms || []
  if (v) return t.concat([v, op])
  if (t.length) return t.slice(0, -1).concat(op)
  return ['0', op]
}

/**
 * 算式片段 → 累计（分）。「加减算式」（记一笔页）用它把算式折成一个数。
 *
 * 片段是「数、符号、数、符号…」，数与符号都存**用户敲的原串**（算式按实际位数显示）——
 * 最后一片可能是还没落地的符号（'8','+','5','+' 里的末尾那个），**不算它**。
 * **从左往右**算，与计算器一致：这一页只做加减，没有优先级问题，
 * 写成「先乘除后加减」反而会与屏幕上那行算式的读法不符。
 * 走 yuanToCents 解析，与金额栏同一把尺（整数分，不吃浮点误差）。
 *
 * @param {string[]} terms 数与符号交替
 * @returns {number} 分
 */
export function sumTerms(terms) {
  let acc = 0
  let sign = 1
  for (const t of terms || []) {
    if (t === '+' || t === '-') sign = t === '+' ? 1 : -1
    else acc += sign * yuanToCents(t)
  }
  return acc
}

/**
 * 时刻 → 滚轮那两列的下标 [时, 分]。
 *
 * 用户裁定改滚动条之后（见 [[ledger-app-project-status]] 的时刻条目），这是
 * **库里的 'HH:MM' 与滚轮之间唯一的转换**：回填老流水、取滚轮当前值都走它。
 * 两列的取值就是 0~23 / 0~59，下标即值，所以这里只做「拆」与「兜底」。
 * 认不出来（没有时刻的老流水、脏值）一律回 [0, 0] —— 滚轮总得停在一处。
 *
 * @param {string} time 'HH:MM'
 * @returns {number[]} [时, 分]
 */
export function timeIndexes(time) {
  const m = /^(\d{1,2}):(\d{1,2})$/.exec(String(time == null ? '' : time).trim())
  if (!m) return [0, 0]
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 23 || mi > 59) return [0, 0]
  return [h, mi]
}

/**
 * 滚轮两列 → 规范 'HH:MM'（`timeIndexes` 的反向，时刻卡片的「确定」用它）。
 * 超出范围的值夹回该列上界：滚轮里本不该有，但别信输入 ——
 * 库里只认归一后的 'HH:MM'（展示、排序、备份校验都以那个形状为前提，
 * 排序尤其吃它：'9:30' 与 '09:30' 按字符串比会排错位）。
 *
 * @param {number[]} idx [时, 分]
 * @returns {string} 'HH:MM'
 */
export function timeFromIndexes(idx) {
  const h = Math.min(23, Math.max(0, Math.trunc(Number((idx && idx[0]) || 0))))
  const m = Math.min(59, Math.max(0, Math.trunc(Number((idx && idx[1]) || 0))))
  return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0')
}

/**
 * 此刻的 'HH:MM'（24 小时制）—— 记一笔页「时刻」的默认值（用户裁定：默认记账时间）。
 * 与 db.js 的 now() 同源：都读本机时钟，本应用没有时区/联网概念。
 */
export function hhmmNow() {
  const d = new Date()
  return timeFromIndexes([d.getHours(), d.getMinutes()])
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/**
 * 按天分组头的文案：'2026-10-01' → '10月01日 周四'。
 *
 * 从 pages/index/index.vue 搬来 —— 「分类明细」页要用同一套分组头。搬家的意义就在这里：
 * 留在页面里就只能靠真机看，而「月不补零、日补零」这种细节各写一遍就会慢慢走散。
 */
export function dayLabel(dateStr) {
  const [y, m, d] = String(dateStr).split('-').map(Number)
  const wd = WEEKDAYS[new Date(y, m - 1, d).getDay()]
  return `${m}月${String(d).padStart(2, '0')}日 周${wd}`
}

/** 按月分组头的文案：'2026-09' → '2026年9月'（月不补零，与 dayLabel 同规）。年报视图与分类明细的年粒度分组用它 */
export function monthLabel(monthStr) {
  const [y, m] = String(monthStr).split('-').map(Number)
  return `${y}年${m}月`
}

/**
 * 分类标题：有父分类就带上，`餐饮-早餐`。
 *
 * 分类明细页的页头用它 —— 只写「早餐」用户看不出它属于哪一支，也没法跟占比条上那根
 * 「餐饮-早餐」的条对上。与占比条「子分类视角」的标签同规。
 *
 * @param {string} name 分类自己的名字
 * @param {string} parentName 父分类名（自己是主分类、或父已被删时为空）
 * @param {boolean} [direct] 这一行是不是「没选子分类、直接记在主分类上」的那一笔。
 *   只在**子分类视角**下才该为 true —— 那时占比条上会并列出现「餐饮-直接记账」，
 *   页头得跟着写同一个标签才认得出来。父分类反倒不加这个后缀（它没有歧义）。
 *   函数自己把关：即使传了 true，只要有父名就仍按「父-自己」拼，不会拼出「早餐-直接记账」。
 * @returns {string} 父名缺失或自己没有名字时，退回写得出的一半，绝不拼出「餐饮-」这种半截
 */
export function catLabel(name, parentName, direct) {
  const n = String(name || '')
  const p = String(parentName || '')
  if (n && !p && direct) return `${n}-直接记账`
  if (p && n) return `${p}-${n}`
  return n || p
}

/**
 * 期间文案：由「粒度 + 起止日」现算 —— '2026年10月' / '2026年' / '2026.9.28-10.4'。
 *
 * 与 stats-panel 的 `labelOf(gran, anchor)` 产出的**是同一个字符串**（那处现在也走这里，
 * 所以只有这一个来源）。之所以要能「现算」：分类明细页原先靠 URL 把这段中文传给目标页，
 * 而 **uni-app 在 App 端不会自动解码 query**（本仓此前所有 navigateTo 都只传数字 id，
 * 没有先例可参照）—— 页头于是显示成 %E5%B9%B4… 这类。改成从 ASCII 参数现算之后，
 * 这一类问题整体消失，不必再猜框架在每一端到底解不解码。
 *
 * 周报那一档跟日历一致：**同年省略尾部年份**（`2026.9.28-10.4`），跨年才补
 * （`2025.12.29-2026.1.4`）；月日**都不补零** —— 一行里放得下才是目的（用户裁定）。
 *
 * @param {'week'|'month'|'year'} gran 粒度
 * @param {string} start 'YYYY-MM-DD'
 * @param {string} [end] 'YYYY-MM-DD'（周报要用；月/年只从 start 推）
 * @returns {string} 参数不齐全时返回空串（宁可少显示一行，也不抛给页面）
 */
export function periodText(gran, start, end) {
  const s = String(start || '').split('-').map(Number)
  if (s.length !== 3 || s.some((n) => !Number.isFinite(n))) return ''
  const [y, m, d] = s
  if (gran === 'year') return `${y}年`
  if (gran === 'month') return `${y}年${m}月`
  if (gran !== 'week') return ''
  const e = String(end || '').split('-').map(Number)
  if (e.length !== 3 || e.some((n) => !Number.isFinite(n))) return ''
  const head = `${y}.${m}.${d}`
  return e[0] === y ? `${head}-${e[1]}.${e[2]}` : `${head}-${e[0]}.${e[1]}.${e[2]}`
}
