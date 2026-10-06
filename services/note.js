/**
 * services/note.js —— 高频备注候选的匹配与排序（纯函数，无 I/O）
 *
 * 记一笔页的备注框用它：敲一个「水」，「水电费」这类常用备注就摆出来点一下。
 *
 * 数据由 services/record.js 的 getNoteStats() 聚合好（每个备注用过几次、最后一次哪天、
 * 在哪些分类下用过），这里只负责**怎么筛、怎么排**。分成两层是有意的：排序最容易出那种
 * 「顺序有点怪」的毛病 —— 没人会为此报 bug，只会觉得不好用 —— 而它是纯计算，落在这一层
 * 就能用断言钉死（见 scripts/note-repro.mjs）。
 *
 * ★ 排序是**分层比较**，不是加权求和。加权求和的系数调起来说不清（凭什么 7 年之痒是 3 分
 *   而不是 5 分），而分层的每一层都能单独解释、也能单独断言。
 */

/** 「最近用过」的加成：7 天内抵得上多用 3 次，30 天内抵 1 次 */
const BONUS_WEEK = 3
const BONUS_MONTH = 1

/**
 * 两个 'YYYY-MM-DD' 差几天（to 晚于 from 时为正）。
 * 走 UTC —— 用本地时间会在夏令时那天变成 23 或 25 小时，取整后正好差一天。
 * 认不出的日期返回 null：理论上不会有，但别让一个脏值毁掉整个排序。
 */
function daysBetween(from, to) {
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))
  if (!isDate(from) || !isDate(to)) return null
  const [ay, am, ad] = from.split('-').map(Number)
  const [by, bm, bd] = to.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
}

/**
 * 从聚合好的备注里挑候选。分层（前者优先，相等才看下一层）：
 *   ① 前缀命中 > 仅仅包含命中
 *   ② 在当前分类（含它的子分类）下用过 > 没在这个分类下用过
 *   ③ 使用次数 + 最近加成
 *   ④ 最后使用日期（只影响并列时的先后，让结果稳定、不随数组顺序漂）
 *
 * @param {Array<{note: string, count: number, lastUsed: string, cids: number[]}>} rows
 *   getNoteStats() 的返回
 * @param {Object} p
 * @param {string} p.keyword 用户已经敲进去的字
 * @param {Set<number>|number[]|null} [p.treeIds] 当前选中分类的子树 id；没选分类时传 null
 * @param {string} p.today 今天 'YYYY-MM-DD' —— 由调用方给，否则测试里会随真实日期漂
 * @param {number} [p.limit] 最多给几条，默认 5
 * @returns {string[]} 备注文字，按顺序
 */
export function buildSuggestions(rows, { keyword, treeIds, today, limit = 5 }) {
  const kw = String(keyword == null ? '' : keyword).trim()
  // 没输入就不出候选 —— 一聚焦就弹一屏东西是骚扰，不是帮忙
  if (!kw) return []
  const lower = kw.toLowerCase()
  const tree = treeIds instanceof Set ? treeIds : treeIds ? new Set(treeIds) : null

  const scored = []
  for (const r of rows || []) {
    const note = String((r && r.note) || '')
    if (!note) continue
    const low = note.toLowerCase()
    const prefix = low.startsWith(lower)
    if (!prefix && !low.includes(lower)) continue
    // 这几个字已经敲完了，没必要再提示它自己（用小写比，英文备注也一样）
    if (low === lower) continue

    const days = daysBetween(r.lastUsed, today)
    const bonus = days == null ? 0 : days <= 7 ? BONUS_WEEK : days <= 30 ? BONUS_MONTH : 0
    scored.push({
      note,
      prefix: prefix ? 1 : 0,
      sameCat: tree && (r.cids || []).some((id) => tree.has(Number(id))) ? 1 : 0,
      power: (Number(r.count) || 0) + bonus,
      lastUsed: String(r.lastUsed || '')
    })
  }

  scored.sort(
    (a, b) =>
      b.prefix - a.prefix ||
      b.sameCat - a.sameCat ||
      b.power - a.power ||
      b.lastUsed.localeCompare(a.lastUsed)
  )
  return scored.slice(0, limit).map((x) => x.note)
}
