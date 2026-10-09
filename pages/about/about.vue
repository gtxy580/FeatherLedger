<template>
	<view class="page" :style="[{ paddingTop: statusBarHeight + 'px' }, themeVars]">
		<!-- 顶栏：返回 + 标题（与账户页/主题页同一套；navigationStyle: custom） -->
		<view class="top">
			<view class="icon-btn" @click="goBack">
				<view :style="maskStyle('chevL', 44, 'var(--md-on-surface)')"></view>
			</view>
			<text class="title">关于本应用</text>
			<view class="icon-btn"></view>
		</view>

		<view class="card app">
			<text class="app-name">飞鸟记账</text>
			<text class="app-ver">版本 {{ version }}</text>
			<text class="app-slogan">本地记账：数据只存在本机，不联网、不上传。</text>
		</view>

		<!-- 隐私政策：**这里就是权威版本**（App 运行时读不了仓库里的文件）。
         仓库的 docs/privacy-policy.md 只是指向本页的说明，正文只此一份，不会走散。 -->
		<view class="card">
			<text class="sec-t">隐私政策</text>
			<text class="sec-sub">生效日期 2026-10-03　最后更新 2026-10-03</text>
			<view class="doc">
				<text class="h" v-for="(blk, i) in policy" :key="i" :class="{ p: blk.p }">{{ blk.t }}</text>
			</view>
		</view>

		<view class="card">
			<text class="sec-t">第三方声明</text>
			<view class="doc">
				<text class="p">界面图标绝大部分取自 Lucide（ISC 许可，允许商用、不要求界面署名，但要求随分发保留版权与许可声明），其中部分源自 Feather（MIT）；另有 2 枚例外：微信账户的图标取自 Boxicons（MIT），底栏中央的笔取自 Solar 图标集（CC BY 4.0，要求署名）。全部图形均未改动，仅在运行时着色。</text>
				<text class="p">本应用用 uni-app 开发（框架源码 Apache-2.0；打包进 App 的 DCloud Runtime 与 SQLite 原生模块，知识产权归 DCloud 所有）。</text>
			</view>
			<!-- 许可全文默认收起。展开/收起是纯前端状态，不落库 -->
			<view class="more af-press" :class="{ pressing: isPressed('lic') }" @touchstart="pressOn('lic')"
				@touchend="pressOff" @touchcancel="pressOff" @click="showLicenses = !showLicenses">
				<text class="more-t">{{ showLicenses ? '收起许可全文' : '查看许可全文' }}</text>
				<view :style="maskStyle(showLicenses ? 'chevUp' : 'chevDown', 32, 'var(--md-primary-strong)')"></view>
			</view>
			<view v-if="showLicenses" class="doc">
				<text v-for="(blk, i) in licenses" :key="i" class="h" :class="{ p: blk.p }">{{ blk.t }}</text>
			</view>
		</view>

		<view class="card">
			<text class="sec-t">版权</text>
			<view class="doc">
				<text class="p">Copyright © 2026 飞鸟Tokei　保留所有权利。</text>
				<text class="h">界面与代码由 AI 生成</text>
				<text class="p">本应用由飞鸟Tokei 提出需求、做取舍、逐轮在真机上验收；界面设计、图标挑选与全部代码由 AI（Anthropic 的 Claude）生成与修改。方向与判断是人做的，落笔是 AI 做的。</text>
			</view>
		</view>

		<view class="card">
			<text class="sec-t">联系</text>
			<view class="doc">
				<text class="p">如对本应用或隐私政策有疑问，请联系：{{ contact }}</text>
			</view>
		</view>
	</view>
</template>

