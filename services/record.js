/**
 * services/record.js —— 记账业务
 */
import { exec, query, esc, now } from './db.js'

/** 单笔金额上限：99,999,999.99 元。超过它"元转分"会突破 JS 安全整数精度（2^53-1） */
export const MAX_AMOUNT_CENTS = 9999999999

/** 非关键路径：取自增 id，失败降级返回 0（INSERT 已成功，不能反报失败） */
async function fetchLastId() {
  try {
    const [row] = await query('SELECT last_insert_rowid() AS id')
    return Number(row.id)
  } catch (e) {
    console.warn('[record] 获取自增id失败（不影响已保存数据）', e)
    return 0
  }
}

/**
 * 新增/更新共用的载荷校验：两处必须同规，否则「编辑」会成为绕过金额上限的后门。
 * 必须 async：账户存在性要查库——页面层的账户列表可能还没加载完，或那个账户刚被别处删掉。
 */
async function assertRecordPayload({ type, categoryId, accountId, toAccountId = null, amountCents, date, time = '' }) {
  if (type !== 1 && type !== 2 && type !== 3) throw new Error('type 必须是 1(支出) / 2(收入) / 3(转账)')
  if (!Number.isInteger(accountId)) throw new Error('必须选择账户')
  const acc = await query(`SELECT id FROM accounts WHERE id = ${accountId}`)
  if (!acc.length) throw new Error('账户不存在')
  if (type === 3) {
    if (categoryId != null) throw new Error('转账不能带分类')
    if (!Number.isInteger(toAccountId)) throw new Error('请选择转入账户')
    if (toAccountId === accountId) throw new Error('转入账户不能和转出账户是同一个')
    const to = await query(`SELECT id FROM accounts WHERE id = ${toAccountId}`)
    if (!to.length) throw new Error('转入账户不存在')
  } else {
    if (toAccountId != null) throw new Error('只有转账才有转入账户')
    if (!Number.isInteger(categoryId)) throw new Error('必须选择有效分类')
  }
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('金额必须是正整数分')
  if (amountCents > MAX_AMOUNT_CENTS) throw new Error('金额超出上限')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date 必须是 YYYY-MM-DD 格式')
  // 时刻只收**归一后**的 HH:MM（页面那边是滚轮两列拼出来的，见 services/format.js 的
  // timeFromIndexes）。24 点与 60 分都不存在，空串表示「没有时刻」
  if (time !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('时刻必须是 24 小时制的 HH:MM')
}

/**
 * 新增一笔流水
 * @param {Object} data
 * @param {1|2} data.type 1=支出 2=收入
 * @param {number} data.categoryId 分类 id
 * @param {number} data.accountId 账户 id（必填，M6 起每笔流水必有账户）
 * @param {number} data.amountCents 金额（正整数分）
 * @param {string} data.date 'YYYY-MM-DD'
 * @param {string} [data.note] 备注
 * @returns {Promise<number>} 新记录 id（获取失败返回 0）
 */
export async function addRecord({ type, categoryId = null, accountId, toAccountId = null, amountCents, date, time = '', note = '' }) {
  // 服务层兜底校验：不信任调用方（页面层另有体验校验）
  await assertRecordPayload({ type, categoryId, accountId, toAccountId, amountCents, date, time })

  // ★ 空值必须写成**显式的 NULL 字面量**：mock 的字面量解析只认大写 NULL，
  //   把 JS 的 null 插值成小写 null 会被当成字符串 'null' 存进去，真机与脚本就此走散。
  const cat = categoryId == null ? 'NULL' : categoryId
  const to = toAccountId == null ? 'NULL' : toAccountId
  const sql = `INSERT INTO records (type, account_id, to_account_id, category_id, amount, note, date, time, created_at) VALUES (${type}, ${accountId}, ${to}, ${cat}, ${amountCents}, ${esc(note)}, ${esc(date)}, ${esc(time)}, ${esc(now())})`
  await exec(sql)
  return fetchLastId()
}

/**
 * 行 → 页面结构：数值归一 Number；LEFT JOIN 未命中（分类已删）给空串，页面兜底。
 * 颜色要跟主分类兜底：子分类可以不选色（存空串），此时**跟随主分类色**——这是记账页
 * 选子分类时的显示规则（`s.color || 父.color`）。首页若只取自己的 color，同一分类会
 * 在两页显示成两种颜色。
 */
function toRec(r) {
  return {
    id: Number(r.id),
    type: Number(r.type),
    amount: Number(r.amount),
    note: r.note || '',
    date: r.date,
    time: r.time || '',
    accountId: r.accountId == null ? null : Number(r.accountId),
    toAccountId: r.toAccountId == null ? null : Number(r.toAccountId),
    transferId: r.transferId == null ? null : Number(r.transferId),
    categoryName: r.category_name || '',
    categoryIcon: r.category_icon || '',
    categoryColor: r.category_color || r.parent_color || '',
    fromName: r.from_name || '',
    fromIcon: r.from_icon || '',
    fromColor: r.from_color || '',
    toName: r.to_name || '',
    toIcon: r.to_icon || '',
    toColor: r.to_color || ''
  }
}

/**
 * 明细行 → 页面要的四个字段（**纯函数**，不碰库，可脚本测）。
 *
 * 为什么从 index.vue 搬到服务层：三态规则（尤其「转账的标题是账户对、图标取转出方、
 * 金额不带正负号」）放在页面里就**只能靠真机看** —— 而它是这一轮最容易写错、又最不显眼的
 * 一处。搬完它就成了唯一可脚本测的形态。
 *
 * @param {Object} r 一行流水（REC_SELECT 的形状）
 * @param {{showAccount?: boolean}} [opts] showAccount：在副标题里带上「这笔属于哪个账户」。
 *   首页只在「全部账户」视图下传它 —— 筛了某个账户时满行重复同一个名字是噪音。
 *   **不传即旧行为**（副标题只放分类），所有既有调用点都不受影响。
 * @returns {{iconKey:string, iconColor:string, iconName:string, mainTitle:string, subTitle:string, sign:string, amountClass:string}}
 */
export function decorateRecord(r, opts = {}) {
  // ★ 必须**叠加**在原字段之上（而不是返回一个全新的精简对象）：页面还要用 id（`:key`
  //   与编辑/删除）、amount（金额）、transferId（抑制手续费行的按钮）。
  //   这里曾经只返回装饰字段，后果是静默的、且脚本测不到（页面在 .vue 里）：
  //   首页每一行金额都显示 0.00（fmtYuan(undefined) 给 "0.00"）、点编辑会以**新增态**
  //   打开（id=undefined → NaN）、删除永远失败、手续费行的按钮抑制失效。
  const base = { ...r }
  if (Number(r.type) === 3) {
    // 转出账户是「这笔钱从哪出」的语境，所以图标取它；账户对就是这一行的身份，
    // 不能被备注顶掉（备注降到副标题）。
    // 副标题与收支行同一套：时刻在最前，备注跟在后面（用户裁定：时间|账户·分类）
    const tSub = []
    if (r.time) tSub.push(r.time)
    if (r.note) tSub.push(r.note)
    return {
      ...base,
      iconKey: r.fromIcon || 'svg:package',
      iconColor: r.fromColor || '',
      iconName: r.fromName || '账户',
      mainTitle: `${r.fromName || '账户'} → ${r.toName || '账户'}`,
      subTitle: tSub.join(' | '),
      sign: '',
      amountClass: 'plain'
    }
  }
  const deleted = !r.categoryName
  const cat = r.categoryName || '已删除分类'
  // 副标题第二行（用户裁定：**时间 | 账户 · 分类**）——
  // 时刻挪到最前（原先它是标题行右侧单独一格），账户在分类之前，两段各自用「 · 」。
  // 没备注时分类已经是主标题了，副标题就不重复它（否则同一行里同一个词出现两次）；
  // 两者都没有就保持空（不出空行）。
  // 账户名来自 REC_SELECT 的 fa.name（→ fromName），对所有类型都已取回；拿不到时（LEFT JOIN
  // 没命中）直接不拼，免得留下半个「 · 」。时刻为空的老流水同理，不留下半个「 | 」。
  const meta = []
  if (opts.showAccount && r.fromName) meta.push(r.fromName)
  if (r.note) meta.push(cat)
  const pair = meta.join(' · ')
  return {
    ...base,
    iconKey: deleted ? 'svg:x' : r.categoryIcon,
    iconColor: r.categoryColor || '',
    iconName: cat,
    mainTitle: r.note || cat,
    subTitle: [r.time, pair].filter(Boolean).join(' | '),
    sign: Number(r.type) === 2 ? '+' : '-',
    amountClass: Number(r.type) === 2 ? 'inc' : ''
  }
}

// 联查：分类（子分类带父色兜底）+ 两端账户（转账那一行要显示「现金 → 银行卡」）。
// ⚠ 每个投影**必须起别名**：mock 把 `别名.列` 拍平成一个键，`c.name` 与 `fa.name`
//   不起别名会互相覆盖，真机上也会让 rs 对象的键变得不可预期。
const REC_SELECT = `SELECT r.id, r.type, r.amount, r.note, r.date, r.time,
      r.account_id AS accountId, r.to_account_id AS toAccountId, r.transfer_id AS transferId,
      c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
      p.color AS parent_color,
      fa.name AS from_name, fa.icon AS from_icon, fa.color AS from_color,
      ta.name AS to_name,   ta.icon AS to_icon,   ta.color AS to_color
    FROM records r
    LEFT JOIN categories c ON r.category_id = c.id
    LEFT JOIN categories p ON c.parent_id = p.id
    LEFT JOIN accounts fa ON fa.id = r.account_id
    LEFT JOIN accounts ta ON ta.id = r.to_account_id`

/** 汇总行 → {income, expense}，空集 SUM 为 NULL 时兜 0，杜绝页面出现 "null" */
function toSummary(sumRow) {
  return {
    income: Number(sumRow?.income || 0),
    expense: Number(sumRow?.expense || 0)
  }
}

/**
 * 可选账户谓词：null/省略 = 全部账户（M6 之前的行为，逐字节不变）。
 * 汇总查询与明细查询**必须**用同一个谓词，否则同一屏会出现两个口径。
 * @param {number|null} accountId
 * @param {string} [prefix] 明细查询里是 'r.'
 */
function accountWhere(accountId, prefix = '') {
  if (accountId == null) return ''
  if (!Number.isInteger(accountId)) throw new Error('accountId 必须是整数或 null')
  // ★ 转账是**双向**的：一笔「现金 → 银行卡」在筛「现金」与筛「银行卡」时都该出现。
  //   这与余额那边**恰好相反**（余额里转出方减、转入方加，是有方向的）——
  //   两处别合并成一套写法，会错一半。
  return ` AND (${prefix}account_id = ${accountId} OR ${prefix}to_account_id = ${accountId})`
}

/**
 * 取某月数据：月汇总 + 按天分组的明细行
 * @param {string} month 'YYYY-MM'
 * @param {number|null} [accountId] 只算该账户（首页筛选）；null/省略 = 全部账户
 * @returns {Promise<{income: number, expense: number, days: Array}>} 金额均为分
 */
export async function getMonthlyData(month, accountId = null) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('month 必须是 YYYY-MM 格式')

  // 由 'YYYY-MM' 推出首末日：范围谓词才能用上 records(date) 索引
  // （substr(date,1,7) 会把列包在函数里，索引失效，只能全表扫）
  const [yy, mm] = month.split('-').map(Number)
  const first = `${month}-01`
  const last = `${month}-${String(new Date(yy, mm, 0).getDate()).padStart(2, '0')}`

  const [sumRow] = await query(
    `SELECT
      SUM(CASE WHEN type = 1 THEN amount ELSE 0 END) AS expense,
      SUM(CASE WHEN type = 2 THEN amount ELSE 0 END) AS income
    FROM records
    WHERE date >= ${esc(first)} AND date <= ${esc(last)}${accountWhere(accountId)}`
  )

  const rows = await query(
    `${REC_SELECT}
    WHERE r.date >= ${esc(first)} AND r.date <= ${esc(last)}${accountWhere(accountId, 'r.')}
    ORDER BY r.date DESC, r.time DESC, r.created_at DESC, r.id DESC`
  )

  // SQL 已按日期倒序，Map 保持插入顺序 → days 天然倒序
  const days = []
  const byDate = new Map()
  for (const raw of rows) {
    const rec = toRec(raw)
    let day = byDate.get(rec.date)
    if (!day) {
      day = { date: rec.date, income: 0, expense: 0, records: [] }
      byDate.set(rec.date, day)
      days.push(day)
    }
    // ★ 只认 1/2：转账（type = 3）**不是收支**，不能落进 else 当成收入。
    //   写成 else 的话，只含转账的那一天分组头会显示「收 300.00」而同一屏的月汇总是 0 ——
    //   两个口径自相矛盾，而 spec §9.2 明写这里该是「收 0 支 0」。
    if (rec.type === 1) day.expense += rec.amount
    else if (rec.type === 2) day.income += rec.amount
    day.records.push(rec)
  }

  return { ...toSummary(sumRow), days }
}

