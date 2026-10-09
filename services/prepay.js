/**
 * services/prepay.js —— 预付（垫付 / 报销）
 *
 * 一句话：**预付 = 把钱从支出账户挪进「预付账户」**（记成转账，所以天生不进支出统计）；
 * 收回 = 从预付账户挪到收款账户；两边对不上的差额，在收回时（多收）或结清时（少收）转成收支。
 *
 * ★ 贯穿全篇的一条不变量：**一笔预付收回来的钱不会超过它自己垫出去的**。
 *   所以每次收回实际转出的金额是 `min(本次实收, 这笔的剩余)`，超出的部分当场记收入。
 *   于是「预付账户的余额 = 这笔钱还挂在外面多少」恒成立，也永远不会被收成负数。
 *
 * ★ 内部搬运（收回、结清时的转账）记的是**真记录**、但不显示（`internal = 1`）：余额是靠
 *   流水算出来的，不记就平不了账；而用户看到该是「银行卡多了 800」，不是中间那几条搬运。
 *
 * 依赖方向：本模块 → record.js（写流水）。record.js **不**反向依赖它，所以不构成环。
 */
import { query, exec, esc } from './db.js'
import { addRecord, updateRecord } from './record.js'
import { fmtYuan } from './format.js'

/** 读一个「身份锚」并验行还在（与 record.js 的 getFeeCategoryId 同一形态） */
async function readAnchor(key, table) {
  const [row] = await query(`SELECT value FROM meta WHERE key = ${esc(key)}`)
  if (!row) return null
  const id = Number(row.value)
  if (!Number.isInteger(id) || id <= 0) return null
  const hit = await query(`SELECT id FROM ${table} WHERE id = ${id}`)
  return hit.length ? id : null
}

/**
 * 预付账户的 id —— 由迁移 / 播种建的（meta 锚）。**锚悬空（用户把它删了）返回 null**：
 * 调用方据此拒掉预付操作，而不是把钱挪进一个不存在的账户。
 */
export async function getPrepayAccountId() {
  return readAnchor('prepayAccountId', 'accounts')
}

/** 内部「预付差额」分类的 id（多收的那部分落成收入） */
export async function getPrepayDiffCategoryId() {
  return readAnchor('prepayDiffCategoryId', 'categories')
}

/**
 * 这笔预付**已经收回来多少**（内部搬运 + 多收时那笔差额收入之和）。
 * 编辑页要用它判断「能不能取消预付 / 金额能改多小」—— 已经收过钱的那笔不能倒退回去。
 */
export async function getPrepayRecovered(prepayId) {
  if (!Number.isInteger(prepayId)) throw new Error('无效的预付 id')
  // ★ 只算**收回来**的那两样：收回时的搬运（type 3 且 internal = 1）与多收时的差额收入（type 2）。
  //   同一 prepay_id 下另有结清补的两条（支出 type 1、搬运 internal = 2），它们是**结果**不是收回 ——
  //   算进来的话 recovered 会正好等于垫付总额，历史里「收回来多少」就清一色 100% 了。
  const [sum] = await query(
    `SELECT SUM(amount) AS recovered FROM records WHERE prepay_id = ${prepayId} AND (type = 2 OR internal = 1)`
  )
  return Number((sum && sum.recovered) || 0)
}

/**
 * 改一笔**还挂着**的预付：账户 / 分类 / 金额 / 日期 / 备注。
 *
 * ★ 金额不能小于**已经收回**的钱，也不能取消预付（那条路在页面层拦，理由同）：
 *   收回来 800 却把垫付额改成 500，账上就凭空多出 300 —— 而且没有任何一条流水解释它。
 *   真这么干的话先删掉那些收回记录（结清同理）。
 */
export async function updatePrepay({ id, accountId, categoryId, amountCents, date, time = '', note = '' }) {
  if (!Number.isInteger(id)) throw new Error('无效的预付 id')
  const pid = await getPrepayAccountId()
  if (pid == null) throw new Error('预付账户不存在，无法修改')
  const p = await getPrepay(id)
  if (!p) throw new Error('这笔预付不存在或已经结清')
  if (!Number.isInteger(categoryId)) throw new Error('请选择分类')
  if (Number.isInteger(amountCents) && amountCents < p.recovered) {
    throw new Error(`已经收回 ${fmtYuan(p.recovered)} 元，金额不能改得比它小`)
  }
  await updateRecord(
    id,
    { type: 3, categoryId, accountId, toAccountId: pid, amountCents, date, time, note },
    { allowTransferCategory: true }
  )
  return p.recovered
}

