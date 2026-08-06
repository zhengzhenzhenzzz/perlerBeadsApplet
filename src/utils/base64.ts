import Taro from '@tarojs/taro'
import { isH5 } from './platform'

export function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  // H5 端 Taro.arrayBufferToBase64 内部使用 base64-js，fromByteArray 只支持 Uint8Array，
  // 直接传入 ArrayBuffer 会返回空字符串，这里统一转成 Uint8Array
  if (isH5) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
    return Taro.arrayBufferToBase64(bytes as unknown as ArrayBuffer)
  }
  return Taro.arrayBufferToBase64(buffer as ArrayBuffer)
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  return Taro.base64ToArrayBuffer(base64)
}
