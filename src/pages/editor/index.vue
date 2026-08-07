<template>
  <view 
    class="editor-page" 
    :class="{ 'device-simulator-mobile': isMobileSimulator }"
  >

    <MenuBar
      @undo="handleUndo"
      @redo="handleRedo"
      @clear="handleClear"
      @save="handleSave"
      @export="handleExport"
      @import="handleImport"
      @zoom-in="handleZoomIn"
      @zoom-out="handleZoomOut"
    />
    
    <view class="editor-body">
      <ToolArea
        v-model="currentColor"
        :grid-size="gridSize"
        @update:grid-size="handleGridSizeChange"
        @tool-change="handleToolChange"
        @canvas-visible-change="setCanvasVisible"
        @color-set-change="handleColorSetChange"
      />

      <view class="canvas-wrapper" id="canvasWrapper">
        <DrawPanel
          ref="drawPanelRef"
          :grid-size="gridSize"
          :current-color="currentColor"
          :current-tool="currentTool"
          :canvas-width="canvasWidth"
          :canvas-height="canvasHeight"
          :hide-mode="hideCanvas"
          @update:pixel-data="handlePixelDataUpdate"
        />
      </view>
    </view>
    
    <CustomTabBar />
    
    <canvas type="2d" id="exportCanvas" style="position: fixed; left: -9999px; top: -9999px; width: 256px; height: 256px;"></canvas>
    
  </view>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, nextTick } from 'vue'
import Taro, { useDidShow } from '@tarojs/taro'
import CustomTabBar from '@/custom-tab-bar/index.vue'
import MenuBar from './components/menu/index.vue'
import DrawPanel from './components/drawPanel/index.vue'
import ToolArea from './components/toolArea/index.vue'
import MIcon from '@/components/MIcon/index.vue'
import { isH5 } from '@/utils/platform'
import { exportPixelArtToGallery, convertPixelArtToPngBuffer ,convertPixelArtToPngPath,arrayBufferToTempFilePath, pngToPixelArtData, imageToPixelArtData, transferPixelData, countPixelsLostOnResize} from '@/utils/pixelArt'
import { useEditorTempStore,EditorTempData } from '@/stores/editorTemp'
import { base64ToArrayBuffer, arrayBufferToBase64 } from '@/utils/base64'
import type { PixelArtStatus } from '@/utils/storage'
import './index.scss'


const drawPanelRef = ref<InstanceType<typeof DrawPanel> | null>(null)
const currentColor = ref('#C4634E')
const gridSize = ref(16)
const currentTool = ref('brush')
const pixelData = ref<string[]>([])
const canvasWidth = ref(0)
const canvasHeight = ref(0)
const hideCanvas = ref(false)
const currentColorPalette = ref<string[]>([])
const isMobileSimulator = ref(false)

/** 历史记录条目：同时保存网格尺寸，使撤销/重做能跨尺寸切换回退 */
interface HistoryEntry {
  gridSize: number
  pixelData: string[]
}

const historyStack = ref<HistoryEntry[]>([])
const historyIndex = ref(-1)
const MAX_HISTORY = 50

const handleBack = () => {
  Taro.navigateBack()
}

const saveToHistory = () => {
  const entry: HistoryEntry = {
    gridSize: gridSize.value,
    pixelData: [...pixelData.value]
  }

  if (historyIndex.value < historyStack.value.length - 1) {
    historyStack.value = historyStack.value.slice(0, historyIndex.value + 1)
  }

  historyStack.value.push(entry)

  if (historyStack.value.length > MAX_HISTORY) {
    historyStack.value.shift()
  } else {
    historyIndex.value++
  }
}

/**
 * 还原到指定的历史记录条目
 * 尺寸有变化时先切换 gridSize，等 DrawPanel 依据新尺寸重建缓冲后再写入像素数据，
 * 否则 DrawPanel 内 watch(gridSize) 的重置逻辑会把刚写入的数据覆盖成空白
 */
const restoreHistoryEntry = (entry: HistoryEntry) => {
  const sizeChanged = entry.gridSize !== gridSize.value
  gridSize.value = entry.gridSize
  pixelData.value = [...entry.pixelData]

  if (sizeChanged) {
    nextTick(() => {
      calculateCanvasSize()
      drawPanelRef.value?.setPixelData(pixelData.value)
    })
  } else {
    drawPanelRef.value?.setPixelData(pixelData.value)
  }
}

const handleUndo = () => {
  if (historyIndex.value > 0) {
    historyIndex.value--
    const prevEntry = historyStack.value[historyIndex.value]
    if (prevEntry) {
      restoreHistoryEntry(prevEntry)
    }
  } else {
    Taro.showToast({ title: '无法撤销', icon: 'none', duration: 1000 })
  }
}

const handleRedo = () => {
  if (historyIndex.value < historyStack.value.length - 1) {
    historyIndex.value++
    const nextEntry = historyStack.value[historyIndex.value]
    if (nextEntry) {
      restoreHistoryEntry(nextEntry)
    }
  } else {
    Taro.showToast({ title: '无法重做', icon: 'none', duration: 1000 })
  }
}

