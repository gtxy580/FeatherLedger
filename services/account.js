/**
 * services/account.js —— 账户业务（M6：CRUD + 实时余额）
 *
 * 余额不落库：初始余额 + SUM(收入) − SUM(支出)。SQL 只出「收支增量」这一个聚合，
 * 初始余额在 JS 里相加——内存 mock 不解析算术表达式与 COALESCE，加法放 JS
 * 既过得去门禁也更好读（也和分类表的「先查后写」是同一套形态）。
 */
import { query, exec, esc, now } from './db.js'
import { getMeta } from './meta.js'
import { ICONS } from './icons.js'
import { MAX_AMOUNT_CENTS } from './record.js'

/**
 * 账户名上限。**导出**：页面要拿它做两件事 —— 输入框的 `:maxlength` 与旁边的实时计数
 * （「2/8」）。这个数一旦只写在页面里，就会出现「输入框允许 8 个字、服务层按 6 个字拒收」
 * 这类两处走散的问题，而它只会在真机上表现为「保存失败但看不出为什么」。
 */
export const ACCOUNT_NAME_MAX = 8

/**
 * 「默认账户」的 id——迁移建的那个、老流水的落点。它有两个特权：
 * **排在第一行**（迁移把 sort 置 0）与**不允许删除**。
 * 用 meta 里的 id 而不是名字做锚：账户可以改名，改名不该改变它的身份。
 * @returns {Promise<number|null>}
 */
async function getDefaultAccountId() {
  const n = Number(await getMeta('defaultAccountId'))
  return Number.isInteger(n) && n > 0 ? n : null
}

/** 名称校验：去空白、非空、≤8 字 */
function validateName(name) {
  const n = (name || '').trim()
  if (!n) throw new Error('账户名不能为空')
  if ([...n].length > ACCOUNT_NAME_MAX) throw new Error(`账户名最多 ${ACCOUNT_NAME_MAX} 个字`)
  return n
}

/**
 * 图标校验：库里一律存 'svg:<ICONS key>'（与分类同一约定）；空串 = 组件退回名称首字。
 * 挡在服务层，免得脏 key 进库后页面渲染成一个空白圆。
 */
function validateIcon(icon) {
  if (!icon) return ''
  if (!icon.startsWith('svg:')) throw new Error('图标格式不对')
  if (!ICONS[icon.slice(4)]) throw new Error('图标不存在')
  return icon
}

/** 初始余额：整数分，可 0 可负（信用卡），上限与单笔金额同一份常量 */
function validateInitialBalance(v) {
  const n = Number(v)
  if (!Number.isInteger(n)) throw new Error('初始余额必须是整数分')
  if (Math.abs(n) > MAX_AMOUNT_CENTS) throw new Error('初始余额超出上限')
  return n
}

/** 账户名不得重复；excludeId 用于「改名叫回自己原来的名字」 */
async function assertNameFree(name, excludeId = null) {
  const exclude = excludeId == null ? '' : ` AND id <> ${excludeId}`
  const dup = await query(`SELECT id FROM accounts WHERE name = ${esc(name)}${exclude}`)
  if (dup.length) throw new Error('已存在同名账户')
}

/** 下一个 sort：max+1（与分类同一手法，避免并列导致排序无从下手） */
async function nextSort() {
  const [row] = await query('SELECT MAX(sort) AS m FROM accounts')
  return Number(row?.m || 0) + 1
}

/**
 * 账户列表 + 实时余额，按 sort, id 升序（默认账户 sort=0，因此恒排第一）。
 * @returns {Promise<Array<{id: number, name: string, icon: string, color: string, initialBalance: number, sort: number, canDelete: boolean, balance: number}>>} 金额均为分
 */
