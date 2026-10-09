/**
 * services/db.js —— 数据层：唯一接触 plus.sqlite 的模块
 * 页面和服务层一律通过本模块的 initDB/exec/query 访问数据库
 * 用户输入拼 SQL 前必须过 esc()
 */
// 预置分类/账户的种子色取自色板（services/palette.js）。它**不 import 任何东西**，
// 所以 db.js 引它不会成环（meta.js 依赖 db.js，而 palette 不依赖任何人）。
import { paletteColor as pal } from './palette.js'

const DB_NAME = 'ledger'
const DB_PATH = '_doc/ledger.db' // _doc/ 为应用沙箱内的文档目录
const DEBUG = false // 每次 SQL 都打日志，只在排查时临时开

let initPromise = null // 单例：整个应用只初始化一次

function log(...args) {
	if (DEBUG) console.log('[db]', ...args)
}

/** 内部写操作（不含初始化守卫）——仅 initDB 流程内部使用，避免循环 await 死锁 */
function execRaw(sql) {
	// sql 可以是单条字符串，也可以是字符串数组（批量）。数组形式真机必须走数组 ——
	// Android 不支持用分号拼接多条 SQL。日志与报错都要能处理这两种形态。
	const shown = Array.isArray(sql) ? `${sql.length} 条语句` : sql
	return new Promise((resolve, reject) => {
		log('exec  ▸', shown)
		plus.sqlite.executeSql({
			name: DB_NAME,
			sql,
			success: () => resolve(),
			fail: (e) => reject(new Error(`SQL执行失败: ${e.message} | ${shown}`))
		})
	})
}

/** 内部读操作（不含初始化守卫）——仅 initDB 流程内部使用 */
function queryRaw(sql) {
	return new Promise((resolve, reject) => {
		log('query ▸', sql)
		plus.sqlite.selectSql({
			name: DB_NAME,
			sql,
			success: (rows) => resolve(rows),
			fail: (e) => reject(new Error(`SQL查询失败: ${e.message} | ${sql}`))
		})
	})
}

/**
 * 守卫层自愈：裸函数失败后重验连接。
 * 连接被系统后台回收（isOpenDatabase 为 false）→ 重置单例、重新初始化、重试一次；
 * 连接仍在 → 是 SQL 本身的错，原样抛出，不做无意义重试。
 * single-flight：并发失败共享同一次重初始化（healPromise），杜绝重复初始化套娃。
 */
let healPromise = null

/**
 * 事务是否开着。事务期间连接失效时**绝不能**走自愈的「重初始化 + 重试一次」：
 * 重连会丢掉事务，被重试的那条语句会跑到事务之外（autocommit），而 initDB 还会
 * 重跑 migrate/seedIfEmpty —— 数据导入的「整体替换」就不再是原子的了。
 * 由 txBegin/txCommit/txRollback 维护。
 */
let inTx = false

async function withHeal(run) {
	try {
		return await run()
	} catch (e) {
		// 事务中途不 heal：直接抛出，由调用方回滚（见上）
		if (inTx) throw e
		if (plus.sqlite.isOpenDatabase({ name: DB_NAME, path: DB_PATH })) throw e
		if (!healPromise) {
			healPromise = (async () => {
				log('连接已失效，重新初始化后重试一次')
				initPromise = null
				await initDB()
			})().finally(() => {
				healPromise = null
			})
		}
		await healPromise
		return await run()
	}
}

/**
 * 事务控制。plus.sqlite 的 transaction 是独立 API，operation 取 begin/commit/rollback。
 *
 * 用它的地方（数据导入）必须保证 begin 之后**任何**退出路径都走到 commit 或 rollback：
 * 官方已知坑——事务开着没关，SQLite 会锁库，之后所有操作都报 database is locked。
 * 所以调用方的 rollback 要写在 finally 里（见 services/backup.js）。
 */
function txOp(operation) {
	return new Promise((resolve, reject) => {
		log('tx    ▸', operation)
		plus.sqlite.transaction({
			name: DB_NAME,
			path: DB_PATH,
			operation,
			success: () => resolve(),
			fail: (e) => reject(new Error(`事务 ${operation} 失败: ${e.message}`))
		})
	})
}

/** 开始事务（先确保库已初始化——事务必须在库打开之后开） */
export async function txBegin() {
	await initDB()
	inTx = true
	try {
		return await txOp('begin')
	} catch (e) {
		inTx = false
		throw e
	}
}

/** 提交事务 */
export async function txCommit() {
	try {
		return await txOp('commit')
	} finally {
		inTx = false
	}
}

/** 回滚事务 */
export async function txRollback() {
	try {
		return await txOp('rollback')
	} finally {
		inTx = false
	}
}

/** 执行写操作：先确保库已初始化（单例幂等，已就绪时近乎零开销）。sql 可以是字符串或字符串数组 */
export async function exec(sql) {
	await initDB()
	return withHeal(() => execRaw(sql))
}

/** 执行读操作：先确保库已初始化 */
export async function query(sql) {
	await initDB()
	return withHeal(() => queryRaw(sql))
}

/** SQL 字符串字面量转义：plus.sqlite 不支持参数绑定，一切用户输入拼接前必须过此函数 */
export function esc(value) {
	if (value === null || value === undefined) return 'NULL'
	return `'${String(value).replace(/'/g, "''")}'`
}