/**
 * 取某年数据：年汇总 + 按月分组的明细行（与 getMonthlyData 同形，分组键 = 'YYYY-MM'）
 * @param {number} year 如 2026
 * @param {number|null} [accountId] 只算该账户（首页筛选）；null/省略 = 全部账户
 * @returns {Promise<{income: number, expense: number, months: Array}>} 金额均为分
 */
export async function getYearlyData(year, accountId = null) {
  if (!Number.isInteger(year)) throw new Error('year 必须是整数年份')

  // 同 getMonthlyData：范围谓词才能用上 records(date) 索引
  const first = `${year}-01-01`
  const last = `${year}-12-31`

  const [sumRow] = await query(
    `SELECT
      SUM(CASE WHEN type = 1 THEN amount ELSE 0 END) AS expense,
      SUM(CASE WHEN type = 2 THEN amount ELSE 0 END) AS income
    FROM records
    WHERE date >= ${esc(first)} AND date <= ${esc(last)}${accountWhere(accountId)}`
  )

  const rows = await query(
    `${REC_SELECT}
    WHERE r.date >= ${esc(first)} AND r.date <= ${esc(last)}${accountWhere(accountId, 'r.')}
    ORDER BY r.date DESC, r.time DESC, r.created_at DESC, r.id DESC`
  )

  const months = []
  const byMonth = new Map()
  for (const raw of rows) {
    const rec = toRec(raw)
    const key = rec.date.slice(0, 7)
    let m = byMonth.get(key)
    if (!m) {
      m = { month: key, income: 0, expense: 0, records: [] }
      byMonth.set(key, m)
      months.push(m)
    }
    // 同上：只认 1/2，转账不算收支
    if (rec.type === 1) m.expense += rec.amount
    else if (rec.type === 2) m.income += rec.amount
    m.records.push(rec)
  }

  return { ...toSummary(sumRow), months }
}

