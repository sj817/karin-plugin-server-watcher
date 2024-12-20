import { NezhaClient } from '../models/nezha.js'
import { Nezha } from '../lib/config.js'
import { dirPath } from '../index.js'
import fs from 'fs'
import { redis } from 'node-karin'

/**
 * @typedef {'cpu' | 'memory' | 'disk' | 'upload_speed' | 'download_speed'} CheckItem
 */

/**
 * startTime是毫秒时间戳
 * @typedef {{id: number, alerts?: Array<{type: CheckItem, startTime: number, hit?: boolean}>}} AlertRecord
 */

/**
 * @typedef {Object.<CheckItem, {server: ServerDetail, last: number, currentValue: number, type: 'alert' | 'unalert'}>} AlertSummary
 */

/**
 * type列表
 * @type {CheckItem[]}
 */
export const TYPES = ['cpu', 'memory', 'disk', 'upload_speed', 'download_speed']

/**
 * 中文名map
 * @type {Object.<CheckItem, String>}
 */
export const TYPE_MAP = {
  cpu: 'CPU',
  memory: '内存',
  disk: '磁盘',
  upload_speed: '上传速度',
  download_speed: '下载速度',
}

/**
 * 检查，记录，返回需要预警的信息
 * @param props
 * @return {Promise<AlertSummary[]>}
 */
export async function check (props = Nezha()) {
  const client = new NezhaClient(props)
  const servers = await client.listServers()
  const idArr = servers.map(server => server.id)
  const ids = idArr.join(',')
  const serverDetails = await client.getServerDetails(ids)
  /**
   * 结果
   * @type {AlertSummary[]}
   */
  const results = []
  /**
   * 本次拿到的map
   * @type {Map<number, ServerDetail>}
   */
  const map = new Map()
  serverDetails.forEach(serverDetail => {
    serverDetail.calculated = {
      disk_rate: serverDetail.status.DiskUsed / serverDetail.host.DiskTotal,
      memory_rate: serverDetail.status.MemUsed / serverDetail.host.MemTotal,
    }
    map.set(serverDetail.id, serverDetail)
  })

  // 比较。只比较：CPU占用高于阈值、内存占用高于阈值、磁盘占用高于阈值、上传下载速度高于阈值
  const cfg = Nezha()
  const rules = cfg.check_rules
  const items = rules.items

  // 遍历本次拿到的每一个服务器
  for (const id of idArr) {
    /**
     * result
     * @type {AlertSummary}
     */
    const result = {}
    // 获取该服务器之前的状态
    const redisKey = `nezha:status:${id}`
    const recordBeforeValue = await redis.get(redisKey)
    /**
     * 之前的状态
     * @type {AlertRecord}
     */
    let recordBefore = { id }
    if (recordBeforeValue) {
      try {
        recordBefore = JSON.parse(recordBeforeValue)
      } catch (e) { }
    }
    let rule = rules.exception[id]
    rule = overrideRules(items, rule)

    const cpuRule = rule.find(r => r.name === 'cpu')
    const memRule = rule.find(r => r.name === 'memory')
    const diskRule = rule.find(r => r.name === 'disk')
    const uploadRule = rule.find(r => r.name === 'upload_speed')
    const downloadRule = rule.find(r => r.name === 'download_speed')

    /**
     * 本次要记录的record
     * @type {AlertRecord}
     */
    const newRecord = { id, alerts: [] }
    const server = map.get(id)

    /**
     * 处理本次高了的指标
     * @param value 值
     * @param {CheckItem} type
     * @param {number} threshold 预警持续时间阈值 秒
     */
    function handleNewValue (value, type, threshold) {
      if (value > threshold) {
        let eventStartTime
        if (recordBefore.alerts?.find(alert => alert.type === type)) {
          eventStartTime = recordBefore.alerts.find(alert => alert.type === type).startTime
        } else {
          eventStartTime = new Date().getTime() / 1000
        }
        // 如果newRecord的startTime到此刻超出了阈值
        const lastFor = new Date().getTime() / 1000 - eventStartTime
        if (lastFor > threshold) {
          result[type] = {
            last: lastFor,
            currentValue: value,
            type: 'alert',
            server,
          }
          newRecord.alerts.push({ type, startTime: eventStartTime, hit: true })
        } else {
          // 虽然高了但是没到阈值时间，只记录不推送
          newRecord.alerts.push({ type, startTime: eventStartTime, hit: false })
        }
      } else {
        // 低于阈值，不记录
        // 但是如果之前是hit = true状态需要推送unalert事件解除警告
        const before = recordBefore.alerts?.find(alert => alert.type === type)
        if (before && before.hit) {
          result[type] = {
            last: 0,
            currentValue: value,
            type: 'unalert',
            server,
          }
        }
      }
    }

    handleNewValue(server.status.CPU, 'cpu', cpuRule.threshold)
    handleNewValue(server.calculated.memory_rate, 'memory', memRule.threshold)
    handleNewValue(server.calculated.disk_rate, 'disk', diskRule.threshold)
    handleNewValue(server.status.NetOutSpeed / 1024 / 1024, 'upload_speed', uploadRule.threshold)
    handleNewValue(server.status.NetInSpeed / 1024 / 1024, 'download_speed', downloadRule.threshold)

    if (newRecord.alerts.length === 0) {
      await redis.del(redisKey)
    } else {
      await redis.set(redisKey, JSON.stringify(newRecord), { EX: 3600 })
    }
    if (Object.keys(result).length > 0) {
      results.push(result)
    }
  }

  // 最后存入留档
  const path = `${dirPath}/data/servers_${new Date().getTime()}.json`
  fs.writeFileSync(path, JSON.stringify(serverDetails, null, 2))

  return results
}

/**
 *
 * @param {Array<{name: string, threshold: number, last_for: number, enable: number}>} defaultRule
 * @param {Array<{name: string, threshold: number?, last_for: number?, enable: number?}>?} override
 */
function overrideRules (defaultRule, override = []) {
  const map = new Map()
  defaultRule.forEach(rule => {
    map.set(rule.name, rule)
  })
  override.forEach(rule => {
    const name = rule.name
    if (map.has(name)) {
      const defaultRule = map.get(name)
      map.set(name, {
        ...defaultRule,
        ...rule,
      })
    } else {
      map.set(name, rule)
    }
  })
  return Array.from(map.values())
}