<script>
	import {
		maskStyle,
		ICONS
	} from '@/services/icons.js'
	import pressFx from '@/services/press.js'

	/** ⚠ 唯一需要你改的一处：联系方式。改这里即可，仓库的 docs/privacy-policy.md 只是指针。 */
	const CONTACT = 'gtxy580@qq.com'

	/**
	 * 隐私政策正文。**这是权威版本** —— App 运行时读不了仓库里的 md 文件，
	 * 所以正文只存在于此处；docs/privacy-policy.md 只留一句「以应用内为准」。
	 * `p: true` 的按正文段落排（更大行距、更松的字色），其余按小标题排。
	 */
	const POLICY = [{
			t: '一句话概括',
			p: false
		},
		{
			t: '飞鸟记账不收集、不上传任何个人信息。你的全部账本数据只保存在你自己的手机上。',
			p: true
		},

		{
			t: '一、我们收集哪些信息',
			p: false
		},
		{
			t: '不收集。本应用没有账号体系，不需要注册或登录；没有联网功能，应用内不存在任何网络请求代码；不接入任何第三方统计、埋点、崩溃上报或广告 SDK。',
			p: true
		},
		{
			t: '本应用不申请获取你的位置、通讯录、相册、相机、麦克风、通话记录、设备标识等信息。',
			p: true
		},

		{
			t: '二、你的数据存在哪里',
			p: false
		},
		{
			t: '你录入的全部内容（流水、分类、账户、一句话签名等）都保存在本机应用沙箱内的一个数据库文件中。该文件位于应用私有目录，其他应用无法读取；数据不会离开这台设备。',
			p: true
		},
		{
			t: '卸载应用即彻底删除全部数据，我们无法也无力为你恢复。',
			p: true
		},

		{
			t: '三、唯一会读写剪贴板的地方',
			p: false
		},
		{
			t: '「数据管理」里的导出备份 / 导入备份功能通过系统剪贴板搬运一段文本：导出时把你自己的账本数据复制到剪贴板（由你决定粘贴到哪里）；导入时读取剪贴板上的一段文本，校验通过后用它替换本机数据。',
			p: true
		},
		{
			t: '剪贴板内容仅在上述操作发生时被读写，不会被上传，也不会被用于其他任何用途。你若不使用这两个功能，应用不会触碰剪贴板。',
			p: true
		},

		{
			t: '四、申请的权限',
			p: false
		},
		{
			t: '应用只申请了一项敏感权限：震动（VIBRATE），用于分类排序完成时的触觉反馈。其余仅为运行时的网络状态查询等基础权限，应用自身不发起任何网络连接。',
			p: true
		},

		{
			t: '五、未成年人',
			p: false
		},
		{
			t: '本应用不收集任何个人信息，因此也不存在针对未成年人的信息收集问题。',
			p: true
		},

		{
			t: '六、政策变更',
			p: false
		},
		{
			t: '若本政策有更新，将随应用版本一并发布，并更新本页顶部的「最后更新」日期。',
			p: true
		}
	]

	/**
	 * 第三方许可**全文**。与上面的隐私政策同一条规矩：**这里是权威版本** —— App 运行时读不了
	 * 仓库里的 md 文件，而 ISC 与 MIT 都要求「版权与许可声明随分发保留」，所以正文必须活在 App 里；
	 * 仓库根目录的 THIRD-PARTY-NOTICES.md 只是索引与指针（写明用到了谁、各是什么许可）。
	 *
	 * 为什么拆成这一长串 `{t, p}` 而不是一个大字符串：本页的 .doc 就认这个形状
	 * （p:false 排小标题、p:true 排正文段落），而且不必去赌 <text> 的换行渲染。
	 * 许可正文本来按段落分，拆开反而更好读。
	 *
	 * 校对：Lucide 的 ISC 与 Feather 的 MIT 已于 2026-10-04 联网与上游逐字核对；
	 * Boxicons 的版权行年份按上游仓库 LICENSE（其余按 MIT 通用模板抄写）。改之前先对一遍下面的链接。
	 */
	const LICENSES = [{
			t: '一、Lucide 图标（ISC 许可）',
			p: false
		},
		{
			// ★ 枚数**从 ICONS 现算**，不写死。原先写死成「73 枚」，加了收入图标那两批之后
			//   实际已经是 105，而这类数字没有任何门拦得住（它只是文案里的一段字）。
			//   反引号模板串在模块加载时求值一次，与 icons.js 永远同步。
			t: `用在哪：本应用的绝大部分图标 —— 分类图标、账户图标与各处界面小图标（services/icons.js 的 ${Object.keys(ICONS).length} 枚里只有 2 枚不是它）。用法：把 SVG 的路径数据抄进源码，运行时用 CSS 遮罩着色，不引入任何依赖。`,
			p: true
		},
		{
			t: 'Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.',
			p: true
		},
		{
			t: 'Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.',
			p: true
		},
		{
			t: 'THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.',
			p: true
		},
		{
			t: '许可链接：github.com/lucide-icons/lucide',
			p: true
		},

		{
			t: '二、Feather 图标（MIT 许可）',
			p: false
		},
		{
			t: '用在哪：Lucide 里有部分图标源自 Feather，随上一节一并使用。',
			p: true
		},
		{
			t: 'Copyright (c) 2013-present Cole Bemis',
			p: true
		},
		{
			t: 'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
			p: true
		},
		{
			t: 'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.',
			p: true
		},
		{
			t: 'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
			p: true
		},
		{
			t: '许可链接：github.com/feathericons/feather',
			p: true
		},

		{
			t: '三、Boxicons 图标（MIT 许可）',
			p: false
		},
		{
			t: '用在哪：微信账户的图标，取自 boxicons 的 message-circle-dots-2（经 Iconify 集合取得）。运行时仅着色，图形未改动。',
			p: true
		},
		{
			t: 'Copyright (c) 2015-2021 Aniket Suvarna',
			p: true
		},
		{
			t: 'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
			p: true
		},
		{
			t: 'The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.',
			p: true
		},
		{
			t: 'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
			p: true
		},
		{
			t: '注：Boxicons 的仓库 LICENSE 是 MIT；其官网文档另称图标（.svg）适用 CC BY 4.0、字体适用 SIL OFL 1.1。两处说法不一致，本页按更严的一侧，连 CC BY 4.0 的署名与链接一并列出。许可链接：github.com/box-icons/boxicons',
			p: true
		},

		{
			t: '四、Solar 图标集（CC BY 4.0，要求署名）',
			p: false
		},
		{
			t: '用在哪：底栏中央那枚凸起圆钮里的笔，取自 solar 的 pen-new-round-broken（经 Iconify 集合取得）。运行时仅着色，图形未改动。',
			p: true
		},
		{
			t: '署名：Solar icon set by 480 Design　许可链接：https://creativecommons.org/licenses/by/4.0/　上游：github.com/480-Design/Solar-Icon-Set',
			p: true
		},
		{
			t: 'CC BY 4.0 的合规要求就是「署名 + 许可链接 + 注明有无改动」（本页上方三条即是），其法律文本无需随附。全文见上述许可链接。',
			p: true
		},

		{
			t: '五、uni-app 框架、DCloud Runtime 与 SQLite',
			p: false
		},
		{
			t: '本应用用 uni-app 开发。uni-app 框架源码采用 Apache-2.0 许可；打包进 App 的 DCloud Runtime 与 SQLite 原生模块，其知识产权归 DCloud 所有，随 App 一并分发。SQLite 本身属公有领域（public domain），无需署名。',
			p: true
		},
		{
			t: '许可链接：uniapp.dcloud.net.cn/license.html　SQLite：sqlite.org/copyright.html',
			p: true
		},

		{
			t: '六、Vue 3',
			p: false
		},
		{
			t: '本应用的页面用具名选项式写法（Vue 3 Options API）实现；Vue 的运行时随 uni-app 的运行时一并分发，采用 MIT 许可，版权归 Evan You 及 Vue.js 贡献者。许可全文见其上游：github.com/vuejs/core/blob/main/LICENSE.txt',
			p: true
		}
	]

	export default {
		mixins: [pressFx],
		data() {
			return {
				statusBarHeight: 0,
				version: '',
				policy: POLICY,
				contact: CONTACT,
				licenses: LICENSES,
				showLicenses: false // 许可全文默认收起：五六段法律文本一直铺开会把这一页撑得没法看
			}
		},
		onLoad() {
			this.statusBarHeight = uni.getSystemInfoSync().statusBarHeight || 0
			this.version = this.readVersion()
		},
		methods: {
			maskStyle,
			goBack() {
				uni.navigateBack()
			},
			/**
			 * 版本号从运行时读，不写死 —— 否则改了 manifest 里的 versionName 就会忘了改这里。
			 * 两个来源都包在 try/catch 里：任一个不可用都不该让这一页白屏，最差显示「未知」。
			 */
			readVersion() {
				try {
					const v = uni.getSystemInfoSync().appVersion
					if (v) return v
				} catch (e) {
					// 取不到就试下一个来源
				}
				try {
					if (typeof plus !== 'undefined' && plus.runtime && plus.runtime.version) {
						return plus.runtime.version
					}
				} catch (e) {
					// 同上
				}
				return '未知'
			}
		}
	}