/**
 * 删除一笔流水（硬删除）
 * @param {number} id 流水 id
 */
/**
 * 删除一笔流水（硬删除）。
 *
 * ★ 删转账时要**连带删掉它的手续费行**：手续费行不是用户直接建的，留一条无主支出
 *   （钱看起来凭空少了 2 元）比把它一起删掉糟得多。
 * ★ 手续费行本身不许单独删：删了它再编辑那条转账，它会被重新插回来（「我删了它怎么又回来了」）。
 */
export async function deleteRecord(id) {
  if (!Number.isInteger(id)) throw new Error('无效的流水 id')
  const [row] = await query(`SELECT id, type, transfer_id AS transferId FROM records WHERE id = ${id}`)
  if (row && row.transferId != null) throw new Error('手续费随转账一起删，不能单独删除')
  if (row && Number(row.type) === 3) await exec(`DELETE FROM records WHERE transfer_id = ${id}`)
  await exec(`DELETE FROM records WHERE id = ${id}`)
}

/**
 * 读取单条流水（编辑模式回填用）
 * @param {number} id
 * @returns {Promise<{id: number, type: number, categoryId: number|null, accountId: number|null, amount: number, date: string, note: string}|null>}
 *   不存在时返回 null —— 页面据此把分类区留空（分类可能已被删除）
 */