/**
 * 一笔预付的当前状态：原始金额、已收回、还剩多少。
 * 「已收回」= 挂在它下面的全部记录之和（内部搬运 + 多收时那笔差额收入）——
 * 那是**用户实际收到的钱**，也正是结清时要处理的差额的口径。
 */
async function getPrepay(id) {
  const [row] = await query(
    `SELECT id, account_id AS accountId, category_id AS categoryId, amount AS amount, note AS note,
      date AS date, time AS time, prepay_done AS done
     FROM records WHERE id = ${id}`
  )
  if (!row || Number(row.done) === 1) return null
  const amount = Number(row.amount)
  const recovered = await getPrepayRecovered(id)
  return {
    id: Number(row.id),
    accountId: Number(row.accountId), // 原支出账户（结清时的支出与转账都回它）
    categoryId: row.categoryId == null ? null : Number(row.categoryId),
    note: row.note || '',
    // 收回 / 结清补记的流水要跟它**同一天、同一时刻**（见那两处的注释）
    date: row.date,
    time: row.time || '',
    amount,
    recovered,
    // 不会为负：多收的情形在收回那一步就已经把差额记成收入了，不会挂在这里
    remaining: Math.max(0, amount - recovered)
  }
}

/**
 * 记一笔预付：支出账户 → 预付账户，**并带上分类**（以后少收时那笔差额要落回它）。
 *
 * 带分类的转账是这条路径独有的（`allowTransferCategory`）：用户在「记一笔」里记转账
 * 依然选不到分类。它不影响任何统计 —— 统计全按 type 分流，而这条是 type = 3。
 *
 * @returns {Promise<number>} 那条预付记录的 id（收回 / 结清都挂在它上面）
 */
export async function createPrepay({ accountId, categoryId, amountCents, date, time = '', note = '' }) {
  const pid = await getPrepayAccountId()
  if (pid == null) throw new Error('预付账户不存在，无法预付')
  if (accountId === pid) throw new Error('不能从预付账户再预付')
  if (!Number.isInteger(categoryId)) throw new Error('请选择分类')
  const cat = await query(`SELECT id FROM categories WHERE id = ${categoryId}`)
  if (!cat.length) throw new Error('分类不存在')

  return addRecord(
    { type: 3, categoryId, accountId, toAccountId: pid, amountCents, date, time, note },
    { allowTransferCategory: true }
  )
}

/**
 * 收回一笔预付：从预付账户转钱到收款账户（**不显示**）。
 *
 * 本次实收 X 分成两段：
 *   - `min(X, 这笔的剩余)` 从预付账户真的转出去（内部转账，不显示）
 *   - 超出的部分当场记成收入（分类走内部「预付差额」，挂收款账户，**这条要显示**）
 *     它进了收入统计，藏起来用户就对不上账了
 *
 * @param {Object} p
 * @param {number} p.toAccountId 收款账户 —— **不一定是原支出账户**（公司可能打到另一张卡上）
 * @returns {Promise<{moved: number, income: number}>} 转出去的 / 记成收入的（分）
 */
export async function recoverPrepay({ prepayId, toAccountId, amountCents, date, time, note = '' }) {
  if (!Number.isInteger(prepayId)) throw new Error('无效的预付 id')
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('金额必须是正整数分')
  const pid = await getPrepayAccountId()
  if (pid == null) throw new Error('预付账户不存在，无法收回')
  if (toAccountId === pid) throw new Error('收款账户不能是预付账户')

  const p = await getPrepay(prepayId)
  if (!p) throw new Error('这笔预付不存在或已经结清')

  // ★ 补记的流水跟**这笔预付**同一天、同一时刻（用户裁定）：它们是同一笔业务的两面，
  //   首页并排看过去该是一条。调用方显式给了就用它的（页面现在 date / time 都不传）。
  //   ★ 老预付（当初没记时刻的）时刻兜个「现在」—— 空着的话首页那行就只剩日期。
  //   —— 与「手续费行跟随转账的时刻」同规。
  const d = date != null ? date : p.date
  const t = time != null ? time : (p.time || nowTime())

  const moved = Math.min(amountCents, p.remaining)
  const over = amountCents - moved

  if (moved > 0) {
    await addRecord(
      { type: 3, accountId: pid, toAccountId, amountCents: moved, date: d, time: t, note: '' },
      { internal: 1, prepayId }
    )
  }
  if (over > 0) {
    const diffCat = await getPrepayDiffCategoryId()
    if (diffCat == null) throw new Error('内部「预付差额」分类不存在，收不回来')
    await addRecord({ type: 2, categoryId: diffCat, accountId: toAccountId, amountCents: over, date: d, time: t, note }, { prepayId })
  }
  return { moved, income: over }
}

