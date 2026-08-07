<template>
  <view class="save-form-page">
    <view class="preview-section">
      <image
        v-if="previewUrl"
        class="preview-image"
        :src="previewUrl"
        :style="{ width: previewSize + 'px', height: previewSize + 'px' }"
        mode="aspectFit"
      />
    </view>
    
    <view class="form-section">
      <view class="form-item">
        <text class="form-label">
          标题<text class="required">*</text>
        </text>
        <input
          class="form-input"
          v-model="formData.title"
          placeholder="请输入作品标题"
          maxlength="50"
        />
      </view>
      
      <view class="form-item">
        <text class="form-label">简介</text>
        <textarea
          class="form-textarea"
          v-model="formData.description"
          placeholder="请输入作品简介（选填）"
          maxlength="200"
        />
      </view>
      
      <view class="form-item">
        <text class="form-label">标签</text>
        <view class="tags-section">
          <view
            v-for="(tag, index) in formData.tags"
            :key="index"
            class="tag-item"
          >
            <text class="tag-text">{{ tag }}</text>
            <view class="tag-close" @tap="handleRemoveTag(index)">
              <text>×</text>
            </view>
          </view>
        </view>
        <view class="tag-input-wrapper">
          <input
            class="tag-input"
            v-model="tagInput"
            placeholder="输入标签后点击添加"
            maxlength="20"
            @confirm="handleAddTag"
          />
          <view class="add-tag-btn" @tap="handleAddTag">
            <text>✛</text>
          </view>
        </view>
      </view>
      
      <view class="form-item">
        <text class="form-label">状态</text>
        <view class="status-section">
          <view
            :class="['status-item', { active: formData.status === 'unfinished' }]"
            @tap="formData.status = 'unfinished'"
          >
            <text class="status-text">进行中</text>
          </view>
          <view
            :class="['status-item', { active: formData.status === 'finished' }]"
            @tap="formData.status = 'finished'"
          >
            <text class="status-text">已完成</text>
          </view>
        </view>
      </view>
      
      <view class="form-actions">
        <view class="btn btn-secondary" @tap="handleCancel">取消</view>
        <view
          :class="['btn', 'btn-primary', { 'btn-disabled': !canSubmit }]"
          @tap="handleSubmit"
        >
          保存
        </view>
      </view>
    </view>
  </view>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import Taro from '@tarojs/taro'
import { savePixelArt, updatePixelArt, PixelArtStatus } from '@/utils/storage'
import { arrayBufferToBase64, base64ToArrayBuffer } from '@/utils/base64'
import { arrayBufferToTempFilePath } from '@/utils/pixelArt'
import { useEditorTempStore, EditorTempData } from '@/stores/editorTemp'
import './index.scss'

interface EditorData extends EditorTempData {}

const formData = ref({
  title: '',
  description: '',
  tags: [] as string[],
  status: 'unfinished' as PixelArtStatus
})

const tagInput = ref('')
const editorData = ref<EditorData | null>(null)
const previewSize = ref(200)
const previewUrl = ref('')

const canSubmit = computed(() => {
  return formData.value.title.trim().length > 0 && editorData.value !== null
})

const handleAddTag = () => {
  const tag = tagInput.value.trim()
  if (tag && !formData.value.tags.includes(tag) && formData.value.tags.length < 5) {
    formData.value.tags.push(tag)
    tagInput.value = ''
  } else if (formData.value.tags.length >= 5) {
    Taro.showToast({ title: '最多添加5个标签', icon: 'none' })
  }
}

const handleRemoveTag = (index: number) => {
  formData.value.tags.splice(index, 1)
}

const handleCancel = () => {
  const { clearTempData } = useEditorTempStore()
  clearTempData()
  Taro.removeStorageSync('pixelart_save_temp')
  Taro.navigateBack()
}

const handleSubmit = async () => {
  if (!canSubmit.value || !editorData.value) {
    return
  }
  
  try {
    Taro.showLoading({ title: '保存中...' })
    
    const common = {
      title: formData.value.title.trim(),
      description: formData.value.description.trim(),
      tags: formData.value.tags,
      status: formData.value.status,
      gridSize: editorData.value.gridSize,
      pngData: editorData.value.pngBuffer,
      pngTempPath: editorData.value.pngTempPath
    }

    // 从作品页继续编辑：原地更新已有作品，保留原 id 与创建时间
    if (editorData.value.workId) {
      await updatePixelArt(editorData.value.workId, {
        ...common,
        pngData: arrayBufferToBase64(editorData.value.pngBuffer)
      })
    } else {
      await savePixelArt(common)
    }
    
    const { clearTempData } = useEditorTempStore()
    clearTempData()
    Taro.removeStorageSync('pixelart_save_temp')
    
    Taro.hideLoading()
    Taro.showToast({ title: '保存成功', icon: 'success' })
    
    setTimeout(() => {
      Taro.switchTab({
        url: '/pages/profile/index'
      })
    }, 1500)
  } catch (error) {
    console.error('Error saving pixel art:', error)
    Taro.hideLoading()
    Taro.showToast({ title: '保存失败', icon: 'error' })
  }
}

onMounted(async () => {
  const { getTempData } = useEditorTempStore()
  let data = getTempData()

  // 内存 store 丢失（如 H5 页面跳转后 store 重置）时，回退到本地存储中的临时保存数据
  if (!data) {
    try {
      const saved = Taro.getStorageSync('pixelart_save_temp')
      if (saved && saved.gridSize && saved.pngBase64) {
        data = {
          gridSize: saved.gridSize,
          pngBuffer: base64ToArrayBuffer(saved.pngBase64),
          pngTempPath: saved.pngTempPath,
          workId: saved.workId,
          title: saved.title,
          description: saved.description,
          tags: saved.tags,
          status: saved.status
        }
      }
    } catch (error) {
      console.error('读取保存临时数据失败:', error)
    }
  }
  
  if (data) {
    editorData.value = data
    
    // 从作品页继续编辑时，默认填入上次输入的标题、简介、标签与状态
    if (data.title !== undefined) {
      formData.value.title = data.title
    }
    if (data.description !== undefined) {
      formData.value.description = data.description
    }
    if (data.tags !== undefined) {
      formData.value.tags = [...data.tags]
    }
    if (data.status !== undefined) {
      formData.value.status = data.status
    }
    
    if (data.pngBuffer) {
      try {
        previewUrl.value = data.pngTempPath
        // 预览图尺寸自适应屏幕宽度：移动端约占屏宽 55%，并受网格尺寸约束
        const systemInfo = Taro.getSystemInfoSync()
        const screenWidth = systemInfo.windowWidth || 375
        const maxSize = Math.min(screenWidth * 0.55, 280)
        previewSize.value = Math.max(120, Math.min(data.gridSize * 10, maxSize))
      } catch (error) {
        console.error('Failed to convert ArrayBuffer to temp file:', error)
      }
    }
  } else {
    Taro.showToast({ title: '数据加载失败', icon: 'error' })
  }
})
</script>
