/**
 * services/backup.js —— 数据备份与恢复
 *
 * 导出＝把四张账本表 dump 成一段 JSON 文本（经剪贴板搬走）；
 * 导入＝先用纯函数整份校验，全部通过后在一个事务里清空并写回。
 *
 * **为什么不复用服务层（account.js / category.js / record.js）来重建**：服务层带副作用
 * （分类 sort 会重排、默认账户会被置顶、新建时随机取配色），而导入的语义是「原样还原」，
 * 走服务层等于把备份重新录入一遍，结果与备份不一致 —— 对备份功能是致命的。
 * 代价是校验要自己写，但这本来就该分开：服务层防「用户录错」，导入防「备份坏了 / 被改过 /
 * 来自更新的版本」。
 */
import { query, exec, esc, now, txBegin, txCommit, txRollback } from './db.js'

export const BACKUP_KIND = 'less-ledger-backup'
export const BACKUP_VERSION = 1

/**
 * 不随备份走的 meta 键 —— 都是「这台设备上的个性偏好」，不是账本数据。
 * 用户裁定这两项不跟备份走：themeAccent（主题色）、tagline（首页那句话签名）。
 *
 * 用**排除法**而不是白名单：将来新增的设置项会自动进备份，不会静默丢数据
 * （白名单的失败模式是「悄悄少备份了一项」，那是最坏的一种）。
 *
 * 这个常量驱动三处，改一处即全对：导出的过滤、解析时的剔除、以及导入时
 * `DELETE FROM meta WHERE key <> …` 的保白名单 —— 最后那处漏一个键，导入就会
 * 把用户的当前偏好一起删掉。
 */
const META_EXCLUDED = ['themeAccent', 'tagline']

/* ---------------- 行形状 ---------------- */

const ACCOUNT_COLS = ['id', 'name', 'icon', 'color', 'initial_balance', 'sort', 'created_at']
const CATEGORY_COLS = ['id', 'name', 'icon', 'color', 'type', 'parent_id', 'sort', 'created_at']
const RECORD_COLS = ['id', 'type', 'account_id', 'to_account_id', 'category_id', 'amount', 'note', 'date', 'created_at', 'transfer_id', 'time']

/** 整数字段取数（SQLite/mock 可能给字符串）；null 保持 null */
const intOf = (v) => (v == null ? null : Number(v))
const strOf = (v) => (v == null ? '' : String(v))

function shapeAccount(r) {
	return {
		id: intOf(r.id),
		name: strOf(r.name),
		icon: strOf(r.icon),
		color: strOf(r.color),
		initial_balance: intOf(r.initial_balance),
		sort: intOf(r.sort),
		created_at: strOf(r.created_at)
	}
}

function shapeCategory(r) {
	return {
		id: intOf(r.id),
		name: strOf(r.name),
		icon: strOf(r.icon),
		color: strOf(r.color),
		type: intOf(r.type),
		parent_id: intOf(r.parent_id),
		sort: intOf(r.sort),
		created_at: strOf(r.created_at)
	}
}

function shapeRecord(r) {
	return {
		id: intOf(r.id),
		type: intOf(r.type),
		account_id: intOf(r.account_id),
		// 老备份没有这两列 —— intOf 是 v == null ? null : Number(v)，缺失天然落成 null，
		// 向后兼容就是这么白送来的（但要用断言钉住，见 backup-repro 第 12 组）
		to_account_id: intOf(r.to_account_id),
		transfer_id: intOf(r.transfer_id),
		category_id: intOf(r.category_id),
		amount: intOf(r.amount),
		note: strOf(r.note),
		date: strOf(r.date),
		// 老备份（导出于「时刻」之前）里没有这个字段 —— strOf 把缺失落成空串，
		// 与「没有时刻」是同一个意思，向后兼容白送（但要用断言钉住，见 backup-repro 第 13 组）
		time: strOf(r.time),
		created_at: strOf(r.created_at)
	}
}

/* ---------------- 导出 ---------------- */

/**
 * 读全部账本数据，序列化成备份文本。
 * 不缩进（省体积 —— 这段文本要过剪贴板与微信）。
 * @returns {Promise<{text: string, exportedAt: string, counts: {accounts:number, categories:number, records:number}}>}
 */
