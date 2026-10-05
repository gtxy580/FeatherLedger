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