/**
 * 结清一笔预付。只需处理「少收」（多收在收回那一步已经消化掉了）：
 *
 * | 这笔的剩余 | 记什么 | 账户 | 显示 |
 * |---|---|---|---|
 * | > 0（还有没报回来的） | 内部转账：预付账户 → **原支出账户** | — | ✗ |
 * |                       | 支出 = 剩余，分类 = 预付时选的那个 | **原支出账户** | ✔ |
 * | = 0（正好报完 / 多收过） | 什么都不记 | — | — |
 *
 * ★ **两笔都得有。** 只记支出不转账：预付账户里那 200 永远清不掉，角标也永远减不掉。
 *   只转账不记支出：钱回来了但统计上看不出你花了 200。
 * ★ 支出的账户是**原支出账户**（当初垫钱那个）—— 不是预付账户，也不是收款账户。
 *
 * @returns {Promise<{settled: number}>} 结清时补记的差额（0 = 什么都没记）
 */
export async function settlePrepay({ prepayId, date, time, note = '' }) {
  if (!Number.isInteger(prepayId)) throw new Error('无效的预付 id')
  const pid = await getPrepayAccountId()
  if (pid == null) throw new Error('预付账户不存在，无法结清')

  const p = await getPrepay(prepayId)
  if (!p) throw new Error('这笔预付不存在或已经结清')

  // ★ 补记的两行都用**这笔预付**的日期与时刻（与 recoverPrepay 同规，理由见那处注释）
  const d = date != null ? date : p.date
  const t = time != null ? time : (p.time || nowTime())

  if (p.remaining > 0) {
    // internal 给 2（不是收回用的 1）：「取消结清」要认准这一笔删掉，
    // 而它和收回那几笔除了来路之外长得一模一样
    await addRecord(
      { type: 3, accountId: pid, toAccountId: p.accountId, amountCents: p.remaining, date: d, time: t, note: '' },
      { internal: 2, prepayId }
    )
    await addRecord(
      { type: 1, categoryId: p.categoryId, accountId: p.accountId, amountCents: p.remaining, date: d, time: t, note },
      { prepayId }
    )
  }
  // 出列：待回收列表与角标都按这个标记筛
  await exec(`UPDATE records SET prepay_done = 1 WHERE id = ${prepayId}`)
  return { settled: p.remaining }
}

/**
 * **取消结清**：把这笔从「已结清」放回「还挂着」（预付历史里长按用的）。
 *
 * 就是把结清那一步原样撤掉 ——
 *   - 删掉结清时补的两条：内部转账（`internal = 2`）与那笔支出（`type = 1`）
 *   - `prepay_done` 置回 0，于是它重新出现在待回收列表里，可以继续收、再结清
 *
 * ★ 收回的记录**不动**：那些钱是真收回来了，用户当时就该留着它们。
 *   所以撤完的状态 = 「垫了 1000、已经收回 800、还挂着 200」，正是结清之前那一刻。
 */
export async function unsettlePrepay({ prepayId }) {
  if (!Number.isInteger(prepayId)) throw new Error('无效的预付 id')
  const [row] = await query(`SELECT id, prepay_done AS done FROM records WHERE id = ${prepayId}`)
  if (!row) throw new Error('这笔预付不存在')
  if (Number(row.done) !== 1) throw new Error('这笔还没有结清')

  await exec(`DELETE FROM records WHERE prepay_id = ${prepayId} AND (internal = 2 OR type = 1)`)
  await exec(`UPDATE records SET prepay_done = 0 WHERE id = ${prepayId}`)
}

/**
 * 还挂着的预付（= 待回收），每笔带上「已收回 / 剩余」。
 * 「还挂着」= 转进预付账户的那些转账里 `prepay_done = 0` 的 —— 角标上的笔数就是它的长度。
 * @returns {Promise<Array<{id, amount, recovered, remaining, date, time, note, accountId, accountName, categoryId, categoryName, categoryIcon, categoryColor}>>}
 */
