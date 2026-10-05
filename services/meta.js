/**
 * services/meta.js —— 键值元数据（M3.5 引入 meta 表）
 * 用途：一句话签名等轻量配置。不做内存缓存：单用户本地库读写开销可忽略，缓存反而引入失效问题
 */
import { exec, query, esc } from './db.js'

/** 读元数据；不存在返回空字符串 */
export async function getMeta(key) {
  const rows = await query(`SELECT value FROM meta WHERE key = ${esc(key)}`)
  return rows.length ? rows[0].value : ''
}

/** 写元数据（存在即覆盖）。INSERT OR REPLACE 比 ON CONFLICT DO UPDATE 兼容更老的 SQLite */
export async function setMeta(key, value) {
  await exec(`INSERT OR REPLACE INTO meta (key, value) VALUES (${esc(key)}, ${esc(String(value))})`)
}

/**
 * 这个键在 meta 表里**存在**吗。
 *
 * 与 getMeta 的区别在于：getMeta 把「键不存在」与「键存在但值为空串」都返回 ''，
 * 而有些设置必须区分这两者 —— 一句话签名就是：从没设过 → 显示默认签名；
 * 用户**显式清空**过 → 显示「没有签名」。少了这个函数，清空就会被当成没设过、
 * 又变回默认签名（用户反馈的正是这个）。
 */
export async function hasMeta(key) {
  const rows = await query(`SELECT key FROM meta WHERE key = ${esc(key)}`)
  return rows.length > 0
}
