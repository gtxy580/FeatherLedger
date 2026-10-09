/**
 * services/record.js —— 记账业务
 */
import { exec, query, esc, now, getAdjustCategoryIds } from './db.js'

/** 单笔金额上限：99,999,999.99 元。超过它"元转分"会突破 JS 安全整数精度（2^53-1） */
export const MAX_AMOUNT_CENTS = 9999999999

/**
 * 两个「差异调节」内部件的 id 列表（空数组 = 锚悬空）。
 * 列表接口读**一次**、传给每一行的 toRec —— toRec 是同步的，塞在 for 里不能再 await。
 */
async function adjustIdList() {
  const { out, in: inc } = await getAdjustCategoryIds()
  return [out, inc].filter((n) => n != null)
}

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
async function assertRecordPayload({ type, categoryId, accountId, toAccountId = null, amountCents, date, time = '' }, { allowTransferCategory = false } = {}) {
  if (type !== 1 && type !== 2 && type !== 3) throw new Error('type 必须是 1(支出) / 2(收入) / 3(转账)')
  if (!Number.isInteger(accountId)) throw new Error('必须选择账户')
  const acc = await query(`SELECT id FROM accounts WHERE id = ${accountId}`)
  if (!acc.length) throw new Error('账户不存在')
  if (type === 3) {
    // 「转账不能带分类」是**用户侧**的规矩（记一笔的转账页没有分类可挑）。预付那条转账反过来
    // 必须带分类 —— 以后少收时那笔差额要落回它 —— 所以服务内部开一个口子（allowTransferCategory），
    // 只有 services/prepay.js 会用。
    if (categoryId != null && !allowTransferCategory) throw new Error('转账不能带分类')
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
export async function addRecord({ type, categoryId = null, accountId, toAccountId = null, amountCents, date, time = '', note = '' }, opts = {}) {
  // 服务层兜底校验：不信任调用方（页面层另有体验校验）
  await assertRecordPayload({ type, categoryId, accountId, toAccountId, amountCents, date, time }, opts)

  // ★ 空值必须写成**显式的 NULL 字面量**：mock 的字面量解析只认大写 NULL，
  //   把 JS 的 null 插值成小写 null 会被当成字符串 'null' 存进去，真机与脚本就此走散。
  const cat = categoryId == null ? 'NULL' : categoryId
  const to = toAccountId == null ? 'NULL' : toAccountId
  // opts 里的三个预付字段只有 services/prepay.js 会用（页面从不传）：
  //   internal    内部搬运，都不进首页明细（记录是真的，余额照算）。
  //               **1 = 收回时挪的**、**2 = 结清时挪的** —— 分开是因为「取消结清」要认准后者
  //               删掉，而两者除了来路之外长得一模一样（同是 type 3、同挂 prepay_id）。
  //   prepayId    指向「预付那条」，收回 / 差额 / 结清那几条靠它认领回原笔
  //   prepayDone  预付那条自己：0 = 还挂着，1 = 已结清
  const pid = opts.prepayId == null ? 'NULL' : opts.prepayId
  const sql = `INSERT INTO records (type, account_id, to_account_id, category_id, amount, note, date, time, created_at, prepay_id, prepay_done, internal) VALUES (${type}, ${accountId}, ${to}, ${cat}, ${amountCents}, ${esc(note)}, ${esc(date)}, ${esc(time)}, ${esc(now())}, ${pid}, ${opts.prepayDone ? 1 : 0}, ${Number(opts.internal) || 0})`
  await exec(sql)
  return fetchLastId()
}

/**
 * 行 → 页面结构：数值归一 Number；LEFT JOIN 未命中（分类已删）给空串，页面兜底。
 * 颜色要跟主分类兜底：子分类可以不选色（存空串），此时**跟随主分类色**——这是记账页
 * 选子分类时的显示规则（`s.color || 父.color`）。首页若只取自己的 color，同一分类会
 * 在两页显示成两种颜色。
 */
function toRec(r, adjustIds = null) {
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
    // 改余额产生的「调整」流水：**能删、不能编辑**（用户裁定）。金额与分类都是系统反推出来的，
    // 手改一笔就破坏了「这笔调整让余额正好落到目标值」这个前提，而用户看不出账已经歪了。
    // 判据只看 category_id 落在哪两个内部件上（adjustIds 由调用方查一次传进来，
    // 不在这里 await —— toRec 是同步的，它被塞在 map/for 里）。
    adjust: adjustIds != null && adjustIds.includes(Number(r.categoryId)),
    // 分类 id 与预付归属原样带出：decorateRecord 判「这一行是不是预付 / 是不是结清出来的」
    // 要用它们（见那边的注释）。判据都是纯数据，所以放在那个纯函数里算，不在这里预判。
    categoryId: r.categoryId == null ? null : Number(r.categoryId),
    prepayId: r.prepayId == null ? null : Number(r.prepayId),
    categoryName: r.category_name || '',
    categoryIcon: r.category_icon || '',
    categoryColor: r.category_color || r.parent_color || '',
    // 父分类名：分类明细页的页头标题要拼「餐饮-早餐」；分类自己是主分类（或被删）时为空串
    parentName: r.parent_name || '',
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
  // ★ 预付那一笔（支出账户 → 预付账户的转账）：底层是转账（所以不进支出统计、账户余额天然
  //   正确），但**列表里要按支出显示**（用户裁定）—— 用户看到的是「我垫出去 1000（差旅）」，
  //   不是「微信 → 预付账户」。
  //   判据是 type 3 且带分类：只有预付会这么记（用户在记一笔里记转账选不到分类，
  //   见 assertRecordPayload 的 allowTransferCategory）。
  //   ★ 在这里算、而不是从 toRec 带过来：本函数是「给一行就能渲染」的纯函数（它自己的文档
  //     就是这么写的），依赖上游算好的字段会让每个调用点都得先过 toRec。
  const isPrepay = Number(r.type) === 3 && r.categoryId != null
  // ★ 结清（少收）时补记的那笔支出、以及收回多收时记的那笔收入 —— 它们都挂着 prepay_id，
  //   是这笔预付**走完之后留下的**收支。行上标一个「结清」，用户才知道这 200 块的支出是哪来的
  //   （否则它看起来就像一笔凭空的差旅支出）。
  //   （收回 / 结清时那两笔内部转账是 type 3 且 internal，本来就不进列表，走不到这里。）
  const isSettled = r.prepayId != null && (Number(r.type) === 1 || Number(r.type) === 2)
  const base = { ...r, prepay: isPrepay, settled: isSettled }
  // 让开这一个分支，下面整段（图标取分类、减号、时刻 | 账户 · 分类）原样复用，两条路不会走散
  if (Number(r.type) === 3 && !isPrepay) {
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
  // showCategory:false —— 「分类明细」页整页都是同一个分类，每行副标题再重复它是纯噪音。
  // 与 showAccount 是同一条判据：这一维已经被页面固定住了，就不必在每一行里再报一次。
  if (r.note && opts.showCategory !== false) meta.push(cat)
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
/**
 * 流水行 + 联查（分类 / 父分类 / 转出账户 / 转入账户）。
 *
 * ⚠ 用它的查询**不要在 WHERE 里写 `r.type = X`**：records 与 categories **都有 type 列**，
 *   而内存 mock 的 WHERE 是在「各表列拍平之后」求值的（Object.assign 合并，后一张表覆盖前一张），
 *   `r.type` 会取到**分类的** type，整行被滤掉 —— 真机上却完全正确。
 *   （2026-10-09 在 services/prepay.js 的待回收列表上踩过一次，现象是「查出来 0 条」。）
 *   groupRecords 里那条 `r.type = ${type}` 恰好总是对的（按分类筛时两个 type 恒等），
 *   但那是巧合不是保证。要按 type 筛，就另起一条**不 JOIN** 的查询。
 *   同理：accounts 与 categories 都有 name / icon / color，拍平后也会互相覆盖。
 */
const REC_SELECT = `SELECT r.id, r.type, r.amount, r.note, r.date, r.time,
      r.account_id AS accountId, r.to_account_id AS toAccountId, r.transfer_id AS transferId,
      r.category_id AS categoryId, r.prepay_id AS prepayId,
      c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
      p.name AS parent_name, p.color AS parent_color,
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
 *
 * ★ 明细里滤掉两类（见 services/prepay.js）：
 *   - `internal = 1` 的内部搬运（预付收回 / 结清时的转账）：记录必须留着（余额靠流水算），
 *     但用户不该在明细里看见钱在自己账户间挪。
 *   - `prepay_done = 1` 的**已结清预付**：那笔垫付已经走完一生（钱要不回来、要不成了支出），
 *     留在列表里只会是一条再也不会有下文的旧账 —— 它搬进「预付历史」里去了。
 *     ★ 结清时补记的那笔支出**不隐藏**：那是真花掉的钱，统计和明细都该有它。
 *   汇总不用另做处理 —— 两类都是 type = 3，本来就不进收支。
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
      AND (r.internal IS NULL OR r.internal = 0)
      AND (r.prepay_done IS NULL OR r.prepay_done = 0)
    ORDER BY r.date DESC, r.time DESC, r.created_at DESC, r.id DESC`
  )

  // SQL 已按日期倒序，Map 保持插入顺序 → days 天然倒序
  const days = []
  const byDate = new Map()
  const adjustIds = await adjustIdList()
  for (const raw of rows) {
    const rec = toRec(raw, adjustIds)
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
      AND (r.internal IS NULL OR r.internal = 0)
      AND (r.prepay_done IS NULL OR r.prepay_done = 0)
    ORDER BY r.date DESC, r.time DESC, r.created_at DESC, r.id DESC`
  )

  const months = []
  const byMonth = new Map()
  const adjustIds = await adjustIdList()
  for (const raw of rows) {
    const rec = toRec(raw, adjustIds)
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
export async function updateRecord(id, { type, categoryId = null, accountId, toAccountId = null, amountCents, date, time = '', note = '' }, opts = {}) {
  if (!Number.isInteger(id)) throw new Error('无效的流水 id')
  const [exists] = await query(`SELECT id, type, transfer_id AS transferId, category_id AS categoryId FROM records WHERE id = ${id}`)
  if (!exists) throw new Error('流水不存在')
  // ★ 手续费行不许单独改：它完全由所属的那条转账决定。单独改会把它变成一条挂着悬空
  //   transfer_id 的普通支出；更糟的是用户改完再去编辑那条转账，它又会被同步覆盖回来
  //  （「我改了它怎么又变回去了」）。要改手续费就改它所属的转账。
  if (exists.transferId != null) throw new Error('手续费随转账一起改，不能单独编辑')
  // ★ 调整流水（「差异调节」）也不许改，**但可以删**（用户裁定）：它的金额与分类是改余额时
  //   反推出来的，手改一笔就破坏了「这笔调整让余额正好落到目标值」这个前提 —— 而余额是用
  //   流水算出来的，用户改完只会看到余额莫名其妙地不对，却找不到是谁动了它。
  //   入口在页面上已经收掉了，这里再拦一道：页面漏了、或者将来多一条路径，都不会破坏它。
  if ((await adjustIdList()).includes(Number(exists.categoryId))) {
    throw new Error('余额调整记录不能编辑，可以删除')
  }

  // opts 透传：`allowTransferCategory` 只有 services/prepay.js 会用（改一笔预付时，
  // 那条转账得继续带着分类）
  await assertRecordPayload({ type, categoryId, accountId, toAccountId, amountCents, date, time }, opts)

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
 * 「手续费」分类的 id —— 读 meta.feeCategoryId（身份锚，按 id 不按名字）。
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

/**
 * 某个分类（或它的整个子树）在某一期里的流水，按天/按月分组。
 *
 * **它必须与分类占比对得上**：用户点的是那根写着 600 的条，页头就得是 600。
 * 三个分支各自对应占比图上的一种行（见 cat-stats-repro 第 5 组）：
 *   includeSub=true    → 主分类视角的行：它自己 + 全部子分类（占比图就是这么上卷的）
 *   includeSub=false   → 子分类视角的行：只有这一个分类
 *   cid=null           → 「已删除分类」那一行：所有孤儿流水的合集
 *
 * ★ **所有谓词只引用 records 自己的列。** 「含子分类」「孤儿」都先在 JS 里算出 id 集合，
 *   再写成 `r.category_id IN (...)`。直觉写法 `c.parent_id = ?`（LEFT JOIN 出来的父列）
 *   在真机 SQLite 上是对的，但本仓的 mock 把各表列拍平成一层，而 categories **既当 c 又当
 *   p**（父分类），同名列互相覆盖 —— c.parent_id 会被 p.parent_id（主分类的父 = null）盖掉，
 *   于是「含子分类」静默退化成「只有自己」：脚本全绿，只有真机上看得出少了一半。
 *   谓词里只碰 r.* 就没有这层隐患。
 *
 * @param {Object} p
 * @param {1|2} p.type 1=支出 2=收入
 * @param {string} p.start 起（含）'YYYY-MM-DD'
 * @param {string} p.end 止（含）'YYYY-MM-DD'
 * @param {number|null} [p.cid] 分类 id；null = 已删除分类（孤儿行）
 * @param {boolean} [p.includeSub] 是否连子分类一起（主分类视角才为 true）
 * @param {'day'|'month'} [p.groupBy] 分组粒度：周/月报按天，年报按月
 * @param {number|null} [p.accountId] 本页自己的账户筛选；null = 全部账户
 * @returns {Promise<{groups: Array<{key, amount, count, records}>, total: number, count: number}>}
 *   金额均为分；groups 按时间倒序（SQL 已排好，Map 保持插入顺序）
 */
export async function getCategoryRecords({
  type, start, end, cid = null, includeSub = false, groupBy = 'day', accountId = null
}) {
  if (type !== 1 && type !== 2) throw new Error('type 必须是 1(支出) 或 2(收入)')
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v)
  if (!isDate(start) || !isDate(end)) throw new Error('start/end 必须是 YYYY-MM-DD 格式')
  if (cid !== null && !Number.isInteger(cid)) throw new Error('cid 必须是整数或 null')
  if (groupBy !== 'day' && groupBy !== 'month') throw new Error('groupBy 必须是 day 或 month')

  let where
  if (cid === null) {
    const ids = await orphanCategoryIds(type, start, end, accountId)
    // 空集合的 `IN ()` 是非法 SQL，所以先判空再拼
    if (!ids.length) return { groups: [], total: 0, count: 0 }
    where = `r.category_id IN (${ids.join(',')})`
  } else if (includeSub) {
    const ids = await subtreeIds(cid)
    where = `r.category_id IN (${ids.join(',')})`
  } else {
    where = `r.category_id = ${cid}`
  }

  return groupRecords({ type, start, end, groupBy, accountId, where })
}

/**
 * 该主分类自己 + 它的全部子分类 id。层级只有两层（见 stats.js 的 topKeyOf 与首页注释），
 * 所以一条 `WHERE parent_id = ?` 就够了，不必递归。
 */
async function subtreeIds(cid) {
  const rows = await query(`SELECT id FROM categories WHERE parent_id = ${cid}`)
  return [cid].concat(rows.map((x) => Number(x.id)))
}

/**
 * 按账户汇总某一期的收支 —— **账户筛选弹层里每一行显示的就是它**。
 *
 * ★ 它与「账户余额」不是一回事，别混：`listAccounts()` 给的 `balance` 是**累计到今天**的，
 *   与用户正在看的那一期无关。用户翻到 8 月、点开账户筛选，想问的是「8 月我这几个账户
 *   各花了多少」，而不是「我现在卡里还有多少」—— 后者在这块地方出现，跟满屏的 8 月数据
 *   放在一起就是个假数字。
 *
 * 转账（type = 3）不是收支，两个 CASE 都命中不了它 —— 与首页汇总卡、分类占比同一口径。
 *
 * @param {Object} p
 * @param {string} p.start 起（含）'YYYY-MM-DD'
 * @param {string} p.end 止（含）'YYYY-MM-DD'
 * @param {number|null} [p.cid] 只算这个分类下的流水（分类明细页用）；null = 已删除分类；
 *   **省略** = 不限分类（首页用）。注意 null 与省略是两件事。
 * @param {boolean} [p.includeSub] cid 是否连子分类一起
 * @returns {Promise<{accounts: Array<{id, income, expense}>, total: {income, expense}>}>
 *   金额均为分。accounts 只含**这一期真有过流水**的账户（不会留一串 0 的空行）；
 *   total 是该分类/期间下**全部**流水的合计，与 getCategoryStats 的口径一致。
 */
export async function getAccountTotals({ start, end, cid, includeSub = false } = {}) {
  const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v)
  if (!isDate(start) || !isDate(end)) throw new Error('start/end 必须是 YYYY-MM-DD 格式')
  if (cid !== undefined && cid !== null && !Number.isInteger(cid)) {
    throw new Error('cid 必须是整数、null 或省略')
  }

  // 分类谓词与 getCategoryRecords 同一套：只引用 records 自己的列（理由见那边的注释）
  let catWhere = ''
  if (cid === null) {
    const ids = await orphanCategoryIds(null, start, end, null)
    if (!ids.length) return { accounts: [], total: { income: 0, expense: 0 } }
    catWhere = ` AND r.category_id IN (${ids.join(',')})`
  } else if (cid !== undefined) {
    const ids = includeSub ? await subtreeIds(cid) : [cid]
    catWhere = ` AND r.category_id IN (${ids.join(',')})`
  }

  const rows = await query(
    `SELECT r.account_id AS aid,
      SUM(CASE WHEN r.type = 1 THEN r.amount ELSE 0 END) AS expense,
      SUM(CASE WHEN r.type = 2 THEN r.amount ELSE 0 END) AS income
    FROM records r
    WHERE r.date >= ${esc(start)} AND r.date <= ${esc(end)}${catWhere}
    GROUP BY r.account_id`
  )

  const num = (v) => Number(v || 0)
  // 只有转账往来的账户会落成 0/0（转账不算收支）—— 那种行在弹层里是个没信息的空壳，去掉。
  // aid 为空的组（理论上不存在：App 保证每笔流水都有账户）不计入 accounts，但仍进 total。
  const accounts = rows
    .filter((r) => r.aid != null)
    .map((r) => ({ id: Number(r.aid), income: num(r.income), expense: num(r.expense) }))
    .filter((a) => a.income > 0 || a.expense > 0)
    .sort((a, b) => a.id - b.id)

  const total = { income: 0, expense: 0 }
  for (const r of rows) {
    total.income += num(r.income)
    total.expense += num(r.expense)
  }

  return { accounts, total }
}

/**
 * 每个备注用过多少次、最后一次哪天、在哪些分类下用过 —— 记一笔页的「高频备注」候选靠它。
 *
 * ★ 这是**全量**的：不分期间、也不按分类过滤。候选要回答的是「我一贯怎么记」，不是
 *   「这个月怎么记」；分类的偏好交给排序层（services/note.js）按「在当前分类下用过没有」
 *   加权 —— 在数据层按分类砍掉，用户换一次分类就得重查一次库。
 *
 * 空备注排掉：转账那笔手续费是 note = '' 的真实支出行（见 upsertFeeRow），每笔转账都带一条，
 * 不排掉的话候选里会钻出一堆看不见的空条。
 *
 * 分组键是 (note, category_id) 而不是 note：同一个备注在父分类和子分类下都记过时要**留着
 * 两个分类**（页面要判「当前分类下用过没有」），合并放到 JS 里做。
 */
export async function getNoteStats() {
  // ★ 聚合放在 JS 里，不写成 SQL 的 COUNT/MAX + GROUP BY：
  //   ① cids（这条备注在哪些分类下用过）本来就只能靠 JS 合并 —— SQL 一次给不出数组；
  //   ② 于是「次数、最近日期」走 SQL、cids 走 JS 就成了同一函数里的两条并行路径，
  //      两边一旦不一致（真机与复现脚本的 SQL 支持度本来就有细微出入）很难发现。
  //      全走 JS 就只有一条路径。数据量撑得住：个人记账一年几百到几千条，只取三列。
  const rows = await query(
    `SELECT r.note AS note, r.category_id AS cid, r.date AS date
     FROM records r
     WHERE r.note IS NOT NULL AND r.note <> ''`
  )

  const merged = new Map()
  for (const r of rows) {
    const note = String(r.note || '')
    if (!note) continue
    let one = merged.get(note)
    if (!one) {
      one = { note, count: 0, lastUsed: '', cids: [] }
      merged.set(note, one)
    }
    one.count += 1
    if (r.cid != null && !one.cids.includes(Number(r.cid))) one.cids.push(Number(r.cid))
    // 'YYYY-MM-DD' 的字典序即时间序
    const d = String(r.date || '')
    if (d > one.lastUsed) one.lastUsed = d
  }

  // 这个顺序只是为了结果确定，好写断言；真正给用户看的顺序由 note.js 排
  return [...merged.values()].sort((a, b) => b.count - a.count || a.note.localeCompare(b.note))
}

/**
 * 期间内出现过、但分类表里已经查不到的 category_id（= 已删除分类）。
 *
 * 为什么不写成一个 SQL 谓词：`... AND c.id IS NULL`（分类被删时 LEFT JOIN 落空）在**真机
 * SQLite 上完全正确**，但本仓的 mock 把各表列拍平成一层，而 records / accounts 也都有 id
 * 列 —— c 落空时那个位置是**键缺失**而不是「值为 null」，于是拍平后会取到 records.id，
 * 判据恒为假：脚本给出「孤儿 = 空集」，门是绿的、只有真机上有数据。这正是 mock 最该避免
 * 的「静默给错答案」。拆成两步之后每个查询只引用单张表的列，脚本与真机保证同一个答案。
 */
async function orphanCategoryIds(type, start, end, accountId) {
  // type 传 null/undefined = 不按收支过滤（getAccountTotals 要同时拿收入和支出两个数）
  const typeWhere = type == null ? '' : `r.type = ${type} AND `
  const rows = await query(
    `SELECT r.category_id AS cid FROM records r
    WHERE ${typeWhere}r.date >= ${esc(start)} AND r.date <= ${esc(end)}${accountWhere(accountId, 'r.')}
      AND r.category_id IS NOT NULL
    GROUP BY r.category_id`
  )
  const alive = new Set((await query('SELECT id FROM categories')).map((x) => Number(x.id)))
  return rows.map((x) => Number(x.cid)).filter((id) => !alive.has(id))
}

/** getCategoryRecords 的查询与分组（两个入口共用：按分类 / 按孤儿 id 集合） */
async function groupRecords({ type, start, end, groupBy, accountId, where }) {
  const rows = await query(
    `${REC_SELECT}
    WHERE r.type = ${type} AND r.date >= ${esc(start)} AND r.date <= ${esc(end)} AND ${where}${accountWhere(accountId, 'r.')}
      AND (r.internal IS NULL OR r.internal = 0)
    ORDER BY r.date DESC, r.time DESC, r.created_at DESC, r.id DESC`
  )

  const groups = []
  const byKey = new Map()
  let total = 0
  const adjustIds = await adjustIdList()
  for (const raw of rows) {
    const rec = toRec(raw, adjustIds)
    const key = groupBy === 'month' ? rec.date.slice(0, 7) : rec.date
    let g = byKey.get(key)
    if (!g) {
      g = { key, amount: 0, count: 0, records: [] }
      byKey.set(key, g)
      groups.push(g)
    }
    g.amount += rec.amount
    g.count += 1
    g.records.push(rec)
    total += rec.amount
  }

  return { groups, total, count: rows.length }
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
