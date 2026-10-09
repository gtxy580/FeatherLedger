/**
 * 日历网格的纯计算（月历 / 年历）、格子里的短金额、按天聚合。
 *
 * 为什么单独成一个模块：网格形状（6 行 × 7 列、含前后月）、跨年归属、闰年月长、
 * 同一天多笔的累加 —— 全是要"算对"的东西。写在页面里就只能靠真机一张张点，
 * 抽成纯函数才验得动（这个理由与 services/lazy.js 同一条）。
 */

/** 'YYYY-MM-DD'，月日都补零（排序按字符串比，缺一个零就会排错位） */
function dayKey(y, m, d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${y}-${p(m)}-${p(d)}`
}

/** 今天，'YYYY-MM-DD'。日历上画"今天"那一圈要用它，两个页面都要 */
export function todayKey() {
  const d = new Date()
  return dayKey(d.getFullYear(), d.getMonth() + 1, d.getDate())
}

/** 某年某月的天数。★ 用 Date 的"第 0 天 = 上月末"来取，闰年自然正确 */
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

/**
 * 月历的格子（每行 7 格），从**该月 1 日所在那一周的周一**开始。
 *
 * ★ 只铺到**够用的行数**（4~6 行），不强行补成 6 行 —— 用户裁定：能 5 行就 5 行。
 *   5 行那种末尾不再拖一整行淡灰的"下个月"。
 *   代价是要自己保证"整块高度不变"，否则点 › 翻月时弹层会跳 —— 那件事交给
 *   cellHeight()：行数少了格子就长高，总高恒等。
 * 周一开头是中文习惯（与页面里「一 二 三 … 日」的表头一致）。
 */
export function monthCells(year, month) {
  // getDay(): 0=周日 … 6=周六 → 换算成"周一起算"的 0..6
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7
  const rows = Math.ceil((lead + daysInMonth(year, month)) / 7) // 4 / 5 / 6
  const out = []
  for (let i = 0; i < rows * 7; i++) {
    const d = new Date(year, month - 1, 1 - lead + i)
    out.push({
      key: dayKey(d.getFullYear(), d.getMonth() + 1, d.getDate()),
      day: d.getDate(),
      inMonth: d.getFullYear() === year && d.getMonth() + 1 === month
    })
  }
  return out
}

/**
 * 月历格子之间的间隙（rpx）。
 * ⚠ 与 `.pc-grid` 的 `gap` 是**同一个数**，改一个就要改另一个（那边注释里也写了这句）。
 */
export const CELL_GAP = 6

/** 整块月历的高度（rpx）= 6 行 × 104 + 5 × 6。行数变，它不变 */
const GRID_H = 654

/**
 * 月历格子该多高（rpx）。
 *
 * ★ 行数少了，格子就**长高**，整块高度始终是 GRID_H —— 于是翻月时弹层不跳
 *   （"不跳"这件事原先靠"永远铺 6 行"来保证，现在改成靠这条式子）。
 *   4/5/6 行分别得到 159 / 126 / 104rpx。
 */
export function cellHeight(rows) {
  return Math.floor((GRID_H - (rows - 1) * CELL_GAP) / rows)
}

/** 年历的 12 个格子，key 与年视图的 groups 同一个形状（'YYYY-MM'） */
export function yearCells(year) {
  const p = (n) => String(n).padStart(2, '0')
  return Array.from({ length: 12 }, (_, i) => ({ key: `${year}-${p(i + 1)}`, month: i + 1 }))
}

/**
 * 页面把「某一天的数」喂给日历时，该挂在哪把 key 上。
 *
 * ★ 必须与**格子的 key 同形**：月态按天（'YYYY-MM-DD'）、年态按月（'YYYY-MM'）。
 *   两边不同形的后果是**整片空白** —— 键一辈子也配不上格子，而且一声不吭
 *   （预付历史的年视图就这么空过一次：它按天累加，年态的格子却在问'YYYY-MM'）。
 */
export function gridKeyOf(date, isYear) {
  return isYear ? String(date).slice(0, 7) : String(date)
}

/**
 * 格子里的短金额。格宽只有 ~80rpx，`-128.00` 放不下，所以**不能照用 fmtYuan**。
 *
 * 绝对值 < 1 万元 → 整数元（`128`）；≥ 1 万元 → 一位小数的「万」（`1.3万`）。
 * 0 给**空串**：没记账的格子和"那天正好收支相抵"在这件事上都是"没有可看的数"，
 * 画个 `0` 只会让人以为记过账。
 *
 * ★ **不给符号**：一格现在分两行（「支 128」/「收 80」），正负由**标签**说，不由符号说 ——
 *   所以负数也只给量值。（早先一格只画净额，那时才需要那个正负号。）
 * ★ 判定要在**取整之后**做：不足半元（如支 49.60）四舍五入也是 0，按取整前的 `!n` 判会漏过去。
 */
export function cellAmount(cents) {
  const n = Math.abs(Number(cents) || 0)
  if (!n) return ''
  const yuan = n / 100
  if (yuan >= 10000) {
    const w = yuan / 10000
    // 一位小数；正好整数就不拖 `.0`（`2万` 比 `2.0万` 干净）
    const s = w >= 100 ? String(Math.round(w)) : String(Math.round(w * 10) / 10)
    return `${s}万`
  }
  const y = Math.round(yuan) // 先取整，再判是不是 0（见上面那段注释）
  if (!y) return ''
  return String(y)
}

/**
 * 格子上的一行：「支 128」/「收 80」。
 *
 * 没数（或不足半元）给**空串** —— 不是「支 0」，也不是半截子「支 」（那个尾巴空格很难看）。
 * 标签由调用方给，因为它们是要给人看的话（月态年态一样，但换个说法就换这里）。
 */
export function cellLine(label, cents) {
  const s = cellAmount(cents)
  return s ? `${label} ${s}` : ''
}

/** 本月的 'YYYY-MM' —— 「不能翻到未来」比的就是它 */
export function currentPeriod() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * 这一格是不是**还没到** —— 还没到的格子不给选（与 › 置灰同一条裁定）。
 *
 * 两态传的 `now` 不同，但问的是同一句话：
 *   月态 now = **今天**（'YYYY-MM-DD'）→ 今天之后的每一天都算，所以"本月内今天之后"
 *     那几天也拦（它们点下去只会关掉弹层、什么也不跳）
 *   年态 now = **本月**（'YYYY-MM'）→ 本月之后的每一月都算
 * 两种格式都补了零，字典序就是时间序，字符串比大小即可。
 *
 * ⚠ 两边的格式必须同形：月态比日、年态比月，混着传（拿 'YYYY-MM' 去比 'YYYY-MM-DD'）
 *   会得出「全都还没到」或「全都到了」。
 */
export function isFuture(key, now) {
  return String(key) > String(now)
}

/**
 * 还能不能往后翻一期。
 *
 * 「不能切到未来」这条裁定原本在三个地方各写了一遍（首页 ›、预付历史 ›、日历弹层的 ›），
 * 三份实现迟早走散 —— 而且日历那一份必须换一种写法：它手上是**数字**的年月（year/month），
 * 页面手上是 'YYYY-MM' 字符串。抽成一条，两边都调它。
 *
 * 月态两边都补零，按字符串比就够了（'2025-12' < '2026-10'）；年态直接比年。
 *
 * @param {{year: number, month?: number}} period 月态的 month 是 1..12
 * @param {boolean} isYear
 * @param {Date} now 只在断言里传，生产代码用当下
 */
export function canGoForward(period, isYear, now = new Date()) {
  if (isYear) return period.year < now.getFullYear()
  const p = (n) => String(n).padStart(2, '0')
  return `${period.year}-${p(period.month)}` < `${now.getFullYear()}-${p(now.getMonth() + 1)}`
}

/**
 * 按 key 聚成**收 / 支两笔**（不是一个净额）—— 日历格子上收、支是分两行显示的。
 *
 * `valueOf` 给的是**有符号**的一笔：正数进支出、负数进收入。
 * 预付那边天然就是这个形状：`remaining` 为正 = 还没报回来、为负 = 多收回来的。
 *
 * ★ 值为 0 的行**也要落键**：那天确实有一笔（比如差额为 0 的结清），日历上就该点得动 ——
 *   「这一格有没有东西」看的是键在不在，不是数大不大。
 *
 * @param {Array} rows
 * @param {(row) => string} keyOf    取那一行的 key
 * @param {(row) => number} valueOf  取那一行的数（分，有符号）
 * @returns {Object<string, {income: number, expense: number}>} 两个都是正数
 */
export function sumByKey(rows, keyOf, valueOf) {
  const out = {}
  for (const r of rows) {
    const k = keyOf(r)
    if (!k) continue // 没有 key 的行直接跳过，免得落进一个 undefined 键
    const v = Number(valueOf(r)) || 0
    const cell = out[k] || (out[k] = { income: 0, expense: 0 })
    if (v > 0) cell.expense += v
    else if (v < 0) cell.income += -v
  }
  return out
}