export async function getRecord(id) {
  if (!Number.isInteger(id)) throw new Error('无效的流水 id')
  const [row] = await query(
    `SELECT id, type, category_id AS categoryId, account_id AS accountId, to_account_id AS toAccountId,
       transfer_id AS transferId, amount, note, date, time FROM records WHERE id = ${id}`
  )
  if (!row) return null
  // 手续费金额（编辑页要回填）：转账行自己不带，它在归属这条转账的那笔手续费行上
  let feeAmount = 0
  if (Number(row.type) === 3) {
    const [fee] = await query(`SELECT amount FROM records WHERE transfer_id = ${id}`)
    feeAmount = fee ? Number(fee.amount) : 0
  }
  return {
    id: Number(row.id),
    type: Number(row.type),
    categoryId: row.categoryId == null ? null : Number(row.categoryId),
    accountId: row.accountId == null ? null : Number(row.accountId),
    toAccountId: row.toAccountId == null ? null : Number(row.toAccountId),
    transferId: row.transferId == null ? null : Number(row.transferId),
    amount: Number(row.amount),
    note: row.note || '',
    date: row.date,
    time: row.time || '',
    feeAmount
  }
}

/**
 * 更新一条流水（全字段可改）
 * @param {number} id
 * @param {Object} data 同 addRecord 的载荷
 */
