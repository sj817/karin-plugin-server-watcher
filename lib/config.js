import { dirPath } from '../index.js'
import {
  watch,
  basePath,
  filesByExt,
  copyConfigSync,
  requireFileSync,
} from 'node-karin'

let cache

/**
 * @description package.json
 */
export const pkg = () => requireFileSync(`${dirPath}/package.json`)

/** 用户配置的插件名称 */
const pluginName = pkg().name.replace(/\//g, '-')
/** 用户配置 */
const dirConfig = `${basePath}/${pluginName}/config`
/** 默认配置 */
const defConfig = `${dirPath}/config/config`

/**
 * @description 初始化配置文件
 */
copyConfigSync(defConfig, dirConfig, ['.yaml'])

/**
 *
 * @return {NezhaConfig}
 * @constructor
 */
export const Nezha = () => {
  if (cache) return cache
  const ext = 'nezha.yaml'
  const user = requireFileSync(`${dirConfig}/${ext}`)
  const def = requireFileSync(`${defConfig}/${ext}`)
  const result = { ...def, ...user }

  cache = result
  return result
}

/**
 * @description 监听配置文件
 */
setTimeout(() => {
  const list = filesByExt(dirConfig, '.yaml', 'abs')
  list.forEach(file => watch(file, (old, now) => {
    cache = undefined
  }))
}, 2000)

/**
 * @description Nezha配置
 * @typedef NezhaConfig
 * @property {string} token
 * @property {string} endpoint
 * @property {{
*    interval: number,
*    items: {
*      name: string,
*      threshold: number,
*      last_for: number,
*      enable: number
*    }[],
*    exception: {
*      [key: string]: {
*        name: string,
*        threshold: number,
*        last_for: number,
*        enable: number
*      }[]
*    }
*  }} check_rules
*  @property {Object.<number, {private?: number[], group?: number[]}>} send
*/
