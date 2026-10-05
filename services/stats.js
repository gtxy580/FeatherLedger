/**
 * services/stats.js —— 统计的纯计算（无 I/O，无 plus.*）
 *
 * 数据层只出一条「按分类分组的平铺行」，两个层级视角在这里折算：
 *   主分类视角 = 子分类金额上卷到父
 *   子分类视角 = 按父分组，主分类「直接记账」的那行单独摆出来
 * 两个视角读同一批行，所以「主分类合计 == 子分类合计」是结构保证，不是靠两边同步。
 */

/** 平铺行 → 顶层 id（父优先；无父用自己；分类已删时两者皆空 → 'orphan'） */
function topKeyOf(r) {
  if (r.pId != null) return String(r.pId)
  if (r.cid != null) return String(r.cid)
  return 'orphan'
}

/**
 * 主分类视角：把子分类金额上卷到主分类。
 * @param {Array} rows getCategoryStats 的返回
 * @returns {Array<{id, name, icon, color, amount, count}>} 按 amount 降序
 */
export function foldToTop(rows) {
  const groups = new Map()
  for (const r of rows) {
    const key = topKeyOf(r)
    let g = groups.get(key)
    if (!g) {
      const useParent = r.pId != null
      g = {
        id: useParent ? r.pId : r.cid,
        name: useParent ? r.pName || '已删除分类' : r.name,
        icon: useParent ? r.pIcon : r.icon,
        color: useParent ? r.pColor : r.color,
        amount: 0,
        count: 0
      }
      groups.set(key, g)
    }
    g.amount += r.amount
    g.count += r.count
  }
  return [...groups.values()].sort((a, b) => b.amount - a.amount)
}

/**
 * 子分类视角：平铺成一行一个分类，标签带上主分类前缀。
 *   子分类        → 「主分类名-子分类名」
 *   主分类直接记账 → 「主分类名-直接记账」
 *   分类已删       → 「已删除分类」（它既不是父也不是子，不加后缀）
 * 不做分组、不做缩进——用户裁定「子分类占比不需要展开」。
 * @param {Array} rows getCategoryStats 的返回
 * @returns {Array} 在原行基础上加 label/icon/color 三个展示字段，按 amount 降序
 */
export function flatSubRows(rows) {
  const out = rows.map((r) => {
    if (r.pId != null) {
      // 子分类：图标只用自己——为空时由 category-icon 退回名称首字（全 app 的既有约定），
      // 不要回退主分类的图标，否则「早餐」会显示成主分类的餐具图标，反而丢信息。
      // 颜色则跟随主分类（同样是既有约定）。
      return { ...r, label: `${r.pName || '已删除分类'}-${r.name}`, icon: r.icon, color: r.color || r.pColor }
    }
    if (r.cid != null) {
      return { ...r, label: `${r.name}-直接记账`, icon: r.icon, color: r.color }
    }
    return { ...r, label: r.name, icon: r.icon, color: r.color }
  })
  return out.sort((a, b) => b.amount - a.amount)
}

/**
 * 期间摘要：本期合计 / 日均 / 较上期变动。
 *
 * 纯函数、不碰库 —— 面板把**已经拉回来的**本期与上期桶直接喂进来（趋势折线用的就是
 * 这两份数据，所以这三项不额外查库）。
 *
 * 日均的分母是**已过天数**而不是整期天数：当期还没结束时（10 月 3 号看月报），除以 31
 * 只会得到「这个月花得很少」的假象，除以 3 才回答得了「照这个速度这个月大约多少」。
 * 过去的期 today 已越过期尾，自然退化成整期天数。
 *
 * @param {Object} p
 * @param {Array<{amount:number}>} p.trend 本期各桶（getTrendStats 的返回，桶已补全）
 * @param {Array<{amount:number}>} p.prevTrend 上期各桶
 * @param {string} p.start 期初 'YYYY-MM-DD'
 * @param {string} p.end 期末 'YYYY-MM-DD'（含）
 * @param {string} p.today 今天 'YYYY-MM-DD'
 * @returns {{total:number, prevTotal:number, delta:number, dir:'up'|'down'|'flat', days:number, daily:number}}
 *   金额均为分；daily 也取整到分
 */
export function summarizePeriod({ trend, prevTrend, start, end, today }) {
	const sum = (rows) => rows.reduce((n, r) => n + r.amount, 0)
	const total = sum(trend)
	const prevTotal = sum(prevTrend)
	const delta = total - prevTotal

	// 两个 'YYYY-MM-DD' 差几天。走 UTC —— 用本地时间会在夏令时那天变成 23 或 25 小时，
	// 除法取整后正好差一天。
	const dayDiff = (a, b) => {
		const [ay, am, ad] = a.split('-').map(Number)
		const [by, bm, bd] = b.split('-').map(Number)
		return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
	}

	// 今天在期后 → 算到期末；今天在期内 → 算到今天；今天还在期前 → 0 天（不除零）
	const last = today < end ? today : end // 同格式字符串，字典序即时间序
	const days = today < start ? 0 : dayDiff(start, last) + 1

	return {
		total,
		prevTotal,
		delta,
		dir: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
		days,
		daily: days > 0 ? Math.round(total / days) : 0
	}
}