export async function exportBackup() {
	const [aRows, cRows, rRows, mRows] = await Promise.all([
		query(`SELECT ${ACCOUNT_COLS.join(', ')} FROM accounts ORDER BY id`),
		query(`SELECT ${CATEGORY_COLS.join(', ')} FROM categories ORDER BY id`),
		query(`SELECT ${RECORD_COLS.join(', ')} FROM records ORDER BY id`),
		query('SELECT key, value FROM meta')
	])

	const accounts = aRows.map(shapeAccount)
	const categories = cRows.map(shapeCategory)
	const records = rRows.map(shapeRecord)
	const meta = mRows
		.filter((r) => !META_EXCLUDED.includes(strOf(r.key)))
		.map((r) => ({ key: strOf(r.key), value: strOf(r.value) }))

	const exportedAt = now()
	const payload = {
		kind: BACKUP_KIND,
		version: BACKUP_VERSION,
		exportedAt,
		data: { accounts, categories, records, meta }
	}
	return {
		text: JSON.stringify(payload),
		exportedAt,
		counts: { accounts: accounts.length, categories: categories.length, records: records.length }
	}
}

/* ---------------- 校验 ---------------- */

/** 账户名上限 8 字 / 分类名上限 6 字（与 services/account.js、services/category.js 保持一致） */
const MAX_NAME_ACCOUNT = 8
const MAX_NAME_CATEGORY = 6
/** 金额上限（分），与 services/record.js 的 MAX_AMOUNT_CENTS 保持一致 */
const MAX_AMOUNT_CENTS = 9999999999

const isInt = (v) => typeof v === 'number' && Number.isInteger(v)
const isPosInt = (v) => isInt(v) && v > 0

const fail = (message) => ({ ok: false, message })
const pass = (payload) => ({ ok: true, payload })

/**
 * 是不是**真实存在**的日期，而不只是格式对。
 * 格式正则挡不住 2026-02-31，而应用自己的日期走自绘 picker、产生不出非法日期 ——
 * 所以这里拒绝它是安全的，且能挡住手改备份里的怪值（会在统计的月份分桶里产生脏结果）。
 */
function isRealDate(s) {
	if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
	const [y, m, d] = s.split('-').map(Number)
	if (m < 1 || m > 12 || d < 1) return false
	const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
	return d <= days[m - 1]
}

/**
 * 整份校验一段备份文本。**纯函数，不碰数据库。**
 * 通过则返回已规整、已剔除 themeAccent 的 payload（形状与 exportBackup 的产物一致）。
 *
 * 校验的总原则：强度必须对齐「应用本身允许的最松状态」——目的是挡住损坏 / 手改 /
 * 来自更新版本的文件，**不是给数据加新约束**，否则用户拿着自己 App 导出的备份会被
 * 自己的校验拒绝。逐条理由见 spec §5.1。
 * @param {string} text
 * @returns {{ok: true, payload: object} | {ok: false, message: string}}
 */
