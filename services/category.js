/**
 * services/category.js —— 分类业务（M4：完整 CRUD + 同级排序）
 */
import { query, exec, esc, now } from './db.js'
import { getFeeCategoryId } from './record.js'
import { getMeta, setMeta } from './meta.js'
import { randomPaletteColor } from './palette.js'

/**
 * 分类名（主分类与子分类同规）上限。**导出**：页面拿它做输入框的 `:maxlength`
 * 与旁边的实时计数（「2/6」）—— 同一个数只留一个源。
 */
export const CATEGORY_NAME_MAX = 6

/** 子分类默认颜色策略存在 meta 里的键 */
const SUB_COLOR_MODE_KEY = 'subColorMode'

/**
 * 两种策略。**带中文名一起导出**：主题页直接 `v-for` 渲染这两格，
 * 与 `THEMES` 同一个模式 —— 选项的文字只在服务层写一遍。
 */
export const SUB_COLOR_MODES = [
	{ key: 'follow', name: '跟随主分类', hint: '子分类不单独配色，用主分类的颜色' },
	{ key: 'random', name: '随机', hint: '新建子分类时先分一个色板里的色（之后能改）' }
]

/**
 * 当前策略。**认不出的值一律回落 `follow`** —— meta 是用户可导入的备份能改到的表，
 * 一个脏值不该让新建卡片出不来颜色或者直接抛错。
 */
export async function getSubColorMode() {
	const raw = await getMeta(SUB_COLOR_MODE_KEY)
	return SUB_COLOR_MODES.some((m) => m.key === raw) ? raw : 'follow'
}

/** 写策略；认不出的 key 直接拒绝（同 setAccent，别把脏值写进库） */
export async function setSubColorMode(mode) {
	if (!SUB_COLOR_MODES.some((m) => m.key === mode)) throw new Error(`未知的子分类颜色策略：${mode}`)
	await setMeta(SUB_COLOR_MODE_KEY, mode)
}

/**
 * 新建分类时，颜色那一格**预填**成什么。调用方是「打开新建卡片」那一刻
 * （`c ? c.color : defaultCategoryColor(mode, false)`）—— 编辑既有分类时不走这里。
 *
 * ★ 只影响默认值，不落库也不改任何已有数据：用户在卡片里改、或者干脆清空，
 *   存进去的就是他最后看到的那个值。这也是「策略只管以后新建的」这句裁定的落点。
 * ★ 主分类**不受策略影响**，一直是随机（先前裁定的行为，别被这个开关顺手改掉）——
 *   所以 isSub 是必填参数，不是靠 mode 一个值去猜两类分类。
 *
 * @param {'follow'|'random'} mode 当前策略
 * @param {boolean} isSub 新建的是子分类吗
 * @returns {string} 色值；空串 = 跟随主分类（只有子分类会返回空串）
 */
export function defaultCategoryColor(mode, isSub) {
	if (!isSub) return randomPaletteColor()
	return mode === 'random' ? randomPaletteColor() : ''
}

/**
 * 取分类树，按收支分组、组内按 sort,id 排序。
 * @returns {Promise<{expense: Array, income: Array}>}
 *   节点 = {id, name, icon, color, type, parentId, sort, subs: [子分类节点]}
 *   子分类节点结构相同（subs 恒为 []，只有一层树）
 */
export async function getCategoriesGrouped() {
  const rows = await query(
    'SELECT id, name, icon, color, type, parent_id AS parentId, sort FROM categories ORDER BY type, sort, id'
  )
  // 「手续费」是转账的内部分类：它由转账**带出来**（saveTransfer 往它上面挂一条支出），
  // 不该出现在分类管理里，也不该被当作可选支出分类 —— 用户手动选它记一笔，等于凭空造手续费。
  // 摘的是**这一份列表**，不是数据：categories 表里那行还在，备份、统计、明细都照旧认它。
  // 摘掉节点就够：它下面的子分类会因为「父不存在」被下面的孤儿守卫一并丢弃（真机上不该有，
  // 但手续费在本轮之前是可见的，别人可能已经给它建过子分类）。
  const feeId = await getFeeCategoryId()
  const expense = []
  const income = []
  const byId = new Map()
  for (const r of rows) {
    if (feeId != null && Number(r.id) === feeId) continue
    byId.set(Number(r.id), {
      id: Number(r.id),
      name: r.name,
      icon: r.icon || '',
      color: r.color || '',
      type: Number(r.type),
      parentId: r.parentId == null ? null : Number(r.parentId),
      sort: Number(r.sort),
      subs: []
    })
  }
  for (const node of byId.values()) {
    if (node.parentId != null) {
      const parent = byId.get(node.parentId)
      // 主分类已不存在（删除中断留下的孤儿）：丢弃，绝不回落成主分类。
      // 原来的写法在这里会因为 byId.has() 为假而掉进下面的 else，把孤儿推上主分类列表。
      if (!parent) continue
      parent.subs.push(node) // 挂到主分类（仅一层，父不再有父）
    } else if (node.type === 2) {
      income.push(node)
    } else {
      expense.push(node)
    }
  }
  return { expense, income }
}

