import Taro from '@tarojs/taro'
import { isH5 } from './platform'
import { base64ToArrayBuffer } from './base64'

interface PixelArtData {
  gridSize: number
  pixelData: string[]
}
export type PixelArtDataType = PixelArtData
const HIGH_QUALITY_SIZE = 256

// H5 端通过 createObjectURL 生成的有效临时地址集合，用于校验缩略图是否仍然可用
const activeBlobUrls = new Set<string>()

function calculateCanvasSize(gridSize: number, highQuality: boolean): number {
  if (!highQuality) {
    return gridSize
  }
  
  const multiplier = Math.round(HIGH_QUALITY_SIZE / gridSize)
  return gridSize * multiplier
}

async function createOffscreenCanvas(width: number, height: number): Promise<any> {
  // H5 端直接使用离屏 DOM canvas，无需依赖页面中的 canvas 节点
  if (isH5) {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    return { canvas, ctx }
  }
  return new Promise((resolve, reject) => {
    const query = Taro.createSelectorQuery()
    query.select('#exportCanvas')
      .fields({ node: true, size: true })
      .exec((res) => {
        if (res && res[0]) {
          const canvas = res[0].node
          const ctx = canvas.getContext('2d')
          canvas.width = width
          canvas.height = height
          resolve({ canvas, ctx })
        } else {
          reject(new Error('Canvas not found'))
        }
      })
  })
}

/**
 * 创建可用于 canvas drawImage 的图片对象
 * H5 端使用原生 Image，小程序端使用 canvas.createImage()
 */
function createCanvasImage(canvas: any): any {
  if (isH5) {
    return new Image()
  }
  return canvas.createImage()
}

async function drawPixelArtToCanvas(ctx: any, data: PixelArtData, canvasSize: number): Promise<void> {
  const { gridSize, pixelData } = data
  const pixelSize = canvasSize / gridSize

  for (let i = 0; i < pixelData.length; i++) {
    const x = (i % gridSize) * pixelSize
    const y = Math.floor(i / gridSize) * pixelSize
    const color = pixelData[i]

    ctx.fillStyle = color
    ctx.fillRect(x, y, pixelSize, pixelSize)
  }
}

async function canvasToTempFilePath(canvas: any, quality: number = 0.8): Promise<string> {
  // H5 端直接导出 dataURL，作为图片地址使用
  if (isH5) {
    return canvas.toDataURL('image/png')
  }
  return new Promise((resolve, reject) => {
    Taro.canvasToTempFilePath({
      canvas: canvas,
      fileType: 'png',
      quality: quality,
      success: (res) => {
        resolve(res.tempFilePath)
      },
      fail: (err) => {
        reject(err)
      }
    })
  })
}

async function canvasToArrayBuffer(canvas: any, quality: number = 0.9): Promise<ArrayBuffer> {
  try {
    if (isH5) {
      // H5 端没有文件系统，直接从 dataURL 解析出二进制数据
      const dataUrl: string = canvas.toDataURL('image/png')
      const base64 = dataUrl.split(',')[1]
      return base64ToArrayBuffer(base64)
    }
    const tempFilePath = await canvasToTempFilePath(canvas, quality)
    
    return new Promise((resolve, reject) => {
      const fs = Taro.getFileSystemManager()
      fs.readFile({
        filePath: tempFilePath,
        success: (res) => {
          resolve(res.data as ArrayBuffer)
        },
        fail: (err) => {
          reject(err)
        }
      })
    })
  } catch (error) {
    console.error('Canvas to ArrayBuffer failed:', error)
    throw error
  }
}

export async function saveImageToPhotosAlbum(filePath: string): Promise<void> {
  // H5 端无相册概念，降级为浏览器下载图片
  if (isH5) {
    const a = document.createElement('a')
    a.href = filePath
    a.download = `pixel-art-${Date.now()}.png`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    return
  }
  return new Promise((resolve, reject) => {
    Taro.saveImageToPhotosAlbum({
      filePath: filePath,
      success: () => {
        resolve()
      },
      fail: (err) => {
        if (err.errMsg.includes('auth deny')) {
          Taro.showModal({
            title: '提示',
            content: '需要您授权保存相册权限',
            success: (modalRes) => {
              if (modalRes.confirm) {
                Taro.openSetting({
                  success: (settingRes) => {
                    if (settingRes.authSetting['scope.writePhotosAlbum']) {
                      saveImageToPhotosAlbum(filePath).then(resolve).catch(reject)
                    } else {
                      reject(new Error('用户拒绝授权'))
                    }
                  }
                })
              } else {
                reject(new Error('用户拒绝授权'))
              }
            }
          })
        } else {
          reject(err)
        }
      }
    })
  })
}

