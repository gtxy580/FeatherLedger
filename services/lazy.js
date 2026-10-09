/**
 * 流水列表懒加载 —— 首页与分类明细共用的一份切片逻辑。
 *
 * ★ 为什么**只按页渲染、不按页查询**：页头的合计、每组的小计都要全量数据才算得对，
 *   拿当前这一页反推出来的数字只会跟列表对不上（用户看到的就是「算错了」）。
 *   本地 SQLite 查几千行本来就快，真机上卡的是**渲染** —— 那么多 view 节点。
 *   所以查询照旧全量，切的是交给模板的那一段。
 *
 * ★ 数的是**流水条数**、不是分组数：年视图里一个月能压着几百笔，
 *   按组分批等于没分；按条数封顶，首屏节点数才与「这期记了多少笔」无关。
 */

/**
 * 从头往下数够 rows 条就停，末尾那一组允许只取一部分。
 *
 * 组头的小计不受截断影响 —— 它挂在分组对象上，切的是 `records` 这一层。
 * 空组（`records` 为空）不会被算进 shown，但照样会被推出去（它自带组头要显示）。
 *
 * @param {Array<{key: string, records: Array}>} groups 全量分组
 * @param {number} rows 这一轮渲染到第几条
 * @returns {{groups: Array, shown: number, more: boolean}} 切出来的分组、已渲染条数、还有没有剩
 */
export function sliceGroups(groups, rows) {
  const n = Number(rows) || 0
  const out = []
  let left = n
  for (const g of groups) {
    if (left <= 0) break
    if (g.records.length <= left) {
      out.push(g)
      left -= g.records.length
    } else {
      out.push({ ...g, records: g.records.slice(0, left) })
      left = 0
    }
  }
  let shown = 0
  let total = 0
  for (const g of groups) total += g.records.length
  for (const g of out) shown += g.records.length
  return { groups: out, shown, more: shown < total }
}