export async function updateRecord(id, { type, categoryId = null, accountId, toAccountId = null, amountCents, date, time = '', note = '' }) {
  if (!Number.isInteger(id)) throw new Error('无效的流水 id')
  const [exists] = await query(`SELECT id, type, transfer_id AS transferId FROM records WHERE id = ${id}`)
  if (!exists) throw new Error('流水不存在')
  // ★ 手续费行不许单独改：它完全由所属的那条转账决定。单独改会把它变成一条挂着悬空
  //   transfer_id 的普通支出；更糟的是用户改完再去编辑那条转账，它又会被同步覆盖回来
  //  （「我改了它怎么又变回去了」）。要改手续费就改它所属的转账。
  if (exists.transferId != null) throw new Error('手续费随转账一起改，不能单独编辑')

  await assertRecordPayload({ type, categoryId, accountId, toAccountId, amountCents, date, time })

  // 一条曾经是转账的记录被改成收支：把它那笔手续费行删掉，
  // 否则会留下一条无主的孤儿支出（钱凭空少了 2 元而没有任何东西解释它）
  if (Number(exists.type) === 3 && type !== 3) {
    await exec(`DELETE FROM records WHERE transfer_id = ${id}`)
  }

  const cat = categoryId == null ? 'NULL' : categoryId
  const to = toAccountId == null ? 'NULL' : toAccountId
  await exec(
    `UPDATE records SET type = ${type}, account_id = ${accountId}, to_account_id = ${to}, category_id = ${cat},
     amount = ${amountCents}, note = ${esc(note)}, date = ${esc(date)}, time = ${esc(time)} WHERE id = ${id}`
  )
}

/**
 * 「手续费」分类的 id —— 读 meta.feeCategoryId（身份锚，与 meta.defaultAccountId 同一套路）。
 *
 * 锚悬空（用户把那个分类删了）时返回 null：那笔手续费就挂个空分类，在明细与分类占比里
 * 显示成「已删除分类」。这与 deleteCategory「不碰 records、联查不到就显示已删除分类」的
 * 既有语义一致，也避免「删了它下次转账又冒出来」这种看着像 bug 的行为。
 *
 * 导出：category.js 的列表接口要靠它把这个分类从**用户可见的分类**里摘掉
 * （手续费只能由转账带出来，不该出现在分类管理或记一笔的宫格里）。锚的读法只此一份 ——
 * 两个模块各读一次 key 字符串，就是「两处走散」的开始。
 */
export async function getFeeCategoryId() {
  const [row] = await query(`SELECT value FROM meta WHERE key = 'feeCategoryId'`)
  if (!row) return null
  const id = Number(row.value)
  if (!Number.isInteger(id)) return null
  const hit = await query(`SELECT id FROM categories WHERE id = ${id}`)
  return hit.length ? id : null
}

