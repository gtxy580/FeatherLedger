<template>
  <view class="ci" :style="wrapStyle">
    <!-- svg 内置图标：mask 渲染，白色线形 -->
    <view v-if="mode === 'svg'" :style="glyphStyle"></view>
    <!-- 自定义图片图标（M4 实装数据，分支先备好） -->
    <image v-else-if="mode === 'img'" class="ci-img" :src="imgSrc" mode="aspectFill" />
    <!-- 文字图标：名称首字 -->
    <text v-else class="ci-text" :style="textStyle">{{ firstChar }}</text>
  </view>
</template>

<script>
import { ICONS, iconSvg } from '@/services/icons.js'

export default {
  name: 'category-icon',
  props: {
    // 'svg:key' | 'img:path' | ''（空 → 文字图标）
    icon: { type: String, default: '' },
    color: { type: String, default: '' }, // 色环颜色；空用中性灰兜底
    name: { type: String, default: '' },  // 文字图标取名称首字
    size: { type: Number, default: 80 }   // rpx
  },
  computed: {
    mode() {
      if (this.icon.startsWith('svg:')) return ICONS[this.icon.slice(4)] ? 'svg' : 'text'
      if (this.icon.startsWith('img:')) return 'img'
      return 'text'
    },
    firstChar() {
      return (this.name || '分').trim().charAt(0) || '分'
    },
    px() {
      return uni.upx2px(this.size)
    },
    wrapStyle() {
      return {
        width: this.px + 'px',
        height: this.px + 'px',
        borderRadius: '50%',
        backgroundColor: this.color || '#8A958E',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        flexShrink: 0
      }
    },
    glyphStyle() {
      const uri = `url("data:image/svg+xml,${encodeURIComponent(iconSvg(this.icon.slice(4)))}")`
      const g = Math.round(this.px * 0.52)
      return {
        width: g + 'px',
        height: g + 'px',
        backgroundColor: '#FFFFFF',
        WebkitMaskImage: uri,
        maskImage: uri,
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center'
      }
    },
    imgSrc() {
      return this.icon.slice(4)
    },
    textStyle() {
      return {
        fontSize: Math.round(this.px * 0.42) + 'px',
        color: '#FFFFFF',
        fontWeight: '600',
        lineHeight: 1
      }
    }
  }
}
</script>

<style lang="less">
.ci-img {
  width: 100%;
  height: 100%;
  display: block;
}
</style>