export function parseBackup(text) {
	if (typeof text !== 'string' || !text.trim()) return fail('剪贴板是空的')

	let raw
	try {
		raw = JSON.parse(text)
	} catch (e) {
		return fail('剪贴板里不是飞鸟记账的备份')
	}

	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('剪贴板里不是飞鸟记账的备份')
	if (raw.kind !== BACKUP_KIND) return fail('剪贴板里不是飞鸟记账的备份')
	if (!isInt(raw.version)) return fail('备份已损坏：缺少版本号')
	if (raw.version > BACKUP_VERSION) return fail('这份备份来自更新的 App 版本，请先升级 App')
	if (!raw.data || typeof raw.data !== 'object' || Array.isArray(raw.data)) return fail('备份已损坏：缺少 data')

	const { accounts, categories, records, meta } = raw.data
	for (const [name, arr] of [['accounts', accounts], ['categories', categories], ['records', records], ['meta', meta]]) {
		if (!Array.isArray(arr)) return fail(`备份已损坏：data.${name} 不是数组`)
	}

	// ---- 账户
	const outAccounts = []
	const accIds = new Set()
	const accNames = new Set()
	for (let i = 0; i < accounts.length; i++) {
		const r = accounts[i]
		const at = `accounts[${i}]`
		if (!r || typeof r !== 'object') return fail(`备份已损坏：${at} 不是对象`)
		if (!isPosInt(r.id)) return fail(`备份已损坏：${at} 的 id 无效`)
		if (accIds.has(r.id)) return fail(`备份已损坏：账户 id ${r.id} 重复`)
		if (typeof r.name !== 'string' || !r.name.trim()) return fail(`备份已损坏：${at} 的名称为空`)
		if ([...r.name].length > MAX_NAME_ACCOUNT) return fail(`备份已损坏：账户名「${r.name}」超过 ${MAX_NAME_ACCOUNT} 个字`)
		if (!isInt(r.initial_balance)) return fail(`备份已损坏：${at} 的初始余额不是整数`)
		if (!isInt(r.sort)) return fail(`备份已损坏：${at} 的排序值不是整数`)
		if (accNames.has(r.name)) return fail(`备份里有重名的账户「${r.name}」`)
		accIds.add(r.id)
		accNames.add(r.name)
		outAccounts.push(shapeAccount(r))
	}
	if (!outAccounts.length) return fail('备份里一个账户都没有')

	// ---- 分类
	const outCategories = []
	const catById = new Map()
	const scopeNames = new Set()
	for (let i = 0; i < categories.length; i++) {
		const r = categories[i]
		const at = `categories[${i}]`
		if (!r || typeof r !== 'object') return fail(`备份已损坏：${at} 不是对象`)
		if (!isPosInt(r.id)) return fail(`备份已损坏：${at} 的 id 无效`)
		if (catById.has(r.id)) return fail(`备份已损坏：分类 id ${r.id} 重复`)
		if (typeof r.name !== 'string' || !r.name.trim()) return fail(`备份已损坏：${at} 的名称为空`)
		if ([...r.name].length > MAX_NAME_CATEGORY) return fail(`备份已损坏：分类名「${r.name}」超过 ${MAX_NAME_CATEGORY} 个字`)
		if (r.type !== 1 && r.type !== 2) return fail(`备份已损坏：${at} 的 type 必须是 1(支出) 或 2(收入)`)
		if (r.parent_id !== null && !isPosInt(r.parent_id)) return fail(`备份已损坏：${at} 的 parent_id 无效`)
		if (!isInt(r.sort)) return fail(`备份已损坏：${at} 的排序值不是整数`)
		catById.set(r.id, { id: r.id, name: r.name, type: r.type, parent_id: r.parent_id })
		outCategories.push(shapeCategory(r))
	}
	for (const c of outCategories) {
		// 同级判重：主分类看「同 type 的主分类」，子分类看「同一父」
		const scope = c.parent_id == null ? `t${c.type}` : `p${c.parent_id}`
		const key = `${scope}|${c.name}`
		if (scopeNames.has(key)) return fail(`备份里有重名的分类「${c.name}」`)
		scopeNames.add(key)

		// 父引用：**存在**的父必须是主分类、且 type 一致；不存在的父允许（历史孤儿子分类，见 spec §5.1）
		if (c.parent_id != null && catById.has(c.parent_id)) {
			const parent = catById.get(c.parent_id)
			if (parent.parent_id != null) return fail('备份已损坏：分类层级超过两层')
			if (parent.type !== c.type) return fail(`备份已损坏：子分类「${c.name}」的收支类型与它的主分类不一致`)
		}
	}

	// ---- 流水
	const outRecords = []
	const recordIds = new Set()
	for (let i = 0; i < records.length; i++) {
		const r = records[i]
		const at = `records[${i}]`
		if (!r || typeof r !== 'object') return fail(`备份已损坏：${at} 不是对象`)
		if (!isPosInt(r.id)) return fail(`备份已损坏：${at} 的 id 无效`)
		if (recordIds.has(r.id)) return fail(`备份已损坏：流水 id ${r.id} 重复`)
		recordIds.add(r.id)
		if (r.type !== 1 && r.type !== 2 && r.type !== 3) return fail(`备份已损坏：${at} 的 type 必须是 1(支出) / 2(收入) / 3(转账)`)
		// 账户必须存在：M6 不变量「每笔流水必有账户」保证应用自己产生不出悬空
		if (!isPosInt(r.account_id)) return fail(`备份已损坏：${at} 没有账户`)
		if (!accIds.has(r.account_id)) return fail(`备份已损坏：第 ${i + 1} 条流水指向的账户不存在`)
		// 转账的**每一端**都得有账户：转入方同样必须存在（它和转出方受同一保护）
		if (r.type === 3) {
			if (!isPosInt(r.to_account_id)) return fail(`备份已损坏：${at} 是转账但没有转入账户`)
			if (!accIds.has(r.to_account_id)) return fail(`备份已损坏：第 ${i + 1} 条转账的转入账户不存在`)
			if (r.to_account_id === r.account_id) return fail(`备份已损坏：${at} 的转入与转出是同一个账户`)
		} else if (r.to_account_id != null) {
			return fail(`备份已损坏：${at} 不是转账，不该有转入账户`)
		}
		// transfer_id 的正负先做行内判断；**它指向谁**要等全表读完才能查（见循环之后那段）
		if (r.transfer_id != null && !isPosInt(r.transfer_id)) return fail(`备份已损坏：${at} 的 transfer_id 无效`)
		// 分类**允许悬空**：deleteCategory 明文规定「不碰 records —— 流水保留，联查不到
		// 分类时页面显示『已删除分类』」，这是设计行为，校验它会把合法备份拒之门外
		if (r.category_id !== null && !isPosInt(r.category_id)) return fail(`备份已损坏：${at} 的分类无效`)
		if (!isInt(r.amount) || r.amount <= 0) return fail(`备份已损坏：${at} 的金额必须是正整数分`)
		if (r.amount > MAX_AMOUNT_CENTS) return fail(`备份已损坏：${at} 的金额超出上限`)
		if (!isRealDate(r.date)) return fail(`备份已损坏：${at} 的日期不是有效日期`)
		if (typeof r.note !== 'string') return fail(`备份已损坏：${at} 的备注不是文本`)
		// 时刻：空串（没有时刻）或 24 小时制的 HH:MM。**允许缺失** —— 老备份里没这个字段，
		// 校验不能把用户自己导出的老备份拒之门外（这与 date 那条不同：date 是必有的）
		if (r.time != null && r.time !== '' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(r.time)) {
			return fail(`备份已损坏：${at} 的时刻不是 24 小时制的时:分`)
		}
		outRecords.push(shapeRecord(r))
	}

	// transfer_id 的**关联**校验必须放在循环**之后**：它要看**全表**才知道那个 id 是不是
	// 一条真转账，而循环里逐行看时后面的记录还没读过。
	for (let i = 0; i < outRecords.length; i++) {
		const r = outRecords[i]
		if (r.transfer_id == null) continue
		const owner = outRecords.find((x) => x.id === r.transfer_id)
		if (!owner) return fail(`备份已损坏：第 ${i + 1} 条记录的 transfer_id 指向不存在的记录`)
		if (owner.type !== 3) return fail(`备份已损坏：第 ${i + 1} 条记录的 transfer_id 指向的不是一条转账`)
		if (r.type !== 1) return fail(`备份已损坏：第 ${i + 1} 条记录挂着 transfer_id，却不是一个支出（手续费行）`)
		if (r.account_id !== owner.account_id) return fail(`备份已损坏：第 ${i + 1} 条手续费行的账户与它所属转账的转出方不一致`)
	}

	// ---- meta：**剔除 themeAccent**（双保险：防止手改的备份覆盖当前主题）
	const outMeta = []
	const metaKeys = new Set()
	for (let i = 0; i < meta.length; i++) {
		const r = meta[i]
		const at = `meta[${i}]`
		if (!r || typeof r !== 'object') return fail(`备份已损坏：${at} 不是对象`)
		if (typeof r.key !== 'string' || !r.key) return fail(`备份已损坏：${at} 的 key 无效`)
		if (typeof r.value !== 'string') return fail(`备份已损坏：${at} 的 value 不是文本`)
		if (META_EXCLUDED.includes(r.key)) continue
		// meta 的 key 是主键：重复的 key 会在事务里撞主键，用户看到的是一句裸 SQL 报错
		// （UNIQUE constraint failed: meta.key）。而 mock 不模拟主键约束 —— 这条路径
		// 在脚本层是隐形的，所以必须在这里显式拦下来。
		if (metaKeys.has(r.key)) return fail(`备份里有重复的设置项「${r.key}」`)
		metaKeys.add(r.key)
		outMeta.push({ key: r.key, value: r.value })
	}

	// ---- 默认账户锚：**2026-10-09 起没人读它了**（默认账户不再有特权），留着这条校验是因为
	// 旧备份里可能带着这个键 —— 它指向一个不存在的账户，说明那份备份确实有问题，拦下来没坏处。
	const anchor = outMeta.find((m) => m.key === 'defaultAccountId')
	if (anchor && !accIds.has(Number(anchor.value))) return fail('备份已损坏：默认账户指向的账户不存在')

	return pass({
		kind: BACKUP_KIND,
		version: raw.version,
		exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
		data: { accounts: outAccounts, categories: outCategories, records: outRecords, meta: outMeta }
	})
}

