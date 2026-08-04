/**
 * 平台判断工具
 * TARO_ENV 在编译期被替换为常量，未命中的平台分支会被构建工具 tree-shaking 掉
 */

/** 当前是否为 H5 环境 */
export const isH5 = process.env.TARO_ENV === 'h5'

/** 当前是否为小程序环境（非 H5） */
export const isMini = process.env.TARO_ENV !== 'h5'