export async function exportPixelArtToGallery(data: PixelArtData, highQuality: boolean = false): Promise<void> {
  try {
    const { gridSize } = data
    const canvasSize = calculateCanvasSize(gridSize, highQuality)
    const { canvas, ctx } = await createOffscreenCanvas(canvasSize, canvasSize)
    
    await drawPixelArtToCanvas(ctx, data, canvasSize)
    
    const tempFilePath = await canvasToTempFilePath(canvas, 0.8)
    
    await saveImageToPhotosAlbum(tempFilePath)
  } catch (error) {
    console.error('Export pixel art failed:', error)
    throw error
  }
}

export async function compressAndExportPixelArt(data: PixelArtData, highQuality: boolean = false): Promise<void> {
  return exportPixelArtToGallery(data, highQuality)
}

export async function convertPixelArtToPngPath(data: PixelArtData, highQuality: boolean = false): Promise<string> {
  try {
    const { gridSize } = data
    const canvasSize = calculateCanvasSize(gridSize, highQuality)
    const { canvas, ctx } = await createOffscreenCanvas(canvasSize, canvasSize)

    await drawPixelArtToCanvas(ctx, data, canvasSize)

    const tempFilePath = await canvasToTempFilePath(canvas, 0.9)
    return tempFilePath
  } catch (error) {
    console.error('Convert pixel art to PNG path failed:', error)
    throw error
  }
}

export async function convertPixelArtToPngBuffer(data: PixelArtData, highQuality: boolean = false): Promise<ArrayBuffer> {
  try {
    const { gridSize } = data
    const canvasSize = calculateCanvasSize(gridSize, highQuality)
    const { canvas, ctx } = await createOffscreenCanvas(canvasSize, canvasSize)

    await drawPixelArtToCanvas(ctx, data, canvasSize)

    const buffer = await canvasToArrayBuffer(canvas, 0.9)
    return buffer
  } catch (error) {
    console.error('Convert pixel art to PNG buffer failed:', error)
    throw error
  }
}

export async function arrayBufferToTempFilePath(buffer: ArrayBuffer): Promise<string> {
  try {
    // H5 端没有文件系统，使用 Blob URL 充当临时文件地址
    if (isH5) {
      const blob = new Blob([buffer], { type: 'image/png' })
      const url = URL.createObjectURL(blob)
      activeBlobUrls.add(url)
      return url
    }
    const fs = Taro.getFileSystemManager()
    const tempFilePath = `${Taro.env.USER_DATA_PATH}/temp_${Date.now()}.png`
    
    return new Promise((resolve, reject) => {
      fs.writeFile({
        filePath: tempFilePath,
        data: buffer,
        encoding: 'binary',
        success: () => {
          resolve(tempFilePath)
        },
        fail: (err) => {
          reject(err)
        }
      })
    })
  } catch (error) {
    console.error('ArrayBuffer to temp file path failed:', error)
    throw error
  }
}

export async function checkTempFileExists(filePath: string): Promise<boolean> {
  try {
    if (isH5) {
      // H5 端 dataURL 恒有效；blob URL 仅在当前会话内有效，其余视为不存在以触发重新生成
      if (filePath.startsWith('data:')) return true
      if (filePath.startsWith('blob:')) return activeBlobUrls.has(filePath)
      return false
    }
    const fs = Taro.getFileSystemManager()
    return new Promise((resolve) => {
      fs.access({
        path: filePath,
        success: () => {
          resolve(true)
        },
        fail: () => {
          resolve(false)
        }
      })
    })
  } catch (error) {
    return false
  }
}

export function generatePixelArtPreview(data: PixelArtData, highQuality: boolean = false): Promise<string> {
  return convertPixelArtToPngPath(data, highQuality)
}

async function getImageInfo(src: string): Promise<any> {
  return new Promise((resolve, reject) => {
    Taro.getImageInfo({
      src: src,
      success: resolve,
      fail: reject
    })
  })
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(x => {
    const hex = Math.round(x).toString(16)
    return hex.length === 1 ? '0' + hex : hex
  }).join('')
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return { r, g, b }
}