/** 'YYYY-MM-DD HH:mm:ss' 本地时间。不能用 toISOString()，它返回 UTC，中国时区会差 8 小时 */
export function now() {
	const d = new Date()
	const p = (n) => String(n).padStart(2, '0')
	return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function open() {
	return new Promise((resolve, reject) => {
		log('open  ▸', DB_NAME, DB_PATH)
		plus.sqlite.openDatabase({
			name: DB_NAME,
			path: DB_PATH,
			success: () => resolve(),
			fail: (e) => reject(new Error(`打开数据库失败: ${e.message}`))
		})
	})
}

// 与设计文档 §6 对应；categories 为 v1 形态（M3.5：icon 改 svg key、新增 color/parent_id），meta 为 M3.5 新增
const CREATE_TABLES = [
	`CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT DEFAULT 'svg:package',
    color TEXT DEFAULT '',
    initial_balance INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
	`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    icon TEXT DEFAULT 'svg:package',
    color TEXT DEFAULT '',
    type INTEGER NOT NULL,
    parent_id INTEGER,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
	// records 的两列（2026-10-04「转账」）：
	//   to_account_id —— 转账的对方账户；仅 type = 3 有意义，其余行为 NULL
	//   transfer_id   —— 仅「手续费行」有值，指向它所属的转账行；其余行为 NULL。
	//                    它让删除 / 编辑转账时能找到并同步那笔手续费
	//                    （否则删了转账，手续费会残留成一条无主的孤儿支出）
	// records 的 time 列（2026-10-04「时刻」）：'HH:MM'（24 小时制），空串 = 没有时刻（老流水）。
	//   ★ 迁移必须把 ALTER 补出来的 NULL 收敛成空串：按时刻排序时 NULL 与空串位置不同，
	//     不收敛就有两种行为 —— 真机上老流水排在当天最后、脚本里插到中间。
	// 注：说明写在 JS 这一侧，**不写进 SQL 字符串** —— mock 的建表解析器会把 `--`
	// 当成一个列名，多出假列（真 SQLite 不受影响，但脚本环境会与真机走散）
	`CREATE TABLE IF NOT EXISTS records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type INTEGER NOT NULL,
    account_id INTEGER,
    to_account_id INTEGER,
    category_id INTEGER,
    amount INTEGER NOT NULL,
    note TEXT DEFAULT '',
    date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    transfer_id INTEGER,
    time TEXT,
    prepay_id INTEGER,
    prepay_done INTEGER DEFAULT 0,
    internal INTEGER DEFAULT 0
  )`,
	`CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
	// 导入前的数据快照（单行，id 恒为 1，写入即覆盖）。**存库而不是存文件** ——
	// 文件方案要碰 plus.io（本项目从未用过、零脚本覆盖），存库后整条撤销路径都落在
	// 已被复现脚本压过的 db.js 上，能被真实测到。详见 spec §5.2。
	// 它不参与导入时的四张表替换，事务回滚也不动它。
	`CREATE TABLE IF NOT EXISTS backup_snapshot (
    id INTEGER PRIMARY KEY,
    exported_at TEXT NOT NULL,
    payload TEXT NOT NULL
  )`,
	// 索引让 date 的范围过滤走 B+ 树而不是全表扫描；IF NOT EXISTS 天然幂等，
	// 老库重开时自动补建，不需要迁移函数（与 CREATE TABLE IF NOT EXISTS 同一套路）
	`CREATE INDEX IF NOT EXISTS idx_records_date ON records(date)`,
	// 账户名唯一（M6）：服务层也查重，但迁移是绕过服务层用裸 SQL 插「默认账户」的，
	// 索引是那条路径唯一的结构性保护；将来哪条新路径漏了校验也是报错而非静默重名
	`CREATE UNIQUE INDEX IF NOT EXISTS idx_accounts_name ON accounts(name)`
]

/**
 * 预置分类：种子与 v0→v1 迁移共用这份数据。
 * 颜色与 docs/design/2026-10-01-md3-preview.html 定稿一致；icon 为 svg: 前缀（services/icons.js 的 ICONS 键）。
 */
/**
 * 两个「差异调节」分类的 id（支出侧 / 收入侧），**只返回表里真的还在的那些**。
 *
 * 与 `getFeeCategoryId`（record.js）同一套路：锚存在 meta，但备份恢复 / 手工删表之后
 * 锚可能指向一个不存在的行，所以读出来还得验一遍 —— 悬空的那一侧给 null，
 * 调用方本来就要按「有没有」分支（没有就没法反算、也没法记账）。
 *
 * 为什么放 db.js：写这两个锚的代码就在本文件（seedIfEmpty / migrateAdjustCategory），
 * 读写共处一份 key 列表；而 account.js（改余额）和 record.js（标记调整流水）都要用它，
 * 放进其中任何一个都会造成两个服务互相 import。
 * @returns {Promise<{out: number|null, in: number|null}>} out = 支出侧（余额调低），in = 收入侧（余额调高）
 */
export async function getAdjustCategoryIds() {
	const read = async (key) => {
		const [row] = await queryRaw(`SELECT value FROM meta WHERE key = ${esc(key)}`)
		const n = Number(row && row.value)
		if (!Number.isInteger(n) || n <= 0) return null
		const [hit] = await queryRaw(`SELECT id FROM categories WHERE id = ${n}`)
		return hit ? n : null
	}
	return { out: await read('adjustCategoryIdOut'), in: await read('adjustCategoryIdIn') }
}

/**
 * 预置分类的种子。**导出给测试用**（scripts/icons-repro.mjs 要核「预置分类用的图标还在选择器里」）。
 *
 * `internal: true` = 内部件：由内部动作带出来、用户在任何选择器里都见不到的分类
 * （转账带出手续费、改余额带出差异调节），`getCategoriesGrouped()` 会摘掉它们。
 * 目前只给 icons-repro 放行一条断言 —— 那条要求「预置分类用的图标必须在它那一类的
 * 选择器里」，理由是「编辑它时选中态会落空」；内部件压根编辑不到，前提不成立。
 * ★ 内部件的图标仍必须存在于 ICONS（那条断言照旧管），只是不必在选择器里。
 */
export const PRESET_CATEGORIES = [
	{ name: '餐饮', icon: 'svg:utensils', color: pal('amber'), type: 1, sort: 1 },
	{ name: '交通', icon: 'svg:bus', color: pal('blue'), type: 1, sort: 2 },
	{ name: '购物', icon: 'svg:bag', color: pal('wisteria'), type: 1, sort: 3 },
	{ name: '居住', icon: 'svg:house', color: pal('teal'), type: 1, sort: 4 },
	{ name: '娱乐', icon: 'svg:gamepad', color: pal('rose'), type: 1, sort: 5 },
	// 医疗原来自己一色（青蓝）。色板收成 10 个之后与「居住」共用青碧 —— 12 个预置分类
	// 配 10 个色，必然有两对共用（另一对是 娱乐/红包）。共用不影响任何逻辑：
	// 「选中」是按色值相等的，两处都能正确高亮。
	{ name: '医疗', icon: 'svg:pill', color: pal('teal'), type: 1, sort: 6 },
	{ name: '学习', icon: 'svg:book', color: pal('iris'), type: 1, sort: 7 },
	// 「其他」用石墨灰：它本来就该是不抢眼的中性色，而且这个值就是 category-icon 的兜底色
	{ name: '其他', icon: 'svg:package', color: pal('graphite'), type: 1, sort: 8 },
	// internal: 详情见下面那段 —— 内部件，不进任何选择器
	{ name: '手续费', icon: 'svg:banknote', color: pal('olive'), type: 1, sort: 9, internal: true },
	{ name: '工资', icon: 'svg:banknote', color: pal('terracotta'), type: 2, sort: 1 },
	{ name: '理财', icon: 'svg:trend', color: pal('olive'), type: 2, sort: 2 },
	{ name: '红包', icon: 'svg:gift', color: pal('rose'), type: 2, sort: 3 },
	{ name: '其他收益', icon: 'svg:sparkles', color: pal('green'), type: 2, sort: 4 },
	// ★ 两个「差异调节」（2026-10-09）：改余额时选「记一笔调整」要落的分类。
	//   它们与「手续费」同属内部件（`internal: true`）—— getCategoriesGrouped 里会摘掉
	//   （分类管理看不到、记一笔也选不到），但**表里那两行是真的**，所以统计里会出现
	//   「差异调节」这一项。两个（支出侧 + 收入侧）是因为差额有正负：
	//   余额调低记支出、调高记收入。sort 给 99：排在所有正经分类后面（它们本来也不露脸）。
	//   图标两边**统一 calculator**（用户裁定）：它俩对用户是同一件事，同一个图标才认得出
	//   是一类；反正内部件不进选择器，不必迁就「支出分类只能用支出批图标」那条（见 internal）。
	{ name: '差异调节', icon: 'svg:calculator', color: pal('graphite'), type: 1, sort: 99, internal: true },
	{ name: '差异调节', icon: 'svg:calculator', color: pal('graphite'), type: 2, sort: 99, internal: true },
	// ★ 「预付差额」（2026-10-09）：预付收回时**多收**的那部分落的分类（收入）。
	//   同属内部件 —— 用户手动选它记收入就是凭空造一笔差额。sort 98，排在差异调节前面。
	{ name: '预付差额', icon: 'svg:handshake', color: pal('olive'), type: 2, sort: 98, internal: true }
]

/**
 * v0 → v1 迁移（M3.5）：老库补 parent_id/color 两列 + 旧 emoji 图标换 svg key + 补预置色。
 * 幂等靠逐项守卫而非版本号：v0 老库没有版本记录，user_version 只写不读（供未来参考）。
 *
 * 区分「v0 预置行」与「用户自建行」必须靠 parent_id，不能只看 name：
 * M3.5 的「新增子分类」允许用户建出与预置同名的子分类（如学习 → 其他），
 * 若按 name 匹配，每次冷启动都会把用户的 color=''/icon='' 覆写成预置值——静默、持久、且 M3.5 无 UI 可撤销。
 * v0 表是平铺的，补列后所有 v0 行的 parent_id 均为 NULL；用户自建子分类恒有 parent_id。
 */
/** 老账户图标 emoji → svg key（按旧值精确匹配，幂等） */
const ACCOUNT_ICON_MIGRATION = [
	['💬', 'svg:phone'],
	['💵', 'svg:banknote'],
	['🏦', 'svg:landmark']
]

/**
 * M6 迁移：老账户图标换 svg key；老流水（account_id 为 NULL）归入新建的「默认账户」。
 *
 * 时序：initDB 是「建表 → migrate() → seedIfEmpty()」，本函数跑在种子**之前**——
 * 全新安装的账户由种子在之后插入，所以种子里直接写 svg key，这里只服务老库。
 * 标记 migrated.account 保证只跑一次：全新安装没有老流水、不建「默认账户」，
 * 但同样写标记，免得每次冷启动都查一遍 records。
 *
 * 不用 `UPDATE ... SET account_id = (SELECT ...)` 子查询：先查、再插、再更新，
 * 与项目其它写入同一形态，也过得去内存 mock（它不解析子查询）。
 */
async function migrateAccounts() {
	const already = await queryRaw(`SELECT value FROM meta WHERE key = 'migrated.account'`)
	if (already.length) return

	for (const [from, to] of ACCOUNT_ICON_MIGRATION) {
		await execRaw(`UPDATE accounts SET icon = ${esc(to)} WHERE icon = ${esc(from)}`)
	}

	const [orphanRow] = await queryRaw('SELECT COUNT(*) AS c FROM records WHERE account_id IS NULL')
	const orphans = Number(orphanRow?.c || 0)
	if (orphans > 0) {
		const t = now()
		// 放第一行（用户裁定）：sort=0 小于种子账户的 1..3。它就是个普通账户，
		// 之后能改名 / 改图标颜色 / 排序 / 删除（2026-10-09）—— 这里只是给个顺眼的初始外观
		await execRaw(
			`INSERT INTO accounts (name, icon, initial_balance, sort, created_at) VALUES ('默认账户', 'svg:house', 0, 0, '${t}')`
		)
		// 账户名有唯一索引，取第一行即所求
		const [newRow] = await queryRaw(`SELECT id FROM accounts WHERE name = '默认账户'`)
		const newId = Number(newRow.id)
		await execRaw(`UPDATE records SET account_id = ${newId} WHERE account_id IS NULL`)
		log(`迁移：${orphans} 笔老流水归入「默认账户」(id=${newId})`)
	}

	await execRaw(`INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated.account', ${esc(now())})`)
}

/**
 * M6 反馈轮迁移：① accounts 补 color 列（账户图标底色）；② 「默认账户」置顶。
 *
 * 为什么要独立一个函数：上面那步已被 meta.migrated.account 短路，跑过 M6 的设备不会再进；
 * 而这两件事对**老设备**同样要做（它们的默认账户还在最后一行、accounts 还没有 color 列）。
 *
 * ★ 2026-10-09：原来还在这里记 `meta.defaultAccountId` 这个「受保护账户」的身份锚，
 *   连同下面那个 migrateAccountFace 一起删掉了 —— 默认账户不再特殊（可改名 / 改图标 /
 *   改颜色 / 排序 / 删除，见 services/account.js），锚没有任何人读了。
 *   置顶那一下留着：老设备上它本来就该在第一行，而这只跑一次，用户之后可以自己排。
 */
async function migrateAccountHead() {
	const already = await queryRaw(`SELECT value FROM meta WHERE key = 'migrated.acctHead'`)
	if (already.length) return

	const cols = await queryRaw('PRAGMA table_info(accounts)')
	if (!cols.map((c) => c.name).includes('color')) {
		log('迁移：accounts 增加 color 列')
		await execRaw(`ALTER TABLE accounts ADD COLUMN color TEXT DEFAULT ''`)
	}

	const [row] = await queryRaw(`SELECT id FROM accounts WHERE name = '默认账户'`)
	if (row) {
		const id = Number(row.id)
		await execRaw(`UPDATE accounts SET sort = 0 WHERE id = ${id}`)
		log(`默认账户置顶（id=${id}）`)
	}

	await execRaw(`INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated.acctHead', ${esc(now())})`)
}

/**
 * 2026-10-04 用户裁定：预置账户的外观换一版 —— 现金改用钱包（原钞票）、银行卡改用信用卡
 * （原银行大楼）。
 *
 * 种子改了只影响新装，老库这两个账户会停在旧图标上 —— 用户看到的是「改了怎么没变」。
 * 所以这里跟着换。
 *
 * 只改**还停在旧预置外观**的那些：名字与图标**同时**等于旧种子值才动 —— 用户自己挑过
 * 图标的不碰。双条件也让它天然幂等（改完即不再匹配），标记只是兜底。
 */
async function migrateAccountIcons() {
	const already = await queryRaw(`SELECT value FROM meta WHERE key = 'migrated.acctIcon'`)
	if (already.length) return

	const PAIRS = [
		['现金', 'svg:banknote', 'svg:wallet'],
		['银行卡', 'svg:landmark', 'svg:credit-card']
	]
	for (const [name, from, to] of PAIRS) {
		await execRaw(`UPDATE accounts SET icon = ${esc(to)} WHERE name = ${esc(name)} AND icon = ${esc(from)}`)
	}

	await execRaw(`INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated.acctIcon', ${esc(now())})`)
}

/**
 * 2026-10-04 用户裁定：预置账户「银行卡」的默认底色 玫红 → 陶土。
 *
 * 与 migrateAccountIcons 同一条规矩 —— 种子只影响新装，已装的设备必须靠迁移，
 * 否则用户看到的是「改了怎么没变」。
 *
 * **守卫扣在「要改的那个属性」上**（这条比 migrateAccountIcons 那条更值得记）：
 * 图标迁移守 name + 旧图标，这里守 name + 旧颜色。这样用户**自己挑过颜色**的账户
 * 一律不碰，而与自己挑过图标、没动颜色的账户无关 —— 各管各的，互不牵连。
 *
 * 三种「还是默认」的形态，各要一条语句（不能合并成 IN/OR）：
 *   ① 预置的玫红 —— 正常老库；
 *   ② 空串 —— 用户手清过色，或这个账户从来就没设过色；
 *   ③ NULL —— 老库的 color 列是 ALTER 补出来的，落的是 NULL，**与空串不是一回事**
 *      （SQLite 里 `NULL = ''` 为假，所以 ② 那条盖不住它）。
 * 三条都只匹配「名字是银行卡」，用户改过名的不碰。
 */
async function migrateAccountColor() {
	const already = await queryRaw(`SELECT value FROM meta WHERE key = 'migrated.acctColor'`)
	if (already.length) return

	const NAME = esc('银行卡')
	const TO = esc(pal('terracotta'))
	await execRaw(`UPDATE accounts SET color = ${TO} WHERE name = ${NAME} AND color = ${esc(pal('rose'))}`)
	await execRaw(`UPDATE accounts SET color = ${TO} WHERE name = ${NAME} AND color = ''`)
	await execRaw(`UPDATE accounts SET color = ${TO} WHERE name = ${NAME} AND color IS NULL`)

	await execRaw(`INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated.acctColor', ${esc(now())})`)
}

/**
 * 2026-10-04「转账」：老库补一个「手续费」支出分类，并把它的 id 写进 meta.feeCategoryId。
 *
 * ★ 两条守卫缺一不可：
 *
 * ① `migrated.feeCat` 标记 —— 补列（records / categories 那四列）有 PRAGMA 那个天然幂等的
 *    判据，而「新建一个分类」没有：不加标记的话，用户把这个分类删掉之后**每次冷启动都会
 *    再建一个回来**，那正是 spec §5.5 明确要避免的行为（看着像 bug）。
 *
 * ② **分类表为空就什么都不做** —— `initDB()` 的顺序是「建表 → migrate() → seedIfEmpty()」，
 *    而 `seedIfEmpty` 是用「categories 为空」来判定要不要播预置分类的。迁移若在这时插一行
 *    手续费进去，那个判据当场不成立，**12 个预置分类一个都播不下来**（真机上是灾难性的：
 *    新装用户打开 App 只有一个「手续费」分类）。空表 = 这是新装，手续费由 PRESET_CATEGORIES
 *    随其余预置一起播下，这里别插手。
 *
 * 身份锚按 id 不按名字：用户把「手续费」改名成「转账费」之后锚仍然指着它，
 * 手续费行不会因此挂空。（账户那边的 defaultAccountId 锚已于 2026-10-09 废除 ——
 * 默认账户不再有特权，锚也就没人读了。）
 */
async function migrateFeeCategory() {
	const already = await queryRaw(`SELECT value FROM meta WHERE key = 'migrated.feeCat'`)
	if (already.length) return

	// 见上面 ②：新装的分类交给 seedIfEmpty 一次播下（PRESET_CATEGORIES 里含手续费）
	const [catCount] = await queryRaw('SELECT COUNT(*) AS c FROM categories')
	if (Number(catCount.c) === 0) return

	let [row] = await queryRaw(`SELECT id FROM categories WHERE name = '手续费' AND type = 1`)
	if (!row) {
		await execRaw(
			`INSERT INTO categories (name, icon, color, type, parent_id, sort, created_at) VALUES
       ('手续费', 'svg:banknote', ${esc(pal('olive'))}, 1, NULL, 9, ${esc(now())})`
		)
		;[row] = await queryRaw(`SELECT id FROM categories WHERE name = '手续费' AND type = 1`)
	}
	await execRaw(`INSERT OR REPLACE INTO meta (key, value) VALUES ('feeCategoryId', ${esc(String(row.id))})`)
	await execRaw(`INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated.feeCat', ${esc(now())})`)
}

/**
 * 两个「差异调节」分类（2026-10-09）：改账户余额时选「记一笔调整」要落的分类。
 *
 * 与手续费同一套路（见上面那段）：内部件、锚按 id 存 meta、空表交给 seedIfEmpty。
 * ★ 一处不同：这里要按 **name + type** 找，不能只按名字 —— 两侧同名（支出一个、收入一个），
 *   只按名字取到哪一个是随机的，而「余额调低记支出、调高记收入」要求严格对应。
 *
 * 两个分类而不是一个：差额有正负，支出侧的落 `type = 1`、收入侧落 `type = 2`，
 * 混用一个会让「调整」跑进错误的统计口径里。
 */
async function migrateAdjustCategory() {
	const already = await queryRaw(`SELECT value FROM meta WHERE key = 'migrated.adjustCat'`)
	if (already.length) return

	// 空表 = 新装，交给 seedIfEmpty 一次播下（PRESET_CATEGORIES 里含这两个，锚也由它写）
	const [catCount] = await queryRaw('SELECT COUNT(*) AS c FROM categories')
	if (Number(catCount.c) === 0) return

	for (const [type, key] of [[1, 'adjustCategoryIdOut'], [2, 'adjustCategoryIdIn']]) {
		// 两侧同一个图标（用户裁定）：对用户是同一件事，同一个图标才认得出是一类
		const icon = 'svg:calculator'
		let [row] = await queryRaw(`SELECT id FROM categories WHERE name = '差异调节' AND type = ${type}`)
		if (!row) {
			await execRaw(
				`INSERT INTO categories (name, icon, color, type, parent_id, sort, created_at) VALUES
       ('差异调节', ${esc(icon)}, ${esc(pal('graphite'))}, ${type}, NULL, 99, ${esc(now())})`
			)
			;[row] = await queryRaw(`SELECT id FROM categories WHERE name = '差异调节' AND type = ${type}`)
		}
		await execRaw(`INSERT OR REPLACE INTO meta (key, value) VALUES (${esc(key)}, ${esc(String(row.id))})`)
	}
	await execRaw(`INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated.adjustCat', ${esc(now())})`)
}

/**
 * 把「差异调节」两侧的图标统一成 calculator（2026-10-09 用户裁定：不管收支都用计算机）。
 *
 * ★ 为什么不能只改 PRESET_CATEGORIES：那只管**以后新建**的库。已经装过的设备上那两行早就
 *   建好了（migrateAdjustCategory 建的，支出侧当时是扳手），改常量对它一点影响都没有 ——
 *   用户会看到支出那条调整流水还是扳手。存量数据只能靠迁移改。
 *
 * 无条件覆盖两行：这个分类在分类管理里看不到、也编辑不到，不存在「用户自己换过图标」的情况。
 * 用 name 匹配就够（两侧同名，本来就要一起改）；带标记保证幂等。
 */
async function migrateAdjustIcon() {
	const already = await queryRaw(`SELECT value FROM meta WHERE key = 'migrated.adjustIcon'`)
	if (already.length) return
	await execRaw(`UPDATE categories SET icon = 'svg:calculator' WHERE name = '差异调节'`)
	await execRaw(`INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated.adjustIcon', ${esc(now())})`)
}

/**
 * 预付（垫付 / 报销）：records 补三列 + 两样「内部件」（2026-10-09）。
 *
 * 三列的分工（详见 services/prepay.js 与 docs 里的设计）：
 *   prepay_id    收回 / 差额 / 结清支出那几条，指向**预付那条**的 id；预付那条自己是 NULL
 *   prepay_done  预付那条：0 = 还挂着（待回收），1 = 已结清
 *   internal     内部搬运（收回、结清时的转账）：1 = 不进首页明细；记录本身是真的，余额照算
 *
 * 两样内部件，同一套路（见 migrateFeeCategory）：
 *   「预付差额」分类 —— 多收的那部分记成收入，落在它上面（type 2，用户选不到）
 *   预付账户 —— 钱的落脚点（垫出去的钱记在它名下，余额 = 还有多少在外面）
 *
 * 空表 = 新装：分类交给 seedIfEmpty 一次播下（PRESET_CATEGORIES 里有），账户也由它 INSERT。
 */
async function migratePrepay() {
	const already = await queryRaw(`SELECT value FROM meta WHERE key = 'migrated.prepay'`)
	if (already.length) return

	// ① records 三列（新库由 CREATE TABLE 直接带上，这里只管老库）
	const cols = (await queryRaw('PRAGMA table_info(records)')).map((c) => c.name)
	for (const [name, ddl] of [
		['prepay_id', 'INTEGER'],
		['prepay_done', 'INTEGER DEFAULT 0'],
		['internal', 'INTEGER DEFAULT 0']
	]) {
		if (!cols.includes(name)) {
			log(`迁移：records 增加 ${name} 列`)
			await execRaw(`ALTER TABLE records ADD COLUMN ${name} ${ddl}`)
		}
	}

	// ②③ 两个内部件：只对**已有数据**的库建（空库交给 seedIfEmpty，否则会建两遍）
	const [catCount] = await queryRaw('SELECT COUNT(*) AS c FROM categories')
	if (Number(catCount.c) > 0) {
		let [cat] = await queryRaw(`SELECT id FROM categories WHERE name = '预付差额' AND type = 2`)
		if (!cat) {
			await execRaw(
				`INSERT INTO categories (name, icon, color, type, parent_id, sort, created_at) VALUES
       ('预付差额', 'svg:handshake', ${esc(pal('olive'))}, 2, NULL, 98, ${esc(now())})`
			)
			;[cat] = await queryRaw(`SELECT id FROM categories WHERE name = '预付差额' AND type = 2`)
		}
		await execRaw(`INSERT OR REPLACE INTO meta (key, value) VALUES ('prepayDiffCategoryId', ${esc(String(cat.id))})`)
	}

	const [accCount] = await queryRaw('SELECT COUNT(*) AS c FROM accounts')
	if (Number(accCount.c) > 0) {
		let [acc] = await queryRaw(`SELECT id FROM accounts WHERE name = '预付账户'`)
		if (!acc) {
			await execRaw(
				`INSERT INTO accounts (name, icon, color, initial_balance, sort, created_at) VALUES
       ('预付账户', 'svg:hand-coins', '', 0, 99, ${esc(now())})`
			)
			;[acc] = await queryRaw(`SELECT id FROM accounts WHERE name = '预付账户'`)
		}
		await execRaw(`INSERT OR REPLACE INTO meta (key, value) VALUES ('prepayAccountId', ${esc(String(acc.id))})`)
	}

	await execRaw(`INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated.prepay', ${esc(now())})`)
}

/**
 * 把「结清时那笔内部转账」的标记从 1 改成 2（2026-10-09，同日稍晚）。
 *
 * 为什么要分这两个值：收回的搬运和结清的搬运**长得一模一样**（同是 type 3、同挂 prepay_id），
 * 而「取消结清」必须认准后者删掉。早先只有 1 一个值，于是**老代码结清过的那几笔**在新代码里
 * 被当成「收回」，取消结清时删不掉它 —— 用户会看到取消之后「已收」凭空多出那笔差额。
 *
 * 认领要两个条件同时成立（只按金额会误伤「收回的钱正好等于差额」那种巧合）：
 *   ① 这笔转账的收款方 = **该预付的原支出账户**（结清是转回原账户；收回是转到用户选的账户）
 *   ② 金额 = 同一笔预付下那笔支出（type = 1）的金额（两者同额是 settlePrepay 的写法决定的）
 */
async function migrateSettleInternal() {
	const already = await queryRaw(`SELECT value FROM meta WHERE key = 'migrated.settleInternal'`)
	if (already.length) return

	// 预付条自己 → 它的原支出账户（只有预付那条是「转进预付账户 + 带分类」）
	const [prepayAccRow] = await queryRaw(`SELECT value FROM meta WHERE key = 'prepayAccountId'`)
	const prepayAcc = Number(prepayAccRow && prepayAccRow.value) || 0
	if (prepayAcc > 0) {
		const bars = await queryRaw(
			`SELECT id AS id, account_id AS acc FROM records WHERE to_account_id = ${prepayAcc} AND type = 3 AND category_id IS NOT NULL`
		)
		const originOf = new Map()
		for (const b of bars) originOf.set(Number(b.id), Number(b.acc))

		const settled = await queryRaw(
			`SELECT prepay_id AS pid, amount AS amount FROM records WHERE prepay_id IS NOT NULL AND type = 1`
		)
		const settledOf = new Map()
		for (const s of settled) settledOf.set(Number(s.pid), Number(s.amount))
		if (settledOf.size) {
			const moves = await queryRaw(
				`SELECT id AS id, prepay_id AS pid, amount AS amount, to_account_id AS toAcc
         FROM records WHERE prepay_id IS NOT NULL AND type = 3 AND internal = 1`
			)
			for (const mv of moves) {
				const pid = Number(mv.pid)
				const settledAmt = settledOf.get(pid)
				const origin = originOf.get(pid)
				if (settledAmt != null && settledAmt === Number(mv.amount) && origin != null && origin === Number(mv.toAcc)) {
					await execRaw(`UPDATE records SET internal = 2 WHERE id = ${Number(mv.id)}`)
					log(`结清转账的标记修正为 2（id=${mv.id}）`)
				}
			}
		}
	}

	await execRaw(`INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated.settleInternal', ${esc(now())})`)
}

/**
 * 旧色值 → 新色板（2026-10-03 色板收到 10 色时，用户要求「已有的图标颜色也要跟着变」）。
 *
 * 按键值**精确匹配**，所以幂等；只列**变了的**那些 —— 靛蓝/紫藤/玫红/鸢尾/兜底灰本来就
 * 与新色板一致，不必写。
 *
 * 「其他」那一格是**按饱和度归的、不是色相**：hsl(150, 8%, 50%) 是个灰绿（s 只有 8%），
 * 按色相就近会给它松绿（154°，差 4°）—— 那是把一个灰变成鲜绿，最扎眼的一处。归石墨。
 */
const PALETTE_MIGRATION = [
	['hsl(33, 40%, 52%)', 'amber'], // 旧琥珀（图标色板 + 餐饮）
	['hsl(16, 48%, 47%)', 'terracotta'], // 工资
	['hsl(52, 38%, 46%)', 'amber'], // 其他收益
	['hsl(4, 46%, 51%)', 'terracotta'], // 红包
	['hsl(145, 28%, 44%)', 'green'], // 旧绿（图标色板 + 理财 + 微信）
	['hsl(174, 28%, 42%)', 'teal'], // 居住（色相随后微调到 178）
	['hsl(194, 38%, 46%)', 'teal'], // 医疗
	['hsl(150, 8%, 50%)', 'graphite'] // 其他（见上：按饱和度归）
]

/**
 * 2026-10-03 迁移：把库里存的旧色值换到新色板。
 *
 * 不迁的话，分类/账户的图标颜色与色板对不上 —— 编辑卡片里那一格会显示成「没选中」，
 * 用户会以为没设过颜色（这条在 M6 就记过一次）。
 */
async function migratePalette() {
	const already = await queryRaw(`SELECT value FROM meta WHERE key = 'migrated.palette'`)
	if (already.length) return

	let n = 0
	for (const [from, key] of PALETTE_MIGRATION) {
		const to = pal(key)
		if (!to) continue
		await execRaw(`UPDATE accounts SET color = ${esc(to)} WHERE color = ${esc(from)}`)
		await execRaw(`UPDATE categories SET color = ${esc(to)} WHERE color = ${esc(from)}`)
		n++
	}
	log(`色板迁移：${n} 组旧色值已对齐到新色板`)

	await execRaw(`INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated.palette', ${esc(now())})`)
}

/**
 * 2026-10-03 迁移：微信的聊天气泡从 message-square 换成 boxicons 的
 * message-circle-dots（用户裁定）。
 *
 * 为什么必须迁移，而不是只改种子：种子只在**从没播过种**的库上跑。已经装过的设备里，
 * 「微信」这个账户的 icon 存的是 'svg:message-square'，改种子对它们毫无作用 ——
 * 用户看到的现象就是「图标没变」。
 *
 * 按旧值精确匹配、幂等，跑一次写标记（与 migrateAccounts 同一套路：先查标记再动手）。
 *
 * ★ 2026-10-04：message-square 这个键已从 ICONS **删掉**（用户裁定）—— 上面这条迁移会先把
 * 老数据换到新键，所以正常情况下没有数据还指着它。留下的窄缝只有一种情形：**导入了迁移前的
 * 旧备份、又还没冷启动过**的那一屏（备份校验只查 icon 是字符串，不查它在不在 ICONS 里），
 * 那里面那个账户存的是 'svg:message-square'，保存时会抛「图标不存在」（换个图标即可恢复）。
 */
async function migrateChatBubble() {
	const already = await queryRaw(`SELECT value FROM meta WHERE key = 'migrated.chatBubble'`)
	if (already.length) return

	await execRaw(`UPDATE accounts SET icon = 'svg:message-circle-dots' WHERE icon = 'svg:message-square'`)

	await execRaw(`INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated.chatBubble', ${esc(now())})`)
}

async function migrate() {
	const rCols = await queryRaw('PRAGMA table_info(records)')
	const rNames = rCols.map((c) => c.name)
	if (!rNames.includes('to_account_id')) {
		log('迁移：records 增加 to_account_id 列')
		await execRaw('ALTER TABLE records ADD COLUMN to_account_id INTEGER')
	}
	if (!rNames.includes('transfer_id')) {
		log('迁移：records 增加 transfer_id 列')
		await execRaw('ALTER TABLE records ADD COLUMN transfer_id INTEGER')
	}
	if (!rNames.includes('time')) {
		log('迁移：records 增加 time 列')
		await execRaw(`ALTER TABLE records ADD COLUMN time TEXT DEFAULT ''`)
		// 真机的 ALTER 会把已有行填成默认值，mock 只把列名加进 cols、老行仍是 undefined ——
		// 这一条把两条路收敛到同一个值（空串 = 没有时刻），排序才只有一种结果
		await execRaw(`UPDATE records SET time = '' WHERE time IS NULL`)
	}

	const cols = await queryRaw('PRAGMA table_info(categories)')
	const colNames = cols.map((c) => c.name)
	if (!colNames.includes('parent_id')) {
		log('迁移：categories 增加 parent_id 列')
		await execRaw('ALTER TABLE categories ADD COLUMN parent_id INTEGER')
	}
	if (!colNames.includes('color')) {
		log('迁移：categories 增加 color 列')
		await execRaw(`ALTER TABLE categories ADD COLUMN color TEXT DEFAULT ''`)
	}
	const rows = await queryRaw('SELECT id, name, icon, color, parent_id FROM categories')
	for (const r of rows) {
		if (r.parent_id != null) continue // 用户自建子分类不动（只可能是 M3.5 之后建的）
		const preset = PRESET_CATEGORIES.find((p) => p.name === r.name)
		if (!preset) continue // 非预置的主分类不动
		const needsIcon = !!r.icon && !/^(svg|img):/.test(r.icon) // 旧 emoji 图标
		const needsColor = !r.color
		if (needsIcon || needsColor) {
			const icon = needsIcon ? preset.icon : r.icon
			const color = needsColor ? preset.color : r.color
			await execRaw(`UPDATE categories SET icon = ${esc(icon)}, color = ${esc(color)} WHERE id = ${Number(r.id)}`)
		}
	}
	await migrateAccounts()
	await migrateAccountHead()
	await migrateAccountIcons()
	await migrateChatBubble()
	await migratePalette()
	// 排在 migratePalette 之后：守卫要拿色板里那个**新**值来比对
	// （玫红本身不在 PALETTE_MIGRATION 里，所以顺序其实无差，但依赖关系写清楚）
	await migrateAccountColor()
	await migrateFeeCategory()
	await migrateAdjustCategory()
	// 必须紧跟上面那条：它负责**建**（建出来就是计算器），这条负责**改已经建过的**
	await migrateAdjustIcon()
	await migratePrepay()
	await migrateSettleInternal()
	await execRaw('PRAGMA user_version = 1')
}

/**
 * 预置数据：由 meta.seeded 标记保证「一生只播一次」。内部流程一律用裸函数。
 *
 * COUNT 为 0 只说明「当前是空的」，不等于「从没播过」——用户把分类/账户删光后
 * COUNT 又会变 0，那时不该把预置数据塞回来（M3 审查钉给 M4 的条目）。
 * 老库升级上来时表里有数据但没有标记：此时只补标记、不播种，否则会当场插入重复数据。
 */
async function seedIfEmpty() {
	const already = await queryRaw(`SELECT value FROM meta WHERE key = 'seeded'`)
	if (already.length) return

	const t = now()
	const [accRow] = await queryRaw('SELECT COUNT(*) AS c FROM accounts')
	if (Number(accRow.c) === 0) {
		log('账户表为空且从未播种，写入预置账户')
		// 外观与颜色（2026-10-03 用户裁定，第二版）：
		//   颜色**全部取自色板**（palette.js）—— 用户先说「微信/支付宝用官方品牌色」，后来改成
		//   「用色板里接近的颜色、并且允许改色」。取色板里的值还有个实际好处：账户编辑
		//   卡片里会显示成「已选中」；取色板外的值会显示成没选中，用户会以为没设色。
		//   微信 —— 聊天气泡图标（boxicons 的 message-circle-dots，见 icons.js 的说明）+ 色板里的绿
		//   支付宝 —— **不选图标**，靠 category-icon 退回名称首字「支」+ 色板里的蓝
		//   「默认账户」—— home + 空色（= 兜底灰）。它只是**种子里的第一个账户**：能改名、
		//   能改图标颜色、能排序、能删（2026-10-09 用户裁定），唯一的护栏是「至少留一个」。
		//   ★ 不再往 meta 写 defaultAccountId 锚了 —— M6 那会儿靠它标记「受保护账户」，
		//     现在没有任何人读它（老库里那行留着不管，新的不再写）。
		//   现金 —— 钱包（2026-10-04 用户裁定，原为钞票 svg:banknote）
		//   银行卡 —— 信用卡 + 陶土（同日裁定）：一叠卡比一栋楼更像「卡」；颜色由玫红改陶土
		//   改种子只影响**新装**；老库那两个账户由 migrateAccountIcons / migrateAccountColor 跟着换。
		await execRaw(`INSERT INTO accounts (name, icon, color, initial_balance, sort, created_at) VALUES
      ('默认账户', 'svg:house', '', 0, 0, '${t}'),
      ('微信', 'svg:message-circle-dots', '${pal('green')}', 0, 1, '${t}'),
      ('支付宝', '', '${pal('blue')}', 0, 2, '${t}'),
      ('现金', 'svg:wallet', '${pal('amber')}', 0, 3, '${t}'),
      ('银行卡', 'svg:credit-card', '${pal('terracotta')}', 0, 4, '${t}'),
      ('预付账户', 'svg:hand-coins', '', 0, 5, '${t}')`)

		// 「预付账户」的身份锚（不可编辑、不可删除 —— 收回 / 结清的钱都落在它上面，
		// 删了功能就断了；见 services/prepay.js）。与手续费分类同一套路。
		const [prepayRow] = await queryRaw(`SELECT id FROM accounts WHERE name = '预付账户'`)
		if (prepayRow) {
			await execRaw(
				`INSERT OR REPLACE INTO meta (key, value) VALUES ('prepayAccountId', ${esc(String(prepayRow.id))})`
			)
		}
	}

	const [catRow] = await queryRaw('SELECT COUNT(*) AS c FROM categories')
	if (Number(catRow.c) === 0) {
		log('分类表为空且从未播种，写入预置分类')
		const values = PRESET_CATEGORIES
			.map((p) => `(${esc(p.name)}, ${esc(p.icon)}, ${esc(p.color)}, ${p.type}, ${p.sort}, '${t}')`)
			.join(',')
		await execRaw(`INSERT INTO categories (name, icon, color, type, sort, created_at) VALUES ${values}`)

		// 「手续费」分类的身份锚。新装走的是这条路
		// （migrateFeeCategory 见到空表就退出，把分类留给这里一次播下），所以锚必须在这儿写
		// —— 不写的话，新装设备上第一次带手续费的转账会找不到分类，那笔手续费只能挂空。
		const [feeRow] = await queryRaw(`SELECT id FROM categories WHERE name = '手续费' AND type = 1`)
		if (feeRow) {
			await execRaw(
				`INSERT OR REPLACE INTO meta (key, value) VALUES ('feeCategoryId', ${esc(String(feeRow.id))})`
			)
		}

		// 两个「差异调节」的锚，同一个道理（migrateAdjustCategory 见到空表就退出，
		// 把分类留给这里一次播下，锚不在这儿写就没有）。★ 必须带上 type 找 —— 两侧同名。
		for (const [type, key] of [[1, 'adjustCategoryIdOut'], [2, 'adjustCategoryIdIn']]) {
			const [row] = await queryRaw(`SELECT id FROM categories WHERE name = '差异调节' AND type = ${type}`)
			if (row) {
				await execRaw(`INSERT OR REPLACE INTO meta (key, value) VALUES (${esc(key)}, ${esc(String(row.id))})`)
			}
		}

		// 「预付差额」的锚，同理（migratePrepay 见到空表就退出，把分类留给这里一次播下）
		const [prepDiffRow] = await queryRaw(`SELECT id FROM categories WHERE name = '预付差额' AND type = 2`)
		if (prepDiffRow) {
			await execRaw(
				`INSERT OR REPLACE INTO meta (key, value) VALUES ('prepayDiffCategoryId', ${esc(String(prepDiffRow.id))})`
			)
		}
	}

	// 两条路径都以写标记收尾：空库播了种要记；非空老库没播种也要记，
	// 否则每次冷启动都要重新走一遍判断
	await execRaw(`INSERT OR REPLACE INTO meta (key, value) VALUES ('seeded', ${esc(t)})`)
}

/**
 * 初始化：打开库 → 建表 → 迁移 → 预置数据
 * 幂等 + Promise 单例：多处调用安全，失败后置空以便重试
 */
export function initDB() {
	if (initPromise) return initPromise
	initPromise = (async () => {
		if (!plus.sqlite.isOpenDatabase({
				name: DB_NAME,
				path: DB_PATH
			})) {
			await open()
		}
		for (const sql of CREATE_TABLES) {
			await execRaw(sql)
		}
		await migrate()
		await seedIfEmpty()
		log('初始化完成')
	})().catch((e) => {
		initPromise = null // 失败允许重试（Spec §9：错误态于 M3 落地）
		throw e
	})
	return initPromise
}
