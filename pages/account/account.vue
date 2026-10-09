<template>
  <view class="page" :style="[{ paddingTop: statusBarHeight + 'px' }, themeVars]">
    <!-- 顶栏：返回 + 标题 -->
    <view class="top">
      <view class="icon-btn" @click="goBack">
        <view :style="maskStyle('chevL', 44, 'var(--md-on-surface)')"></view>
      </view>
      <text class="title">账户管理</text>
      <view class="icon-btn"></view>
    </view>

    <!-- 错误态（与首页/我的页一致，不静默） -->
    <view v-if="loadError" class="error-box">
      <text class="error-text">账户加载失败</text>
      <view class="retry-btn af-press" :class="{ pressing: isPressed('retry') }" @touchstart="pressOn('retry')"
        @touchend="pressOff" @touchcancel="pressOff" @click="load"><text class="retry-text">重 试</text></view>
    </view>

    <template v-else>
      <!-- 总资产 -->
      <view class="total-card">
        <text class="total-k">总资产（元）</text>
        <text class="total-v num">{{ fmtYuan(totalAssets) }}</text>
      </view>

      <!-- 账户列表：图标 + 名称 + 实时余额；右侧编辑/删除 -->
      <view class="list">
        <view v-for="a in accounts" :key="a.id" class="row acct-row" :style="rowStyle(a.id)">
          <category-icon :icon="a.icon" :color="a.color" :name="a.name" :size="76" />
          <view class="mid">
            <text class="name">{{ a.name }}</text>
            <text class="bal num" :class="{ neg: a.balance < 0 }">余额 {{ fmtYuan(a.balance) }}</text>
          </view>
          <view class="ops">
            <!-- 排序：所有账户都能排（2026-10-09 起「默认账户恒在首位」没有了） -->
            <view class="op" :class="{ off: !canMoveUp(a) }" @click="move(a, -1)">
              <view :style="maskStyle('chevUp', 30, 'var(--md-on-surface-variant)')"></view>
            </view>
            <view class="op" :class="{ off: !canMoveDown(a) }" @click="move(a, 1)">
              <view :style="maskStyle('chevDown', 30, 'var(--md-on-surface-variant)')"></view>
            </view>
            <view class="op" @click="openEdit(a)">
              <view :style="maskStyle('pencil', 30, 'var(--md-on-surface-variant)')"></view>
            </view>
            <!-- 只剩一个账户时不给删：删光了记一笔就没有账户可选（服务层也硬拦这一条）。
                 位置留着（置灰不隐藏），免得那一行的图标错位。
                 ★ 预付账户**不在这份列表里**（listAccounts 滤掉了），所以这里不用判它 -->
            <view class="op" :class="{ off: accounts.length <= 1 }" @click="onDelete(a)">
              <view :style="maskStyle('trash', 30, 'var(--md-error)')"></view>
            </view>
          </view>
        </view>

        <view v-if="!accounts.length" class="empty">
          <text class="empty-t">还没有账户，先加一个吧</text>
        </view>

        <!-- 新增入口：列表末尾一行 -->
        <view class="row add" @click="openCreate">
          <view class="add-ic">
            <view :style="maskStyle('plus', 36, 'var(--md-primary-strong)')"></view>
          </view>
          <text class="add-t">新增账户</text>
        </view>
      </view>
    </template>

    <!-- 新增 / 编辑：底部卡片（与记一笔的弹层同机制：closing 撑住节点播退场再拆） -->
    <view v-if="showForm" class="af-scrim" :class="{ closing: formClosing }" @click="closeForm">
      <view class="af-blocker"></view>
      <view class="af-card" :class="{ closing: formClosing }" @click.stop>
        <view class="af-grab"></view>
        <text class="af-title">{{ editingId == null ? '新增账户' : '编辑账户' }}</text>

        <!-- 图标宫格：所有账户一视同仁（2026-10-09 起「默认账户」不再特殊） -->
        <view class="af-icons">
          <!-- 点击挂在 .af-ic（整格）上，与分类页的图标宫格一致：命中区从 56rpx 的环
               扩到 76rpx 的格子 —— 原来的 28px 见方低于可点区域的常用下限 -->
          <view v-for="k in iconKeys" :key="k" class="af-ic" @click="formIcon = formIcon === k ? '' : k">
            <view class="af-ring" :class="{ on: formIcon === k }">
              <category-icon :icon="'svg:' + k" :color="formColor" :size="56" />
            </view>
          </view>
        </view>

        <view class="af-row">
          <view class="af-preview">
            <category-icon :icon="formIcon ? 'svg:' + formIcon : ''" :color="formColor" :name="formName || '账'"
              :size="80" />
          </view>
          <view class="clr-wrap">
            <input class="af-name" v-model="formName" placeholder="账户名称，如「微信」" :maxlength="nameMax" :cursor-spacing="kbSpacing"
              placeholder-class="af-ph" />
            <view v-if="formName" class="clr-btn" @click="formName = ''">
              <view :style="maskStyle('x', 26, 'var(--md-on-surface-variant)')"></view>
            </view>
          </view>
        </view>

        <!-- 颜色：与分类卡片同一套色板；不选 = 组件默认灰 -->
        <view class="af-colors">
          <view v-for="c in afColors" :key="c" class="af-color" :class="{ on: formColor === c }"
            :style="{ backgroundColor: c }" @click="formColor = formColor === c ? '' : c"></view>
        </view>

        <!-- 余额：标签 + 窄输入 + 单位，一行放下（原来是又宽又高的一整条，太占地方）。
             标签随新增/编辑在「初始余额 / 当前余额」之间切（见 balLabel） -->
        <view class="af-row">
          <text class="af-label">{{ balLabel }}</text>
          <view class="clr-wrap">
            <input class="af-bal-input num" v-model="formBalance" type="digit" placeholder="0" :cursor-spacing="kbSpacing"
              placeholder-class="af-ph" />
            <!-- 空串就是这个字段的「没有值」（保存时空 = 0），所以判据是它非空 -->
            <view v-if="formBalance" class="clr-btn" @click="formBalance = ''">
              <view :style="maskStyle('x', 26, 'var(--md-on-surface-variant)')"></view>
            </view>
          </view>
          <text class="af-unit">元</text>
        </view>

        <!-- 字数上限是隐性的（打满就打不进去了），所以显示实时计数：定位在说明最后一行的右端 -->
        <view class="af-hint-wrap">
          <text class="af-hint">不选图标则用名称首字；不选颜色则用默认灰；{{ balLabel }}可负（信用卡）。</text>
          <text v-if="formName" class="af-count"
            :class="{ full: nameCount >= nameMax }">{{ nameCount }}/{{ nameMax }}</text>
        </view>
        <view class="af-btns">
          <view class="af-cancel af-press" :class="{ pressing: isPressed('cancel') }" @touchstart="pressOn('cancel')"
            @touchend="pressOff" @touchcancel="pressOff" @click="closeForm"><text>取消</text></view>
          <view class="af-done af-press" :class="{ pressing: isPressed('save') }" @touchstart="pressOn('save')"
            @touchend="pressOff" @touchcancel="pressOff" @click="saveForm"><text>保存</text></view>
        </view>
      </view>
    </view>

    <!-- 自绘确认框（easycom 自动注册） -->
    <confirm-dialog ref="confirmDlg" />
  </view>
