# 第三方声明（THIRD-PARTY NOTICES）

**本应用（飞鸟记账）版权所有：Copyright © 2026 飞鸟Tokei，保留所有权利。**
需求、取舍与验收由作者负责；界面设计、图标挑选与全部代码由 AI（Anthropic 的 Claude）生成与修改。


本 App 内置或派生自下列第三方作品。本文件是**索引**，许可全文的权威版本在应用内。

> **为什么全文在 App 里**：与隐私政策同一条规矩 —— **App 运行时读不了仓库里的文件**，
> 而 ISC 与 MIT 都要求「版权与许可声明**随分发**保留」，所以正文必须活在 App 里，
> 用户才拿得到。权威版本是 `pages/about/about.vue` 的 `LICENSES` 常量，
> 界面上在「关于本应用 → 第三方声明 → 查看许可全文」。
> **改许可正文只改那一处**，别在这里再抄一份 —— 那是「两处走散」的开始。
> （`docs/privacy-policy.md` 对隐私政策是同一种处理。）

## 索引

| 用在哪 | 作品 | 许可 | 上游 |
|---|---|---|---|
| 图标（绝大部分：分类 支出 40 枚 / 收入 16 枚、账户 16 枚、界面小图标） | Lucide | ISC | <https://github.com/lucide-icons/lucide> |
| 图标（部分源自，随 Lucide 一并使用） | Feather | MIT | <https://github.com/feathericons/feather> |
| 图标（微信账户，取自 `message-circle-dots-2`） | Boxicons（经 Iconify 集合） | MIT；官网另称图标适用 CC BY 4.0 | <https://github.com/box-icons/boxicons> |
| 图标（底栏中央凸起圆钮的笔，取自 `pen-new-round-broken`） | Solar by 480 Design（经 Iconify 集合） | **CC BY 4.0 —— 要求署名** | <https://github.com/480-Design/Solar-Icon-Set> |
| 开发框架 | uni-app | 框架源码 Apache-2.0 | <https://uniapp.dcloud.net.cn/license.html> |
| 随 App 分发的运行时 | DCloud Runtime（含 SQLite 原生模块） | 知识产权归 DCloud；SQLite 属公有领域 | 同上、<https://sqlite.org/copyright.html> |
| 页面运行时 | Vue 3 | MIT | <https://github.com/vuejs/core> |

**唯一强制署名的一处**是 Solar（CC BY 4.0）：要求给出作者、许可链接与有无改动的说明 ——
三条都写在 App 内那一节（图形未改动，仅运行时着色）。

## 校对提示

App 内 `LICENSES` 的正文按上游抄写，其中：

- **Lucide 的 ISC 与 Feather 的 MIT 已于 2026-10-04 联网与上游逐字核对一致**；
- Boxicons 的版权行年份取自其仓库 `LICENSE`（该库的仓库说 MIT、官网文档说图标为 CC BY 4.0，
  两者不一致，App 内按更严的一侧并列写出）；
- CC BY 4.0 按其官方要求只列署名 + 许可链接（其法律文本无需随附）；
- Vue 与 uni-app / DCloud 只给许可名与上游链接，不内嵌正文（上游正文很长且非标准模板）。

改动前请对着上表的链接核一遍。目录名与版权行年份如与上游不一致，**以上游为准**。

---

## 附：字体（无第三方字体被内置）

2026-10-03 逐项核对过，**本 App 不含任何第三方字体**：

- 仓库内没有任何 `.ttf` / `.otf` / `.woff` / `.woff2` / `.eot` 文件
- 全仓库没有一处 `font-family` 声明 —— 一律用**系统默认字体**渲染
- 因此既没有分发字体文件，也没有指定使用某个具名字体

曾经试过内置「霞鹜文楷」（LXGW WenKai，SIL OFL 1.1 —— 该许可本就允许商用与嵌入），
但 App 端 webview 的 `@font-face` 不接受 data URL，真机上必然回退，遂整体移除。
相关经过见 `docs/superpowers/plans/` 与那次提交的说明。

### 将来若要引入自定义字体

优先选 **SIL OFL** 或 **Apache-2.0** 的字体（都明确允许商用与嵌入）。放法：
字体文件放 `static/` 目录，CSS 里用 `@/static/...` 引用（根路径 `/static/...` 在 App 端无效），
并把该字体的许可与版权行补到 `about.vue` 的 `LICENSES` 与本表的索引里。