export async function listAccounts() {
  const rows = await query(
    `SELECT a.id AS id, a.name AS name, a.icon AS icon, a.color AS color, a.sort AS sort,
      a.initial_balance AS initialBalance,
      SUM(CASE WHEN r.type = 1 THEN r.amount ELSE 0 END) AS expense,
      SUM(CASE WHEN r.type = 2 THEN r.amount ELSE 0 END) AS income,
      SUM(CASE WHEN r.type = 3 THEN r.amount ELSE 0 END) AS transferOut
    FROM accounts a
    LEFT JOIN records r ON r.account_id = a.id
    GROUP BY a.id
    ORDER BY a.sort, a.id`
  )
  // 转账**转入**的那一半必须单独查：上面那条 JOIN 只连得上「这个账户是转出方」的流水，
  // 只作收款方的账户一行都连不到（transferIn 会恒为 0）。
  //
  // 为什么不用 `ON r.account_id = a.id OR r.to_account_id = a.id` 一条查询搞定：
  // 那会让 mock 的 JOIN 解析器只吃掉 ON 的前半截、把 `OR …` 静默丢掉
  //（它的正则只认 `ON 甲.乙 = 丙.丁`，而那条查询没有 WHERE，剩下的半个条件不会被任何
  // 模式捡走）—— 于是脚本环境算出 transferIn 恒为 0，红得莫名其妙；真机却是对的。
  // 「mock 静默给错结果」是这个仓库最不能留的东西，所以这里宁可多一条查询。
  // 顺带一提，本函数本来也不是「一条 SQL」：下面还有 getDefaultAccountId()。
  const inRows = await query(
    `SELECT to_account_id AS accountId, SUM(amount) AS transferIn
     FROM records WHERE type = 3 GROUP BY to_account_id`
  )
  const transferInOf = new Map()
  for (const r of inRows) {
    if (r.accountId != null) transferInOf.set(Number(r.accountId), Number(r.transferIn || 0))
  }
  const defId = await getDefaultAccountId()
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name,
    icon: r.icon || '',
    color: r.color || '',
    initialBalance: Number(r.initialBalance || 0),
    sort: Number(r.sort || 0),
    // 默认账户不给删：页面据此不渲染删除按钮，服务层另有硬拦（见 deleteAccount）
    canDelete: Number(r.id) !== defId,
    // 默认账户的名字也不给改：页面据此锁死名称输入框，服务层同样另有硬拦（见 updateAccount）
    isDefault: Number(r.id) === defId,
    // 收支各聚合一次（与 getMonthlyData 同一套 SUM(CASE … ELSE 0) 写法），余额在 JS 里加减：
    // 一笔流水都没有的账户两个 SUM 都恒为 0（走 ELSE 0 分支，不是 NULL），
    // 于是余额 = 初始余额——这才是「没有流水」的正确读数，不是 0、也不会消失
    //
    // 转账是**有方向**的：转出方减、转入方加 —— 所以它占了两个独立的项，不能并进
    // expense/income（并进去就等于承认转账是收支，与统计口径自相矛盾）。
    // ⚠ 这与「按账户筛选」**恰好相反**：那边不分方向（两端都该看见）。两处别合并。
    balance: Number(r.initialBalance || 0) + Number(r.income || 0) + (transferInOf.get(Number(r.id)) || 0)
      - Number(r.expense || 0) - Number(r.transferOut || 0)
  }))
}

/**
 * 单个账户（不含余额聚合）——编辑卡片回填用
 * @returns {Promise<{id: number, name: string, icon: string, color: string, initialBalance: number}|null>}
 */
export async function getAccount(id) {
  if (!Number.isInteger(id)) throw new Error('无效的账户 id')
  const [r] = await query(
    `SELECT id, name, icon, color, initial_balance AS initialBalance FROM accounts WHERE id = ${id}`
  )
  if (!r) return null
  return {
    id: Number(r.id),
    name: r.name,
    icon: r.icon || '',
    color: r.color || '',
    initialBalance: Number(r.initialBalance || 0)
  }
}

/**
 * 总资产 = 各账户余额之和（含初始余额）。
 * 复用 listAccounts 而不是再写一条聚合 SQL：两处口径永远一致。
 * @returns {Promise<number>} 分
 */
export async function getTotalAssets() {
  const list = await listAccounts()
  return list.reduce((n, a) => n + a.balance, 0)
}

/**
 * 账户名下的流水笔数（删除确认弹窗要先知道笔数，才能决定给不给「删除」按钮）。
 * ★ 必须**双向**：转账的转入方只出现在 to_account_id 里 —— 只数 account_id 的话，
 *   删掉一个只作收款方的账户不会被拦住，那笔转账的转入端当场悬空、余额算错。
 */
export async function countRecordsByAccount(id) {
  if (!Number.isInteger(id)) throw new Error('无效的账户 id')
  const [row] = await query(
    `SELECT COUNT(*) AS c FROM records WHERE account_id = ${id} OR to_account_id = ${id}`
  )
  return Number(row?.c || 0)
}

/**
 * 新增账户
 * @param {Object} data
 * @param {string} data.name 名称（非空、≤8 字、不得与其它账户重名）
 * @param {string} [data.icon] 'svg:xxx'；空串 = 名称首字
 * @param {string} [data.color] 图标底色（与分类、主题同一套色板 PALETTE_COLORS）；空串 = 组件默认灰
 * @param {number} [data.initialBalance] 初始余额（分），可 0 可负
 */