export async function listPendingPrepays() {
  const pid = await getPrepayAccountId()
  if (pid == null) return []

  const rows = await query(
    `SELECT r.id AS id, r.amount AS amount, r.date AS date, r.time AS time, r.note AS note,
      r.account_id AS accountId, r.category_id AS categoryId
     FROM records r
     WHERE r.to_account_id = ${pid} AND r.type = 3 AND r.prepay_done = 0 AND r.category_id IS NOT NULL
     ORDER BY r.date DESC, r.id DESC`
  )

  // ★ 名字（账户 / 分类）**分两次查、在 JS 里对号，不 JOIN 进来** ——
  //   records 与 categories **都有 type 列**，而内存 mock 的 WHERE 是在「各表列拍平后」求值的
  //   （Object.assign 合并，后一张表覆盖前一张）：一旦 JOIN 了 categories，`WHERE r.type = 3`
  //   取到的就是**分类的** type，整行被滤掉，真机上却完全正确。这是脚本环境与真机走散的又一处
  //   —— 宁可多查一次，也不要写一条只在真机上对的 SQL。
  //   同理 categories 与 accounts 都有 name/icon/color：拍平后同样会互相覆盖。
  const accs = await query('SELECT id, name, icon, color FROM accounts')
  // ⚠ parent_id 也要取：颜色有「子分类没设色 → 跟随主分类」这条规则（见下面 catColor）
  const cats = await query('SELECT id, name, icon, color, parent_id FROM categories')
  const accOf = new Map(accs.map((a) => [Number(a.id), a]))
  const catOf = new Map(cats.map((c) => [Number(c.id), c]))

  // 已收回：一条查询把所有笔的合计拿回来，再在 JS 里对号 —— 一笔一条 SQL 会是 N+1
  // 判据同 getPrepayRecovered：只算收回的搬运与差额收入
  const sums = await query(
    `SELECT prepay_id AS pid, SUM(amount) AS recovered FROM records WHERE prepay_id IS NOT NULL AND (type = 2 OR internal = 1) GROUP BY prepay_id`
  )
  const recoveredOf = new Map()
  for (const s of sums) {
    if (s.pid != null) recoveredOf.set(Number(s.pid), Number(s.recovered || 0))
  }

  return rows.map((r) => {
    const amount = Number(r.amount)
    const recovered = recoveredOf.get(Number(r.id)) || 0
    const acc = accOf.get(Number(r.accountId)) || {}
    const cat = catOf.get(Number(r.categoryId)) || {}
    // ★ 子分类没设色时**跟随主分类** —— 与首页的图标色是同一条规则（record.js 的 toRec：
    //   `category_color || parent_color`）。少这一步，同一个分类在首页是绿的、在预付管理里
    //   是兜底灰的，用户会以为「这页的图标坏了」。
    const parentCat = cat.parent_id == null ? null : catOf.get(Number(cat.parent_id))
    const catColor = cat.color || (parentCat ? parentCat.color : '')
    return {
      id: Number(r.id),
      amount,
      recovered,
      remaining: Math.max(0, amount - recovered),
      date: r.date,
      time: r.time || '',
      note: r.note || '',
      accountId: r.accountId == null ? null : Number(r.accountId),
      accountName: acc.name || '',
      accountIcon: acc.icon || '',
      accountColor: acc.color || '',
      categoryId: r.categoryId == null ? null : Number(r.categoryId),
      categoryName: cat.name || '',
      categoryIcon: cat.icon || '',
      categoryColor: catColor
    }
  })
}

/**
 * 已结清的预付（历史记录），按**垫付那天**倒序。
 *
 * 每笔的 `recovered` 是「一共收回来多少」（内部搬运 + 多收的差额），`remaining` 则是结清时
 * 补记的那笔支出 —— 两个数加起来就是当初垫的总额，也就是这张历史卡片要说的事。
 *
 * @param {Object} [p]
 * @param {string} [p.start] 起（含）'YYYY-MM-DD'；不传表示不限
 * @param {string} [p.end]   止（含）'YYYY-MM-DD'
 * @param {number|null} [p.accountId] 只算**原支出账户**是这个的（用户筛账户时关心的就是它）
 */