const handleClear = () => {
  if (drawPanelRef.value) {
    drawPanelRef.value.clearCanvas()
  }
}

const handleSave = async () => {
  try {
    Taro.showLoading({ title: '处理中...' })
    
    const pngBuffer = await convertPixelArtToPngBuffer({
      gridSize: gridSize.value,
      pixelData: pixelData.value
    }, false)

    let pngTempPath = await convertPixelArtToPngPath({
      gridSize: gridSize.value,
      pixelData: pixelData.value
    }, true)
    
    const { setTempData } = useEditorTempStore()
    setTempData({
      gridSize: gridSize.value,
      pngBuffer: pngBuffer,
      pngTempPath: pngTempPath,
      workId: currentWork.value?.id,
      title: currentWork.value?.title,
      description: currentWork.value?.description,
      tags: currentWork.value?.tags,
      status: currentWork.value?.status
    })

    // H5 端内存 store 可能在页面跳转时丢失，持久化到本地存储作为兜底
    try {
      Taro.setStorageSync('pixelart_save_temp', {
        gridSize: gridSize.value,
        pngBase64: arrayBufferToBase64(pngBuffer),
        pngTempPath: pngTempPath,
        workId: currentWork.value?.id,
        title: currentWork.value?.title,
        description: currentWork.value?.description,
        tags: currentWork.value?.tags,
        status: currentWork.value?.status
      })
    } catch (error) {
      console.error('持久化保存临时数据失败:', error)
    }
    
    Taro.hideLoading()
    Taro.navigateTo({
      url: '/pages/saveForm/index'
    })
  } catch (error) {
    Taro.hideLoading()
    Taro.showToast({ title: '处理失败', icon: 'error' })
  }
}

const handleExport = async () => {
  try {
    const data = {
      gridSize: gridSize.value,
      pixelData: pixelData.value,
      createdAt: new Date().toISOString()
    }
    
    Taro.showLoading({ title: '导出中...' })
    await exportPixelArtToGallery(data,true)
    Taro.hideLoading()
    Taro.showToast({ title: '导出成功', icon: 'success' })
  } catch (error) {
    Taro.hideLoading()
    Taro.showToast({ title: '导出失败', icon: 'error' })
  }
}

const handleImport = () => {
  Taro.chooseImage({
    count: 1,
    sizeType: ['original'],
    sourceType: ['album', 'camera'],
    success: async (res) => {
      const tempFilePath = res.tempFilePaths[0]
      Taro.showLoading({ title: '处理中...' })
      
      try {
        const result = await imageToPixelArtData(
          tempFilePath, 
          gridSize.value, 
          currentColorPalette.value.length > 0 ? currentColorPalette.value : undefined
        )
        
        // 历史记录已带 gridSize，导入即使改变尺寸也无需清空栈，用户可撤销回导入前的状态
        gridSize.value = result.gridSize
        pixelData.value = result.pixelData

        nextTick(() => {
          calculateCanvasSize()
          if (drawPanelRef.value) {
            drawPanelRef.value.setPixelData(pixelData.value)
          }
          saveToHistory()
        })
        
        Taro.hideLoading()
        Taro.showToast({ title: '导入成功', icon: 'success' })
      } catch (error) {
        Taro.hideLoading()
        Taro.showToast({ title: '导入失败', icon: 'error' })
        console.error('Import failed:', error)
      }
    },
    fail: (err) => {
      console.log('Choose image cancelled or failed:', err)
    }
  })
}

const handleColorSetChange = (colors: string[]) => {
  currentColorPalette.value = colors
}

const handleZoomIn = () => {
  if (drawPanelRef.value) {
    drawPanelRef.value.zoomIn()
  }
}

const handleZoomOut = () => {
  if (drawPanelRef.value) {
    drawPanelRef.value.zoomOut()
  }
}

const handlePixelDataUpdate = (data: string[]) => {
  pixelData.value = data
  saveToHistory()
}

/** 画布是否为空（全部为白色底色，即用户尚未绘制任何内容） */
const isCanvasEmpty = () => {
  if (pixelData.value.length === 0) return true
  return pixelData.value.every(color => !color || color.toUpperCase() === '#FFFFFF')
}

/**
 * 应用新的画布尺寸
 * 尺寸切换会作为一条历史记录入栈，用户后悔时可点撤销回到切换前的尺寸与图案
 * @param size - 目标网格边长
 * @param keepPattern - 是否保留原图案（true 时保持原尺寸与原位置，居中对齐搬运）
 */
const applyGridSize = (size: number, keepPattern: boolean) => {
  const prevSize = gridSize.value
  const prevData = pixelData.value

  gridSize.value = size
  pixelData.value = keepPattern
    ? transferPixelData(prevData, prevSize, size)
    : new Array(size * size).fill('#FFFFFF')

  saveToHistory()
  nextTick(() => {
    calculateCanvasSize()
    drawPanelRef.value?.setPixelData(pixelData.value)
  })
}