export async function addAccount({ name, icon = '', color = '', initialBalance = 0 }) {
  const n = validateName(name)
  const ic = validateIcon(icon)
  const bal = validateInitialBalance(initialBalance)
  await assertNameFree(n)
  const sort = await nextSort()
  await exec(
    `INSERT INTO accounts (name, icon, color, initial_balance, sort, created_at)
     VALUES (${esc(n)}, ${esc(ic)}, ${esc(String(color || '').trim())}, ${bal}, ${sort}, ${esc(now())})`
  )
}

/**
 * 修改账户的名称 / 图标 / 底色 / 初始余额。改初始余额会立刻改变余额，但不碰任何历史流水。
 * @param {number} id
 * @param {Object} data 同 addAccount 的载荷
 */
export async function updateAccount(id, { name, icon = '', color = '', initialBalance = 0 }) {
  if (!Number.isInteger(id)) throw new Error('无效的账户 id')
  const n = validateName(name)
  const ic = validateIcon(icon)
  const col = String(color || '').trim()
  const bal = validateInitialBalance(initialBalance)
  const rows = await query(`SELECT id, name, icon, color FROM accounts WHERE id = ${id}`)
  if (!rows.length) throw new Error('账户不存在')
  // 「默认账户」是固定身份（用户裁定）：名称、图标、底色都不许改，只有初始余额可改。
  // 外观（home + 灰）由 db.js 的 migrateAccountFace 钉住，页面也不再渲染这两个入口。
  if (id === (await getDefaultAccountId())) {
    if (n !== rows[0].name) throw new Error('默认账户的名称不可修改')
    if (ic !== (rows[0].icon || '') || col !== (rows[0].color || '')) {
      throw new Error('默认账户的图标与颜色不可修改')
    }
  }
  await assertNameFree(n, id)
  await exec(
    `UPDATE accounts SET name = ${esc(n)}, icon = ${esc(ic)}, color = ${esc(col)},
     initial_balance = ${bal} WHERE id = ${id}`
  )
}

/**
 * 账户上下移一格。默认账户恒排首位（sort=0），不参与排序。
 *
 * 与分类同一手法：**不交换两个 sort 值**——历史数据里可能有并列（相等就换了个寂寞），
 * 改成把「可排序账户」整段重写成 1..n，与历史数据无关地正确；默认账户的 0 因此恒在前。
 * @param {number} id
 * @param {-1|1} dir -1=上移 1=下移；已在首/末位时静默返回
 */
export async function moveAccount(id, dir) {
  if (!Number.isInteger(id)) throw new Error('无效的账户 id')
  if (dir !== -1 && dir !== 1) throw new Error('dir 必须是 -1 或 1')
  const rows = await query(`SELECT id FROM accounts WHERE id = ${id}`)
  if (!rows.length) throw new Error('账户不存在')
  const defId = await getDefaultAccountId()
  if (id === defId) throw new Error('默认账户固定排在第一行')

  // 别写成 `WHERE 1 = 1`：内存 mock 的条件求值不支持恒真式，会把整表过滤成空
  const notDef = defId == null ? '' : ` WHERE id <> ${defId}`
  const sibs = await query(`SELECT id FROM accounts${notDef} ORDER BY sort, id`)
  const idx = sibs.findIndex((r) => Number(r.id) === id)
  const target = idx + dir
  if (idx < 0 || target < 0 || target >= sibs.length) return // 越界：静默

  const order = sibs.map((r) => Number(r.id))
  const tmp = order[idx]
  order[idx] = order[target]
  order[target] = tmp
  for (let i = 0; i < order.length; i++) {
    await exec(`UPDATE accounts SET sort = ${i + 1} WHERE id = ${order[i]}`)
  }
}

/**
 * 删除账户。两道拦截，**与分类的「级联删除」相反**：
 * 账户是余额口径的一侧，留一条指向不存在账户的流水会同时打掉
 * 「每笔流水必有账户」与「总资产 = 各账户余额之和」两个不变量。
 * @param {number} id
 */
export async function deleteAccount(id) {
  if (!Number.isInteger(id)) throw new Error('无效的账户 id')
  const rows = await query(`SELECT id FROM accounts WHERE id = ${id}`)
  if (!rows.length) throw new Error('账户不存在')
  // 「默认账户」先判、且与有没有流水无关：这是身份问题（老流水的落点），不是一个可协商的条件
  if (id === (await getDefaultAccountId())) throw new Error('默认账户不能删除')
  const n = await countRecordsByAccount(id)
  if (n > 0) throw new Error(`该账户还有 ${n} 笔流水，不能删除`)
  const [total] = await query('SELECT COUNT(*) AS c FROM accounts')
  if (Number(total?.c || 0) <= 1) throw new Error('至少要保留一个账户')
  await exec(`DELETE FROM accounts WHERE id = ${id}`)
}
