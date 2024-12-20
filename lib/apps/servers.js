import { Nezha } from '../config.js'
import { NezhaClient } from '../../models/nezha.js'
import { karin, segment, common, logger } from 'node-karin'
import { check, TYPE_MAP, TYPES } from '../../task/check.js'

export const servers = karin.command(/^#(servers|服务器)/, async (e) => {
  const msg = e.msg
  const tag = msg.replace(/^#(servers|服务器)/, '')
  try {
    const client = new NezhaClient(Nezha())
    const servers = await client.listServers(tag)
    if (servers.length === 0) {
      if (tag) {
        e.reply('当前无服务器，请检查该tag是否存在', { reply: true })
      } else {
        e.reply('当前无服务器', { reply: true })
      }
      return true
    }

    const msg = segment.text('服务器列表：\n')
    const serverMsgs = servers
      .sort((a, b) => a.id - b.id)
      .map(server => {
        return `服务器id：${server.id}\n服务器名称：${server.name}\n服务器分类：${server.tag}\n上次活跃时间：${server.last_active}\n`
      }).map(msg => segment.text(msg))
    const nodes = common.makeForward([msg, ...serverMsgs])
    await e.bot.sendForwardMsg(e.contact, nodes)
    return true
  } catch (err) {
    logger.error(err)
    e.reply(err.message)
  }
}, { name: '查看集群状态', perm: 'admin' })

export const checkServers = karin.task('检查服务器状态推送', '*/5 * * * *', async () => {
  const summaries = await check()
  logger.debug(summaries)
  let toSend = '服务器监测汇报\n'
  let no = true
  summaries.forEach(sum => {
    TYPES.forEach(type => {
      /**
       * @type {{server: ServerDetail, last: number, currentValue: number, type: 'alert' | 'unalert'}}
       */
      const record = sum[type]
      if (record) {
        if (record.type === 'alert') {
          toSend += `服务器${record.server.name}(${record.server.id}) ${TYPE_MAP[type]}超过阈值，当前值${record.currentValue}，已持续${record.last}秒\n`
        } else {
          toSend += `服务器${record.server.name}(${record.server.id}) ${TYPE_MAP[type]}恢复正常，当前值${record.currentValue}\n`
        }
        no = false
      }
    })
  })
  if (!no) {
    const send = Nezha().send
    for (const botId of Object.keys(send)) {
      const bot = karin.getBot(botId)
      if (!bot) {
        logger.error(`找不到bot ${botId}`)
        continue
      }

      send[botId].private?.forEach(id => {
        const contact = karin.contactFriend(id)
        karin.sendMsg(botId, contact, toSend)
      })
      send[botId].group?.forEach(groupId => {
        const contact = karin.contactGroup(groupId)
        karin.sendMsg(botId, contact, toSend)
      })
    }
  }
})