/** 名称校验：去空白、非空、≤6 字 */
function validateName(name) {
  const n = (name || '').trim()
  if (!n) throw new Error('名称不能为空')
  if ([...n].length > CATEGORY_NAME_MAX) throw new Error(`名称最多 ${CATEGORY_NAME_MAX} 个字`)
  return n
}

/** 同级判重的 SQL 作用域：主分类看「同 type 的主分类」，子分类看「同一父」 */
function scopeOf(type, parentId) {
  return parentId == null ? `type = ${type} AND parent_id IS NULL` : `parent_id = ${parentId}`
}

/** 同级内不得重名；excludeId 用于「改名叫回自己原来的名字」 */
async function assertNameFree(name, type, parentId, excludeId = null) {
  const exclude = excludeId == null ? '' : ` AND id <> ${excludeId}`
  const dup = await query(
    `SELECT id FROM categories WHERE name = ${esc(name)} AND ${scopeOf(type, parentId)}${exclude}`
  )
  if (dup.length) throw new Error(parentId == null ? '已有同名的主分类' : '该分类下已有同名子分类')
}

/** 同级下一个 sort：max+1。写死 99 会让同级出现并列，排序无从下手（M3.5 的坑） */
async function nextSort(type, parentId) {
  const [row] = await query(`SELECT MAX(sort) AS m FROM categories WHERE ${scopeOf(type, parentId)}`)
  return Number(row?.m || 0) + 1
}

/**
 * 新增分类（主分类或子分类）
 * @param {Object} data
 * @param {string} data.name 名称（非空，≤6 字）
 * @param {1|2} data.type 1=支出 2=收入
 * @param {number|null} [data.parentId] 主分类 id；null/省略 = 主分类
 * @param {string} [data.icon] 'svg:xxx'；空串 = 名称首字文字图标
 * @param {string} [data.color] 色环颜色；空串 = 跟随主分类色/组件默认
 */
export async function createCategory({ name, type, parentId = null, icon = '', color = '' }) {
  const n = validateName(name)
  if (type !== 1 && type !== 2) throw new Error('无效的分类类型')

  if (parentId != null) {
    if (!Number.isInteger(parentId)) throw new Error('无效的主分类')
    const parents = await query(`SELECT id, parent_id, type FROM categories WHERE id = ${parentId}`)
    if (!parents.length) throw new Error('主分类不存在')
    if (parents[0].parent_id != null) throw new Error('只允许主分类子分类')
    if (Number(parents[0].type) !== type) throw new Error('子分类的收支类型必须与主分类一致')
  }

  await assertNameFree(n, type, parentId)
  const sort = await nextSort(type, parentId)
  await exec(
    `INSERT INTO categories (name, icon, color, type, parent_id, sort, created_at)
     VALUES (${esc(n)}, ${esc(icon)}, ${esc(color)}, ${type}, ${parentId == null ? 'NULL' : parentId}, ${sort}, ${esc(now())})`
  )
}

/**
 * 修改分类的展示属性。type 与 parentId 不可改：
 * 改 type 会让已挂在该分类下的流水收支方向与分类归属矛盾；改 parentId 是「移动子分类」，本期不做。
 * @param {number} id
 * @param {Object} data
 * @param {string} data.name 名称
 * @param {string} [data.icon] 空串 = 退回名称首字
 * @param {string} [data.color] 空串 = 子分类跟随父色 / 主分类用组件默认灰
 */