/**
 * 写「转账的那笔手续费」—— 一条真实的 type = 1 支出记录，靠 transfer_id 认领回转账行。
 *
 * 因为它是真支出，余额（转出方的 expense）、统计（支出合计 / 分类占比 / 趋势）、明细
 * 三处口径**一行都不用为它特判**。这不是巧合，是「把它记成第二条真实记录」换来的。
 *
 * 四种情况收在一处：本来没有→插一条；本来有→就地改（金额/日期/转出账户都可能变）；
 * 金额为 0→删掉；本来没有且金额为 0→什么都不做。
 *
 * 为什么不复用 updateRecord：那条路会**硬拦** transfer_id 非空的行（见那里的注释），
 * 这个内部同步路径正是那个守卫要放行的唯一例外。
 */
async function upsertFeeRow({ transferId, accountId, amountCents, date, time = '' }) {
  const [row] = await query(`SELECT id FROM records WHERE transfer_id = ${transferId}`)
  if (!amountCents) {
    if (row) await exec(`DELETE FROM records WHERE id = ${Number(row.id)}`)
    return 0
  }
  if (!Number.isInteger(amountCents) || amountCents > MAX_AMOUNT_CENTS) throw new Error('手续费超出上限')
  const cat = await getFeeCategoryId()
  const catLit = cat == null ? 'NULL' : cat

  if (row) {
    await exec(
      `UPDATE records SET account_id = ${accountId}, category_id = ${catLit}, amount = ${amountCents},
       date = ${esc(date)}, time = ${esc(time)} WHERE id = ${Number(row.id)}`
    )
    return Number(row.id)
  }
  await exec(
    `INSERT INTO records (type, account_id, to_account_id, category_id, amount, note, date, time, created_at, transfer_id)
     VALUES (1, ${accountId}, NULL, ${catLit}, ${amountCents}, '', ${esc(date)}, ${esc(time)}, ${esc(now())}, ${transferId})`
  )
  return fetchLastId()
}

/**
 * 保存一次转账（含它那笔手续费）—— **页面只调这一个函数**。
 *
 * `id == null` 新建、否则编辑。两条记录的全部编排都收在这里：spec §5.5 那张生命周期表
 * 有七种情况（改金额、改日期、改转出方、手续费 0↔非 0、删转账、转账切成收支…），
 * 散到页面里必漏一两处，而漏出来的都是静默的错账。
 *
 * 「把转账改成收支」不在这里 —— 那条路走 updateRecord（它自己会删手续费行）。
 *
 * @returns {Promise<number>} 转账行的 id
 */
export async function saveTransfer({ id = null, accountId, toAccountId, amountCents, feeCents = 0, date, time = '', note = '' }) {
  const payload = { type: 3, categoryId: null, accountId, toAccountId, amountCents, date, time, note }
  let tid = id
  if (id == null) tid = await addRecord(payload)
  else await updateRecord(id, payload) // 转账行自己的 transfer_id 是空的，守卫放行
  // 手续费与转账是同一笔事情，时刻必须同源 —— 否则明细里会出现「转账 10:00、手续费 08:00」
  await upsertFeeRow({ transferId: tid, accountId, amountCents: feeCents, date, time })
  return tid
}

/**
 * 分类聚合（平铺行）：按记录所属分类分组，并带出其主分类信息。
 * 主分类 / 子分类两个视角由 services/stats.js 的纯函数折算——两个视角读同一份数据，
 * 「父子上卷后合计相等」因此是结构保证。
 *
 * 分组键是 c.id 而不是 r.category_id：分类已删时 c.id 为 NULL，SQLite 把所有 NULL 归为一组，
 * 于是不同的已删分类的记录合并成一行「已删除分类」；按 r.category_id 分组则会各自成行、
 * 全部叫「已删除分类」而无法区分。
 *
 * @param {Object} p
 * @param {1|2} p.type 1=支出 2=收入
 * @param {string} p.start 'YYYY-MM-DD'（含）
 * @param {string} p.end 'YYYY-MM-DD'（含）
 * @returns {Promise<Array>} 平铺行，按 amount 降序
 */