</template>

<script>
import { maskStyle, ACCOUNT_ICON_KEYS } from '@/services/icons.js'
import { PALETTE_COLORS, randomPaletteColor } from '@/services/palette.js'
import {
  listAccounts,
  addAccount,
  updateAccount,
  moveAccount,
  deleteAccount,
  countRecordsByAccount,
  getTotalAssets,
  ACCOUNT_NAME_MAX
} from '@/services/account.js'
import { fmtYuan } from '@/services/format.js'
import pressFx from '@/services/press.js'

export default {
  mixins: [pressFx],
  data() {
    return {
      statusBarHeight: 0,
      accounts: [],
      totalAssets: 0,
      loadError: false,
      loadToken: 0,
      // 新增/编辑卡片
      showForm: false,
      formClosing: false,
      formTimer: null,
      editingId: null, // null = 新增
      formName: '',
      formIcon: '', // 裸 key（保存时补 svg:）
      formColor: '', // 图标底色，空 = 组件默认灰
      formBalance: '', // 元字符串，空 = 0
      // 编辑时「当前余额」的快照（分）：保存时拿它跟输入框比，**没变就不弹那个选择框**
      // （只改个名字也要弹一次「要记流水吗」是很烦的，而不弹又不可能 ——
      //  服务层只认「目标余额」，它无从知道用户到底想不想动余额）
      editingBalance: 0,
      // ↑↓ 排序的换位动画（FLIP）：id → {dx, dy, animate}
      flip: {},
      flipTimer: null
    }
  },
  computed: {
    iconKeys() {
      return ACCOUNT_ICON_KEYS
    },
    // 名称上限来自服务层（同一个数只留一个源，别在页面里再写一个 8）；模板要读它
    nameMax() {
      return ACCOUNT_NAME_MAX
    },
    // 实时字数。按 UTF-16 长度算 —— 与输入框 maxlength 的口径一致（Android 原生
    // InputFilter 数的也是它），这样「计数打满」与「再打不进去」永远同时发生
    nameCount() {
      return this.formName.length
    },
    // 同一个输入框，两个含义：新增时填的是**初始余额**（这账户一开始有多少钱），
    // 编辑时填的是**当前余额**（现在账上是多少）—— 用户裁定初始余额只在新增时填一次。
    // 标签与下面的提示都跟着它走，别让输入框的含义只写在服务层。
    balLabel() {
      return this.editingId == null ? '初始余额' : '当前余额'
    },
    afColors() {
      return PALETTE_COLORS
    }
  },
  onLoad() {
    this.statusBarHeight = (uni.getSystemInfoSync().statusBarHeight) || 0
  },
  onShow() {
    this.load()
  },
  /** 换位动画的定时器不能留着：页面走了还回调会摸到已销毁的实例 */
  onUnload() {
    if (this.flipTimer) clearTimeout(this.flipTimer)
  },
  /** 安卓返回键：表单或确认框开着时，返回先收它们（返回 true 消费掉事件） */
  onBackPress() {
    const dlg = this.$refs.confirmDlg
    if (dlg && dlg.visible) {
      dlg.cancel()
      return true
    }
    if (this.showForm) {
      this.closeForm()
      return true
    }
    return false
  },
  methods: {
    maskStyle,
    fmtYuan,
    async load() {
      const token = ++this.loadToken
      try {
        const list = await listAccounts()
        const total = await getTotalAssets()
        if (token !== this.loadToken) return
        this.accounts = list
        this.totalAssets = total
        this.loadError = false
      } catch (e) {
        console.error('[account] 加载失败', e)
        if (token !== this.loadToken) return
        this.loadError = true
      }
    },
    goBack() {
      uni.navigateBack()
    },
    // ---- 新增 / 编辑 ----
    openCreate() {
      if (this.formTimer) clearTimeout(this.formTimer)
      this.formClosing = false
      this.editingId = null
      this.formName = ''
      this.formIcon = ''
      // 新建账户的默认色：一直随机（来源收在 palette.js，分类页与这里是同一份实现）
      this.formColor = randomPaletteColor()
      this.formBalance = ''
      this.showForm = true
    },
    openEdit(a) {
      if (this.formTimer) clearTimeout(this.formTimer)
      this.formClosing = false
      this.editingId = a.id
      this.formName = a.name
      this.formIcon = String(a.icon || '').startsWith('svg:') ? a.icon.slice(4) : ''
      this.formColor = a.color || ''
      // 分 → 元字符串：去掉尾随 0，否则一次退格删不掉一位小数（与 edit.vue 的 centsToInput 同法）
      // ★ 回填的是**当前余额**（不是 initialBalance）：编辑时用户想改的就是「账上现在有多少」，
      //   初始余额是他的私账，不该在这儿被看见、更不该被直接改。
      this.formBalance = a.balance ? String(Number((a.balance / 100).toFixed(2))) : ''
      this.editingBalance = a.balance
      this.showForm = true
    },
    closeForm() {
      if (!this.showForm || this.formClosing) return
      this.formClosing = true
      this.formTimer = setTimeout(() => {
        this.showForm = false
        this.formClosing = false
      }, 200)
    },
    async saveForm() {
      if (this.formClosing) return // 退场动画期间的残影点击：忽略
      const name = this.formName.trim()
      if (!name) {
        uni.showToast({ title: '账户名不能为空', icon: 'none' })
        return
      }
      const raw = String(this.formBalance).trim()
      const yuan = raw ? Number(raw) : 0
      if (!Number.isFinite(yuan)) {
        uni.showToast({ title: this.balLabel + '填错了', icon: 'none' })
        return
      }
      const adding = this.editingId == null
      const balance = Math.round(yuan * 100)
      const base = { name, icon: this.formIcon ? 'svg:' + this.formIcon : '', color: this.formColor }

      // 新增：输入框里填的就是初始余额，没有「改余额」那回事
      if (adding) {
        await this.commit({ ...base, initialBalance: balance })
        return
      }

      // 编辑但余额没动：直接存。否则「只改个名字」也得先答一遍「要记流水吗」
      if (balance === this.editingBalance) {
        await this.commit({ ...base, balance, mode: 'initial' })
        return
      }

      // 余额动了：两条路**都把它变成同一个数**，区别全在副作用上 ——
      // 一条不动明细、一条多一笔且进收支统计。这是账的口径，得用户自己定。
      const up = balance > this.editingBalance
      this.$refs.confirmDlg.open({
        title: `余额改成 ${this.fmtYuan(balance)} ？`,
        message: '两种方式余额都会变成这个数，区别只在明细里会不会多一笔。',
        options: [
          {
            text: '只改余额',
            hint: '不产生流水：反算初始余额。明细与统计都不动。',
            onPick: () => this.commit({ ...base, balance, mode: 'initial' })
          },
          {
            text: '记一笔调整',
            hint: `多一笔${up ? '收入' : '支出'}（分类「差异调节」），计入收支统计。`,
            onPick: () => this.commit({ ...base, balance, mode: 'adjust' })
          }
        ]
      })
    },
    /** 真正落库那一步：新增与编辑、两种方式都从这里走（toast / 关卡片 / 重载只写一遍） */
    async commit(payload) {
      const adding = this.editingId == null
      try {
        if (adding) await addAccount(payload)
        else await updateAccount(this.editingId, payload)
        this.closeForm()
        this.load()
        uni.showToast({ title: adding ? '已添加' : '已保存', icon: 'success' })
      } catch (e) {
        console.error('[account] 保存失败', e)
        const msg = String(e.message || '').replace('SQL执行失败: ', '') || '保存失败'
        uni.showToast({ title: msg, icon: 'none' })
      }
    },
    // ---- 排序（所有账户都参与，不再有「默认账户恒在首位」）----
    canMoveUp(a) {
      return this.accounts.findIndex((x) => x.id === a.id) > 0
    },
    canMoveDown(a) {
      const i = this.accounts.findIndex((x) => x.id === a.id)
      return i >= 0 && i < this.accounts.length - 1
    },
    /**
     * ↑↓ 排序：**本地先换位、落库随后跟上**。
     *
     * 为什么不是「等落库 → load() → 再量新位置补偿」：那样中间必然有一帧
     * 「顺序已换、补偿还没贴上」，就是用户看到的一瞬闪动。把补偿位移与换位放进
     * **同一次 DOM 补丁**（两处 reactive 赋值在同一个 tick 里，Vue 会合成一次更新）才不闪。
     *
     * 补偿量也不用量第二次：相邻两格换位时**槽位几何没变**（行高一致），
     * 所以「我的新位置」＝「原来在那个槽位那一行的旧位置」，直接从换位前量到的 rects 算。
     * 注意 boundingClientRect 给的是 px（不是 rpx）。
     */
    async move(a, dir) {
      if (dir < 0 ? !this.canMoveUp(a) : !this.canMoveDown(a)) return // 越界：静默（按钮已置灰）
      const beforeRects = await this.measureRows() // 顺序 === this.accounts
      const i = this.accounts.findIndex((x) => x.id === a.id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= this.accounts.length) return
      const arr = this.accounts.slice()
      const [item] = arr.splice(i, 1)
      arr.splice(j, 0, item)

      const shift = {}
      ;[this.accounts[i].id, this.accounts[j].id].forEach((id) => {
        const from = this.accounts.findIndex((x) => x.id === id)
        const to = arr.findIndex((x) => x.id === id)
        if (!beforeRects[from] || !beforeRects[to]) return
        shift[id] = {
          dx: beforeRects[from].left - beforeRects[to].left,
          dy: beforeRects[from].top - beforeRects[to].top,
          animate: false
        }
      })
      if (this.flipTimer) clearTimeout(this.flipTimer)
      this.flip = shift // 先反向位移到旧位置（无过渡）
      this.accounts = arr // 同一 tick：顺序与补偿一起上屏

      setTimeout(() => {
        const done = {}
        Object.keys(shift).forEach((id) => {
          done[id] = { dx: 0, dy: 0, animate: true }
        })
        this.flip = done // 下一帧归零：有过渡，于是两行对滑（「挤」过去）
        this.flipTimer = setTimeout(() => {
          this.flip = {}
        }, 260)
      }, 20)

      try {
        await moveAccount(a.id, dir)
        this.load() // 以库里的顺序为准（本地换位只是为了让动画立刻开始）
      } catch (e) {
        console.error('[account] 排序失败', e)
        uni.showToast({ title: String(e.message || '') || '排序失败', icon: 'none' })
        this.load() // 失败：把顺序拉回库里的真相
      }
    },
    /** 量每个账户行当前的位置（顺序与列表一致） */
    measureRows() {
      return new Promise((resolve) => {
        uni.createSelectorQuery()
          .in(this)
          .selectAll('.acct-row')
          .boundingClientRect((rects) => resolve(rects || []))
          .exec()
      })
    },
    /** 换位动画的内联样式（FLIP 的「先反向位移」那一步） */
    rowStyle(id) {
      const f = this.flip[id]
      if (!f) return {}
      return {
        transform: `translate(${f.dx}px, ${f.dy}px)`,
        transition: f.animate ? 'transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1)' : 'none'
      }
    },
    // ---- 删除 ----
    async onDelete(a) {
      // 只剩一个账户：不给「删除」这条路（与「有流水」同一处理，设计 §8）
      if (this.accounts.length <= 1) {
        this.$refs.confirmDlg.open({
          title: '不能删除',
          message: '至少要保留一个账户，否则记账时无处可落。',
          confirmText: '知道了',
          hideCancel: true,
          danger: false,
          onConfirm: () => {}
        })
        return
      }
      let n = 0
      try {
        n = await countRecordsByAccount(a.id)
      } catch (e) {
        console.error('[account] 统计流水失败', e)
      }
      // 有流水：不给「删除」这条路，只说明原因（账户是余额的一侧，见设计文档 §4.1）
      if (n > 0) {
        this.$refs.confirmDlg.open({
          title: '不能删除',
          message: `「${a.name}」名下还有 ${n} 笔流水。先把那些流水改到别的账户，再回来删。`,
          confirmText: '知道了',
          hideCancel: true, // 只有一个按钮的说明型对话框
          danger: false,
          onConfirm: () => {}
        })
        return
      }
      this.$refs.confirmDlg.open({
        title: '确认删除',
        message: `删除「${a.name}」后不可恢复，确定吗？`,
        confirmText: '删除',
        cancelText: '取消',
        danger: true,
        onConfirm: async () => {
          try {
            await deleteAccount(a.id)
            uni.showToast({ title: '已删除', icon: 'success' })
          } catch (e) {
            console.error('[account] 删除失败', e)
            uni.showToast({ title: String(e.message || '') || '删除失败', icon: 'none' })
          }
          this.load()
        }
      })
    }
  }
}
</script>