export async function updateCategory(id, { name, icon = '', color = '' }) {
  if (!Number.isInteger(id)) throw new Error('无效的分类 id')
  const n = validateName(name)
  const rows = await query(`SELECT id, type, parent_id FROM categories WHERE id = ${id}`)
  if (!rows.length) throw new Error('分类不存在')
  const parentId = rows[0].parent_id == null ? null : Number(rows[0].parent_id)
  await assertNameFree(n, Number(rows[0].type), parentId, id)
  await exec(`UPDATE categories SET name = ${esc(n)}, icon = ${esc(icon)}, color = ${esc(color)} WHERE id = ${id}`)
}

/**
 * 删除分类，连带删除其子分类。
 * 顺序必须是「先删子、再删父」：无事务时中途失败，最坏留下的是「父还在、子少了」这种
 * 结构自洽且可重试的状态；反过来则会留下孤儿（见设计文档 §3.1）。
 * 不碰 records —— 流水保留，联查不到分类时页面显示「已删除分类」（总设计 §6）。
 * @returns {Promise<{removedSubs: number}>}
 */
export async function deleteCategory(id) {
  if (!Number.isInteger(id)) throw new Error('无效的分类 id')
  const rows = await query(`SELECT id FROM categories WHERE id = ${id}`)
  if (!rows.length) throw new Error('分类不存在')
  const subs = await query(`SELECT id FROM categories WHERE parent_id = ${id}`)
  await exec(`DELETE FROM categories WHERE parent_id = ${id}`)
  await exec(`DELETE FROM categories WHERE id = ${id}`)
  return { removedSubs: subs.length }
}

/**
 * 同级上下移一格。
 * 不交换两个 sort 值——历史数据里可能大量并列（M3.5 写死 99），交换会失效。
 * 改为把同级整段重写成 1..n，一次点击只跑一次，且与历史数据无关地正确。
 * @param {number} id
 * @param {-1|1} dir -1=上移 1=下移；已在首/末位时静默返回
 */
export async function moveCategory(id, dir) {
  if (!Number.isInteger(id)) throw new Error('无效的分类 id')
  if (dir !== -1 && dir !== 1) throw new Error('dir 必须是 -1 或 1')
  const rows = await query(`SELECT id, type, parent_id FROM categories WHERE id = ${id}`)
  if (!rows.length) throw new Error('分类不存在')
  const type = Number(rows[0].type)
  const parentId = rows[0].parent_id == null ? null : Number(rows[0].parent_id)

  const sibs = await query(`SELECT id FROM categories WHERE ${scopeOf(type, parentId)} ORDER BY sort, id`)
  const idx = sibs.findIndex((r) => Number(r.id) === id)
  const target = idx + dir
  if (idx < 0 || target < 0 || target >= sibs.length) return // 越界：静默

  const order = sibs.map((r) => Number(r.id))
  const tmp = order[idx]
  order[idx] = order[target]
  order[target] = tmp
  for (let i = 0; i < order.length; i++) {
    await exec(`UPDATE categories SET sort = ${i + 1} WHERE id = ${order[i]}`)
  }
}

/**
 * 按给定顺序重写一组同级分类的 sort（1..n）。
 * 拖拽排序的落库入口：拖动过程中页面只在本地数组里换位，松手才调一次这里，
 * 避免每经过一个格子就写一次库。
 * @param {number[]} ids 同一主分类下的子分类 id，按目标顺序排列
 */
export async function reorderCategories(ids) {
  if (!Array.isArray(ids) || !ids.length) throw new Error('缺少排序列表')
  for (const id of ids) {
    if (!Number.isInteger(id)) throw new Error('无效的分类 id')
  }
  for (let i = 0; i < ids.length; i++) {
    await exec(`UPDATE categories SET sort = ${i + 1} WHERE id = ${ids[i]}`)
  }
}

/**
 * 统计该分类及其所有子分类名下的流水笔数（删除确认弹窗用）
 * @returns {Promise<number>}
 */
export async function countRecordsByCategory(id) {
  if (!Number.isInteger(id)) throw new Error('无效的分类 id')
  const subs = await query(`SELECT id FROM categories WHERE parent_id = ${id}`)
  const ids = [id, ...subs.map((r) => Number(r.id))]
  const [row] = await query(`SELECT COUNT(*) AS c FROM records WHERE category_id IN (${ids.join(',')})`)
  return Number(row?.c || 0)
}