export async function getCategoryStats({ type, start, end }) {
  if (type !== 1 && type !== 2) throw new Error('type 必须是 1(支出) 或 2(收入)')
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v)
  if (!isDate(start) || !isDate(end)) throw new Error('start/end 必须是 YYYY-MM-DD 格式')

  const rows = await query(
    `SELECT c.id AS cid,
      c.name AS name, c.icon AS icon, c.color AS color, c.parent_id AS parentId,
      p.id AS pId, p.name AS pName, p.icon AS pIcon, p.color AS pColor,
      SUM(r.amount) AS amount, COUNT(*) AS count
    FROM records r
    LEFT JOIN categories c ON r.category_id = c.id
    LEFT JOIN categories p ON c.parent_id = p.id
    WHERE r.type = ${type} AND r.date >= ${esc(start)} AND r.date <= ${esc(end)}
    GROUP BY c.id
    ORDER BY amount DESC`
  )

  return rows.map((r) => ({
    cid: r.cid == null ? null : Number(r.cid),
    name: r.name || '已删除分类',
    icon: r.icon || '',
    color: r.color || '',
    parentId: r.parentId == null ? null : Number(r.parentId),
    pId: r.pId == null ? null : Number(r.pId),
    pName: r.pName || '',
    pIcon: r.pIcon || '',
    pColor: r.pColor || '',
    amount: Number(r.amount || 0),
    count: Number(r.count || 0)
  }))
}

const GRANS = ['week', 'month', 'year']
const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']

const p2 = (n) => String(n).padStart(2, '0')
const parseDate = (s) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const fmtDate = (dt) => `${dt.getFullYear()}-${p2(dt.getMonth() + 1)}-${p2(dt.getDate())}`

/**
 * 趋势聚合：按粒度分桶，**空桶补 0**。
 *
 * 补零放在服务层而不是渲染层：若让页面「拿到几行画几根柱」，某天没记账时横轴就少一格，
 * 后面的柱子整体左移，用户会读成「数据错了」而不是「那天没花钱」。
 *
 * @param {Object} p
 * @param {1|2} p.type 1=支出 2=收入
 * @param {string} p.start 'YYYY-MM-DD'（含）
 * @param {string} p.end 'YYYY-MM-DD'（含）
 * @param {'week'|'month'|'year'} p.gran
 * @returns {Promise<Array<{key: string, label: string, amount: number}>>} 按时间升序，桶已补全
 */
export async function getTrendStats({ type, start, end, gran }) {
  if (type !== 1 && type !== 2) throw new Error('type 必须是 1(支出) 或 2(收入)')
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v)
  if (!isDate(start) || !isDate(end)) throw new Error('start/end 必须是 YYYY-MM-DD 格式')
  if (!GRANS.includes(gran)) throw new Error('gran 必须是 week / month / year')

  // 1. 先生成完整的桶（key 用于与查询结果对齐，label 用于显示）
  const buckets = []
  if (gran === 'week') {
    const d0 = parseDate(start)
    for (let i = 0; i < 7; i++) {
      const dt = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + i)
      buckets.push({ key: fmtDate(dt), label: WEEK_LABELS[i], amount: 0 })
    }
  } else if (gran === 'month') {
    const d0 = parseDate(start)
    const d1 = parseDate(end)
    for (let dt = d0; dt <= d1; dt = new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + 1)) {
      buckets.push({ key: fmtDate(dt), label: String(dt.getDate()), amount: 0 })
    }
  } else {
    const y = Number(start.slice(0, 4))
    for (let m = 1; m <= 12; m++) {
      buckets.push({ key: `${y}-${p2(m)}`, label: `${m}月`, amount: 0 })
    }
  }

  // 2. 查聚合（年报按月分桶；周/月按天分桶）。substr 只出现在投影与分组里，WHERE 仍走 date 范围
  const keyExpr = gran === 'year' ? 'substr(r.date, 1, 7)' : 'r.date'
  const rows = await query(
    `SELECT ${keyExpr} AS k, SUM(r.amount) AS amount
    FROM records r
    WHERE r.type = ${type} AND r.date >= ${esc(start)} AND r.date <= ${esc(end)}
    GROUP BY ${keyExpr}
    ORDER BY k ASC`
  )

  // 3. 用查询结果填充桶；查不到的桶保持 0
  const byKey = new Map(rows.map((r) => [String(r.k), Number(r.amount || 0)]))
  for (const b of buckets) {
    const hit = byKey.get(b.key)
    if (hit != null) b.amount = hit
  }
  return buckets
}
