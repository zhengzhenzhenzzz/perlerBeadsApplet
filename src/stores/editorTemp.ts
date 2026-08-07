import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { PixelArtStatus } from '@/utils/storage'

export interface EditorTempData {
  gridSize: number
  pngBuffer: ArrayBuffer
  pngTempPath: string
  // 正在编辑的已有作品信息，用于保存时默认上次输入的内容并原地更新
  workId?: string
  title?: string
  description?: string
  tags?: string[]
  status?: PixelArtStatus
}

export const useEditorTempStore = defineStore('editorTemp', () => {
  const tempData = ref<EditorTempData | null>(null)

  const setTempData = (data: EditorTempData) => {
    tempData.value = data
  }

  const getTempData = () => {
    return tempData.value
  }

  const clearTempData = () => {
    tempData.value = null
  }

  return {
    tempData,
    setTempData,
    getTempData,
    clearTempData
  }
})