export async function listSettledPrepays({ start = null, end = null, accountId = null } = {}) {
  const pid = await getPrepayAccountId()
  if (pid == null) return []
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v)
  if (start != null && !isDate(start)) throw new Error('start 必须是 YYYY-MM-DD 格式')
  if (end != null && !isDate(end)) throw new Error('end 必须是 YYYY-MM-DD 格式')
  if (accountId != null && !Number.isInteger(accountId)) throw new Error('accountId 必须是整数或 null')

  // ⚠ 这条查询**不 JOIN**（理由同 listPendingPrepays）：一旦连上 categories，
  //   mock 的 WHERE 会让 `r.type` 取到分类的 type，整行被滤掉。
  //   名字分两次查、在 JS 里对号。
  let where = `r.to_account_id = ${pid} AND r.type = 3 AND r.prepay_done = 1 AND r.category_id IS NOT NULL`
  if (start != null) where += ` AND r.date >= ${esc(start)}`
  if (end != null) where += ` AND r.date <= ${esc(end)}`
  if (accountId != null) where += ` AND r.account_id = ${accountId}`

  const rows = await query(
    `SELECT r.id AS id, r.amount AS amount, r.date AS date, r.time AS time, r.note AS note,
      r.account_id AS accountId, r.category_id AS categoryId
     FROM records r
     WHERE ${where}
     ORDER BY r.date DESC, r.id DESC`
  )
  if (!rows.length) return []

  const accs = await query('SELECT id, name, icon, color FROM accounts')
  const cats = await query('SELECT id, name, icon, color, parent_id FROM categories')
  const accOf = new Map(accs.map((a) => [Number(a.id), a]))
  const catOf = new Map(cats.map((c) => [Number(c.id), c]))

  // 「收回」= 收回时的搬运 + 多收时的差额收入（判据同 getPrepayRecovered）。
  // ★ 不能用「非支出的和」：结清时补的那条**内部转账**也是 type 3，算进去收回就等于全额了；
  //   也不能拿「垫付额 − 结清支出」反推 —— 那样**多收**的笔（收回 > 垫付）会被压成「收回 = 垫付」，
  //   而多收恰恰是这一页要显示出来的（汇总行那句「多收回 xxx」就靠它）。
  const sums = await query(
    `SELECT prepay_id AS pid, SUM(amount) AS recovered FROM records WHERE prepay_id IS NOT NULL AND (type = 2 OR internal = 1) GROUP BY prepay_id`
  )
  const recoveredOf = new Map()
  for (const s of sums) {
    if (s.pid != null) recoveredOf.set(Number(s.pid), Number(s.recovered || 0))
  }

  return rows.map((r) => {
    const amount = Number(r.amount)
    const recovered = recoveredOf.get(Number(r.id)) || 0 // 一共收回来多少（多收时 > amount）
    // 差额 = 当初没报回来的那部分（结清时补记的支出）。多收过的那笔这里是 0，不会为负
    const settled = Math.max(0, amount - recovered)
    const acc = accOf.get(Number(r.accountId)) || {}
    const cat = catOf.get(Number(r.categoryId)) || {}
    const parentCat = cat.parent_id == null ? null : catOf.get(Number(cat.parent_id))
    return {
      id: Number(r.id),
      amount,
      recovered,
      remaining: settled,
      date: r.date,
      time: r.time || '',
      note: r.note || '',
      accountId: r.accountId == null ? null : Number(r.accountId),
      accountName: acc.name || '',
      accountIcon: acc.icon || '',
      accountColor: acc.color || '',
      categoryId: r.categoryId == null ? null : Number(r.categoryId),
      categoryName: cat.name || '',
      categoryIcon: cat.icon || '',
      categoryColor: cat.color || (parentCat ? parentCat.color : '')
    }
  })
}

/** 待回收笔数 —— 首页账户筛选按钮上的角标。0 = 不显示角标。 */
export async function getPendingCount() {
  const pid = await getPrepayAccountId()
  if (pid == null) return 0
  const [row] = await query(
    `SELECT COUNT(*) AS c FROM records WHERE to_account_id = ${pid} AND type = 3 AND prepay_done = 0 AND category_id IS NOT NULL`
  )
  return Number((row && row.c) || 0)
}

/** 今天 'YYYY-MM-DD' —— 页面不传日期时用（与 account.js 的 todayStr 同一形态） */
export function today() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * 现在时刻 'HH:MM'（不导出，只当补记流水的兜底用）。
 *
 * 补记的流水一律跟随那笔预付的日期与时刻；**只有老预付**（当初没记时刻的那些）
 * 才回落到这里 —— 空着的话首页那一行就只剩日期、不显示时刻（用户裁定：按现在来）。
 */
function nowTime() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}
