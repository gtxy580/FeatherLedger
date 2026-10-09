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
 * 月历的 42 个格子（6 行 × 7 列），从**该月 1 日所在那一周的周一**开始。
 *
 * 固定 42 格而不是"够用就少一行"：弹层高度因此恒定，点 › 翻月时不会跳。
 * 代价是有的月份第 6 行整行都是淡灰的 —— 可接受。
 * 周一开头是中文习惯（与页面里「一 二 三 … 日」的表头一致）。
 */
export function monthCells(year, month) {
  // getDay(): 0=周日 … 6=周六 → 换算成"周一起算"的 0..6
  const lead = (new Date(year, month - 1, 1).getDay() + 6) % 7
  const out = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month - 1, 1 - lead + i)
    out.push({
      key: dayKey(d.getFullYear(), d.getMonth() + 1, d.getDate()),
      day: d.getDate(),
      inMonth: d.getFullYear() === year && d.getMonth() + 1 === month
    })
  }
  return out
}

/** 年历的 12 个格子，key 与年视图的 groups 同一个形状（'YYYY-MM'） */
export function yearCells(year) {
  const p = (n) => String(n).padStart(2, '0')
  return Array.from({ length: 12 }, (_, i) => ({ key: `${year}-${p(i + 1)}`, month: i + 1 }))
}

/**
 * 格子里的短金额。格宽只有 ~80rpx，`-128.00` 放不下，所以**不能照用 fmtYuan**。
 *
 * 绝对值 < 1 万元 → 整数元（`-128` / `+80`）；≥ 1 万元 → 一位小数的「万」（`-1.3万`）。
 * 0 给**空串**：没记账的格子和"那天正好收支相抵"在这件事上都是"没有可看的数"，
 * 画个 `+0` 只会让人以为记过账。
 *
 * ★ 判定要在**取整之后**做：不足半元（如收 50.00 支 49.60，净 0.40 元）四舍五入也是 0，
 *   按取整前的 `!n` 判会漏过去，画出一个 `+0` / `-0`。`-0` 尤其荒唐。
 */
export function cellAmount(cents) {
  const n = Number(cents) || 0
  if (!n) return ''
  const sign = n < 0 ? '-' : '+'
  const yuan = Math.abs(n) / 100
  if (yuan >= 10000) {
    const w = yuan / 10000
    // 一位小数；正好整数就不拖 `.0`（`2万` 比 `2.0万` 干净）
    const s = w >= 100 ? String(Math.round(w)) : String(Math.round(w * 10) / 10)
    return `${sign}${s}万`
  }
  const y = Math.round(yuan) // 先取整，再判是不是 0（见上面那段注释）
  if (!y) return ''
  return `${sign}${y}`
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
 * 按天聚合：`{ 'YYYY-MM-DD': 合计 }`。
 *
 * 两个页面的数据形状不同（首页是"按天分好组的对象"、预付历史是"一堆带日期的行"），
 * 但"**同一天的多笔要累加**"这条是一样的 —— 差别只在怎么取日期、取哪个数，
 * 所以两个都靠回调传进来，免得在页面里各写一遍循环（写两遍就迟早走散）。
 *
 * @param {Array} rows
 * @param {(row) => string} keyOf    取那一行的日期
 * @param {(row) => number} valueOf  取那一行要累加的数（分）
 */
export function sumByDay(rows, keyOf, valueOf) {
  const out = {}
  for (const r of rows) {
    const k = keyOf(r)
    if (!k) continue // 没有日期的行直接跳过，免得落进一个 undefined 键
    out[k] = (out[k] || 0) + (Number(valueOf(r)) || 0)
  }
  return out
}