<style lang="less">
.page {
  min-height: 100vh;
  box-sizing: border-box;
  background: var(--md-surface-container);
  padding-bottom: calc(60rpx + env(safe-area-inset-bottom));
}

.total-card {
  margin: 8rpx 32rpx 20rpx;
  background: var(--md-surface);
  border-radius: 40rpx;
  padding: 32rpx 40rpx;

  .total-k {
    font-size: 25rpx;
    color: var(--md-on-surface-variant);
  }

  .total-v {
    display: block;
    margin-top: 6rpx;
    font-size: 58rpx;
    font-weight: 600;
    color: var(--md-on-surface);
  }
}

.list {
  margin: 0 32rpx;

  .row {
    display: flex;
    align-items: center;
    gap: 24rpx;
    background: var(--md-surface);
    border-radius: 32rpx;
    padding: 24rpx 28rpx;
    margin-bottom: 12rpx;
  }

  .mid {
    flex: 1;
    min-width: 0;
  }

  .name {
    font-size: 30rpx;
    font-weight: 500;
    color: var(--md-on-surface);
  }

  // 负余额（信用卡欠款）用错误色，一眼看出是欠的
  .bal {
    display: block;
    margin-top: 4rpx;
    font-size: 26rpx;
    color: var(--md-on-surface-variant);

    &.neg {
      color: var(--md-error);
    }
  }

  .ops {
    display: flex;
    gap: 2rpx; // 一行最多 4 个操作（↑ ↓ 编辑 删除），挤一点也放得下
  }

  .op {
    width: 62rpx;
    height: 72rpx;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;

    // 已在首/末位：置灰（与分类页 ↑↓ 同一手法）
    &.off {
      opacity: 0.25;
    }
  }

  .add {
    background: transparent;
    border: 2rpx dashed var(--md-outline-variant);

    .add-ic {
      width: 76rpx;
      height: 76rpx;
      border-radius: 50%;
      border: 2rpx dashed var(--md-outline);
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
    }

    .add-t {
      font-size: 28rpx;
      font-weight: 500;
      color: var(--md-primary-strong);
    }
  }

  .empty {
    padding: 40rpx 0;
    text-align: center;

    .empty-t {
      font-size: 26rpx;
      color: var(--md-on-surface-variant);
    }
  }
}

.error-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24rpx;
  padding-top: 200rpx;

  .error-text {
    font-size: 28rpx;
    color: var(--md-on-surface-variant);
  }

  .retry-btn {
    padding: 16rpx 48rpx;
    border-radius: 999rpx;
    background: var(--md-primary-container);

    .retry-text {
      font-size: 28rpx;
      font-weight: 600;
      color: var(--md-on-primary-container);
    }
  }
}

// 初始余额行（挂在全局 .af-row 里）：标签 + 窄输入 + 单位
.af-label {
  flex-shrink: 0;
  font-size: 26rpx;
  color: var(--md-on-surface-variant);
}

.af-bal-input {
  flex: 1;
  min-width: 0;
  height: 72rpx;
  background: var(--md-surface-container);
  border-radius: 20rpx;
  // 右侧给「清空 ×」让位（.clr-btn 贴右 10rpx、命中区 44rpx）；数字右对齐，不留就被压住
  padding: 0 68rpx 0 24rpx;
  font-size: 28rpx;
  text-align: right;
  color: var(--md-on-surface);
  box-sizing: border-box;
}

.af-unit {
  flex-shrink: 0;
  font-size: 26rpx;
  color: var(--md-outline);
}
</style>