/* ---------------- 导入 ---------------- */

/** 一次 executeSql 里塞多少条语句。真机一句 executeSql 只能带一条 SQL，所以走数组分批 */
const BATCH = 500

/** 导入单飞标志：两个事务并发会锁库（spec §5.3） */
let importing = false

/** SQL 字面量：数字直接内联（校验阶段已保证是整数）、字符串过 esc、null 走 NULL */
const lit = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : esc(v))

function insertStatements(table, cols, rows) {
	return rows.map((r) => `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => lit(r[c])).join(', ')})`)
}

/**
 * 用一份**已通过 parseBackup 校验**的备份整体替换当前数据。
 *
 * 三步（spec §5）：① 校验已在调用方做完 ② 快照当前数据 ③ 事务替换。
 * ②在事务之外先做，且尽力而为 —— 快照失败不能反噬导入本身。
 *
 * @param {object} payload parseBackup 的产物
 * @returns {Promise<{counts: {accounts:number, categories:number, records:number}}>}
 */
export async function importBackup(payload) {
	if (importing) throw new Error('正在导入，请稍候')
	importing = true
	try {
		const { accounts, categories, records, meta } = payload.data

		// ② 快照：尽力而为。失败不阻断 —— 快照只是安全网，它本身不该成为导入失败的理由。
		// 但必须**如实上报**（snapshotOk），并清掉旧快照：留着上一份会让「撤销」把用户
		// 送到更早的状态，而界面文案写的是「上次导入之前」。
		let snapshotOk = true
		try {
			const snap = await exportBackup()
			await writeSnapshot(snap.text, snap.exportedAt)
		} catch (e) {
			snapshotOk = false
			try {
				await exec('DELETE FROM backup_snapshot')
			} catch (e2) {
				// 连清都清不掉，只能靠返回值让页面提示「本次无法撤销」
			}
		}

		// ③ 事务替换。txBegin 也在 try 之内：begin 的 fail 回调触发时，原生侧的事务
		// 可能已经开了 —— 那条路径同样必须尝试回滚，否则全 App 锁库。
		let committed = false
		try {
			await txBegin()
			const metaKeep = META_EXCLUDED.map((k) => `key <> ${esc(k)}`).join(' AND ')
			const stmts = [
				'DELETE FROM records',
				'DELETE FROM categories',
				'DELETE FROM accounts',
				`DELETE FROM meta WHERE ${metaKeep}`
			]
				.concat(insertStatements('accounts', ACCOUNT_COLS, accounts))
				.concat(insertStatements('categories', CATEGORY_COLS, categories))
				.concat(insertStatements('records', RECORD_COLS, records))
				.concat(insertStatements('meta', ['key', 'value'], meta))

			for (let i = 0; i < stmts.length; i += BATCH) {
				await exec(stmts.slice(i, i + BATCH))
			}
			await txCommit()
			committed = true
		} finally {
			// begin 之后**任何**没走到 commit 的退出路径都必须回滚，否则 SQLite 会锁库
			// （之后所有操作报 database is locked）。所以是 finally 而不是 catch。
			if (!committed) await txRollback().catch(() => {})
		}

		return {
			counts: { accounts: accounts.length, categories: categories.length, records: records.length },
			snapshotOk
		}
	} finally {
		importing = false
	}
}