function calculateColorDistance(color1: { r: number; g: number; b: number }, color2: { r: number; g: number; b: number }): number {
  const dr = color1.r - color2.r
  const dg = color1.g - color2.g
  const db = color1.b - color2.b
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

function findClosestColor(hexColor: string, colorPalette: string[]): string {
  const targetColor = hexToRgb(hexColor)
  let minDistance = Infinity
  let closestColor = colorPalette[0]
  
  for (const color of colorPalette) {
    const paletteColor = hexToRgb(color)
    const distance = calculateColorDistance(targetColor, paletteColor)
    
    if (distance < minDistance) {
      minDistance = distance
      closestColor = color
    }
  }
  
  return closestColor
}

export async function pngToPixelArtData(imagePath: string, gridSize: number): Promise<PixelArtData> {
  try {
    const imageInfo = await getImageInfo(imagePath)
    const { width, height } = imageInfo
    
    const { canvas, ctx } = await createOffscreenCanvas(width, height)
    
    return new Promise((resolve, reject) => {
      const img = createCanvasImage(canvas)
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height)
        
        const pixelData: string[] = []
        const pixelWidth = width / gridSize
        const pixelHeight = height / gridSize
        
        for (let row = 0; row < gridSize; row++) {
          for (let col = 0; col < gridSize; col++) {
            const x = Math.floor(col * pixelWidth + pixelWidth / 2)
            const y = Math.floor(row * pixelHeight + pixelHeight / 2)
            
            const imageData = ctx.getImageData(x, y, 1, 1)
            const [r, g, b] = imageData.data
            const hexColor = rgbToHex(r, g, b)
            
            pixelData.push(hexColor)
          }
        }
        
        const result: PixelArtData = {
          gridSize: gridSize,
          pixelData: pixelData
        }
        
        resolve(result)
      }
      
      img.onerror = (err) => {
        reject(new Error('Failed to load image'))
      }
      
      img.src = imagePath
    })
  } catch (error) {
    console.error('Convert PNG to pixel art data failed:', error)
    throw error
  }
}

export async function upscalePixelArtPng(
  imagePath: string,
  gridSize: number,
  highQuality: boolean = true
): Promise<string> {
  const pixelData = await pngToPixelArtData(imagePath, gridSize)
  const hdPath = await convertPixelArtToPngPath(pixelData, highQuality)
  return hdPath
}

export async function upscalePixelArtPngToBuffer(
  imagePath: string,
  gridSize: number,
  highQuality: boolean = true
): Promise<ArrayBuffer> {
  const pixelData = await pngToPixelArtData(imagePath, gridSize)
  const buffer = await convertPixelArtToPngBuffer(pixelData, highQuality)
  return buffer
}

export async function imageToPixelArtData(
  imagePath: string,
  targetGridSize: number,
  colorPalette?: string[]
): Promise<PixelArtData> {
  try {
    const imageInfo = await getImageInfo(imagePath)
    const { width, height } = imageInfo
    
    const maxDim = Math.max(width, height)
    const scale = targetGridSize / maxDim
    
    const scaledWidth = Math.round(width * scale)
    const scaledHeight = Math.round(height * scale)
    
    const { canvas, ctx } = await createOffscreenCanvas(targetGridSize, targetGridSize)
    
    return new Promise((resolve, reject) => {
      const img = createCanvasImage(canvas)
      img.onload = () => {
        ctx.fillStyle = '#FFFFFF'
        ctx.fillRect(0, 0, targetGridSize, targetGridSize)
        
        const offsetX = Math.round((targetGridSize - scaledWidth) / 2)
        const offsetY = Math.round((targetGridSize - scaledHeight) / 2)
        
        ctx.drawImage(img, offsetX, offsetY, scaledWidth, scaledHeight)
        
        const pixelData: string[] = []
        const pixelWidth = targetGridSize / targetGridSize
        const pixelHeight = targetGridSize / targetGridSize
        
        for (let row = 0; row < targetGridSize; row++) {
          for (let col = 0; col < targetGridSize; col++) {
            const x = Math.floor(col * pixelWidth + pixelWidth / 2)
            const y = Math.floor(row * pixelHeight + pixelHeight / 2)
            
            const imageData = ctx.getImageData(x, y, 1, 1)
            const [r, g, b] = imageData.data
            let hexColor = rgbToHex(r, g, b)
            
            if (colorPalette && colorPalette.length > 0) {
              hexColor = findClosestColor(hexColor, colorPalette)
            }
            
            pixelData.push(hexColor)
          }
        }
        
        const result: PixelArtData = {
          gridSize: targetGridSize,
          pixelData: pixelData
        }
        
        resolve(result)
      }
      
      img.onerror = (err) => {
        reject(new Error('Failed to load image'))
      }
      
      img.src = imagePath
    })
  } catch (error) {
    console.error('Convert image to pixel art data failed:', error)
    throw error
  }
}