const handleGridSizeChange = (size: number) => {
  if (size === gridSize.value) return

  // 空画布无内容可丢失，直接切换，避免无谓打扰
  if (isCanvasEmpty()) {
    applyGridSize(size, false)
    return
  }

  // 缩小画布时，居中裁切会丢掉超出新边界的已绘制像素，提示具体数量
  const lostCount = countPixelsLostOnResize(pixelData.value, gridSize.value, size)
  const keepHint = lostCount > 0
    ? `保留时图案位置和大小不变、居中放置，但有 ${lostCount} 个已绘制的像素超出新画布范围会被裁掉。`
    : '保留时图案位置和大小不变，居中放置在新画布上。'

  Taro.showModal({
    title: '切换画布尺寸',
    content: `当前画布已有图案，切换到 ${size}×${size} 后是否保留？${keepHint}`,
    confirmText: '保留图案',
    cancelText: '清空画布',
    success: (res) => {
      if (res.confirm) {
        applyGridSize(size, true)
      } else if (res.cancel) {
        applyGridSize(size, false)
      }
      // 弹窗被其他方式关闭时不改变尺寸，工具栏高亮跟随 props.gridSize 保持原状
    }
  })
}

const handleToolChange = (tool: string) => {
  currentTool.value = tool
}

const setCanvasVisible = (visible: boolean) => {
  hideCanvas.value = !visible
}

const checkWindowSize = () => {
  const width = window.innerWidth || document.documentElement.clientWidth || document.body.clientWidth
  const isPortrait = window.innerHeight < window.innerWidth ? false : true
  
  // 判断是否处于移动设备模拟器模式：≤480px 且竖屏
  isMobileSimulator.value = width <= 480 && isPortrait
}

const calculateCanvasSize = () => {
  const query = Taro.createSelectorQuery()
  query.select('#canvasWrapper').boundingClientRect()
  query.exec((res) => {
    if (res && res[0]) {
      canvasWidth.value = res[0].width
      canvasHeight.value = res[0].height
    }
  })
}


const renderPixelData = () => {
  saveToHistory()
  nextTick(() => {
    calculateCanvasSize()
    if (drawPanelRef.value) {
      drawPanelRef.value.setPixelData(pixelData.value)
    }
  })
}

// 当前正在编辑的已有作品信息（从作品页跳转继续编辑时带入，用于保存时默认上次输入的内容并原地更新）
const currentWork = ref<{ id: string; title: string; description: string; tags: string[]; status: PixelArtStatus } | null>(null)

const applyTempData = async (): Promise<boolean> => {
  const { getTempData, clearTempData } = useEditorTempStore()
  const tempData = getTempData()
  clearTempData()

  if (!tempData) return false

  if (tempData.workId) {
    currentWork.value = {
      id: tempData.workId,
      title: tempData.title || '',
      description: tempData.description || '',
      tags: tempData.tags || [],
      status: tempData.status || 'unfinished'
    }
  } else {
    currentWork.value = null
  }

  gridSize.value = tempData.gridSize
  const tempFilePath = await arrayBufferToTempFilePath(tempData.pngBuffer)
  const editorData = await pngToPixelArtData(tempFilePath, tempData.gridSize)
  pixelData.value = editorData.pixelData
  gridSize.value = editorData.gridSize
  return true
}

const initCanvas = async (): Promise<void> => {
  const loaded = await applyTempData()
  if (!loaded) {
    const initialData = new Array(gridSize.value * gridSize.value).fill('#FFFFFF')
    pixelData.value = initialData
  }
  renderPixelData()
}

// 首次挂载时 onMounted 与 useDidShow 都会触发，用 promise 去重避免重复初始化
let initPromise: Promise<void> | null = null

const ensureCanvasInit = (): Promise<void> => {
  if (!initPromise) {
    initPromise = initCanvas()
  } else {
    // 页面已初始化过：仅当存在临时数据（从作品页跳转继续编辑）时加载
    applyTempData().then((loaded) => {
      if (loaded) renderPixelData()
    })
  }
  return initPromise
}

onMounted(() => {

  ensureCanvasInit()
  
  // H5 端窗口尺寸变化（调整窗口、旋转屏幕）后重新计算画布尺寸
  if (isH5) {
    window.addEventListener('resize', calculateCanvasSize)
    window.addEventListener('orientationchange', checkWindowSize)
    window.addEventListener('resize', checkWindowSize)
    
    // 初始化检查
    checkWindowSize()
  }
})

useDidShow(() => {
  ensureCanvasInit()
})

onUnmounted(() => {
  if (isH5) {
    window.removeEventListener('resize', calculateCanvasSize)
    window.removeEventListener('orientationchange', checkWindowSize)
    window.removeEventListener('resize', checkWindowSize)
  }
})

defineExpose({
  setCanvasVisible
})
</script>