/* ---------------- 快照 ---------------- */

/**
 * 写快照（覆盖最近一份）。只在导入流程里调，**必须在事务之外**：事务要 DELETE 的是
 * 四张账本表，快照表不参与替换，事务回滚也不该动它。
 */
export async function writeSnapshot(text, exportedAt) {
	await exec('DELETE FROM backup_snapshot')
	await exec(
		`INSERT INTO backup_snapshot (id, exported_at, payload) VALUES (1, ${esc(exportedAt)}, ${esc(text)})`
	)
}

/* ---------------- 撤销 ---------------- */

/**
 * 读快照的**元信息**（不读大字段 payload）。页面 onShow 每次都要问一次，
 * 不能为了显示一行字把整份 payload 拉出来。
 * @returns {Promise<{exportedAt: string} | null>}
 */
export async function readSnapshotInfo() {
	const rows = await query('SELECT exported_at FROM backup_snapshot WHERE id = 1')
	return rows.length ? { exportedAt: String(rows[0].exported_at) } : null
}

/**
 * 撤销上次导入：拿快照**再走一遍导入流程**（所以它自己也会先做一份新快照，
 * 于是「撤销」可以来回切）。
 */
export async function undoLastImport() {
	const rows = await query('SELECT payload FROM backup_snapshot WHERE id = 1')
	if (!rows.length) throw new Error('没有可撤销的导入')
	const parsed = parseBackup(String(rows[0].payload))
	if (!parsed.ok) throw new Error('上次导入前的快照已损坏，无法撤销')
	return importBackup(parsed.payload)
}
