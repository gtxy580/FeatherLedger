/**
 * services/focus-day.js —— 「刚存了一笔，回首页时把那一天聚出来」那张便条。
 *
 * 为什么要有它：记一笔保存后走的是 `uni.navigateBack()`，而 **navigateBack 带不了参数**；
 * tabBar 那条路又可能是 switchTab（一样带不了）。所以只能另找一条路，把"刚存的那天"
 * 从记一笔传回首页。
 *
 * 为什么不用 storage：那是**跨会话**的 —— 存下去之后哪怕当时没回首页，过一天打开
 * 也可能冷不丁跳一下。这张便条只活在这次会话里，而且取走即清。
 *
 * 为什么是模块单例而不是事件总线：本仓没有用过 uni.$emit/$on，而"跨页共享的一个
 * 小状态"这里已有先例（db.js 就是模块单例，App 端逻辑层全页面共用一份）。
 *
 * 用法（只有记一笔写、只有首页读）：
 *   setFocusDay('2026-10-09')   // 保存成功后
 *   takeFocusDay()              // 首页 onShow：拿到就清掉，拿不到给 ''
 */
let day = ''

/** 记下「刚存的那一天」（'YYYY-MM-DD'）。传空串 / null = 清掉 */
export function setFocusDay(date) {
  day = String(date || '')
}

/**
 * 取走并清掉。
 * ★ **一次性**：连着取两次，第二次一定是空的 —— 不然首页每次 onShow
 *   （切 tab、从别的页回来）都会再跳一次。
 * @returns {string} 'YYYY-MM-DD'；没有就给空串
 */
export function takeFocusDay() {
  const d = day
  day = ''
  return d
}