</script>

<style lang="less">
	.page {
		min-height: 100vh;
		box-sizing: border-box;
		padding-bottom: calc(60rpx + env(safe-area-inset-bottom));
		background: var(--md-surface-container);
	}

	.top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12rpx 24rpx;

		.icon-btn {
			width: 84rpx;
			height: 84rpx;
			border-radius: 50%;
			display: flex;
			align-items: center;
			justify-content: center;
		}

		.title {
			font-size: 32rpx;
			font-weight: 600;
			color: var(--md-on-surface);
		}
	}

	.card {
		margin: 20rpx 32rpx 0;
		background: var(--md-surface);
		border-radius: 32rpx;
		padding: 32rpx;
	}

	.app {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 40rpx 32rpx;

		.app-name {
			font-size: 40rpx;
			font-weight: 700;
			letter-spacing: 4rpx;
			color: var(--md-on-surface);
		}

		.app-ver {
			margin-top: 10rpx;
			font-size: 24rpx;
			color: var(--md-on-surface-variant);
		}

		.app-slogan {
			margin-top: 22rpx;
			font-size: 24rpx;
			line-height: 1.6;
			text-align: center;
			color: var(--md-on-surface-variant);
		}
	}

	.sec-t {
		display: block;
		font-size: 27rpx;
		font-weight: 600;
		color: var(--md-on-surface);
	}

	.sec-sub {
		display: block;
		margin-top: 8rpx;
		font-size: 22rpx;
		color: var(--md-outline);
	}

	// 正文：条款这种大段文字要松的行距，否则一坨
	.doc {
		margin-top: 18rpx;

		.h {
			display: block;
			margin-top: 24rpx;
			font-size: 25rpx;
			font-weight: 600;
			line-height: 1.6;
			color: var(--md-on-surface);

			&:first-child {
				margin-top: 0;
			}

			&.p {
				margin-top: 10rpx;
				font-weight: 400;
				color: var(--md-on-surface-variant);
			}
		}

		.p {
			display: block;
			margin-top: 14rpx;
			font-size: 25rpx;
			line-height: 1.75;
			color: var(--md-on-surface-variant);

			&:first-child {
				margin-top: 0;
			}
		}
	}

	// 「查看许可全文 / 收起许可全文」那一行：整行可点（带按下反馈），
	// 文字用主题色 + 右侧一枚小三角 —— 与页面里其他「次级动作」同一套观感
	.more {
		display: flex;
		align-items: center;
		gap: 8rpx;
		margin-top: 18rpx;
		padding: 10rpx 0;

		.more-t {
			font-size: 25rpx;
			font-weight: 600;
			color: var(--md-primary-strong);
		}
	}
</style>
