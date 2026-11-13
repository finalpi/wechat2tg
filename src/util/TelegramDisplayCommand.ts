import {TelegramDisplayPolicy,isDisplayMode} from './TelegramDisplayPolicy'

interface DisplayContext {
    from?:{id:number;is_bot?:boolean;is_premium?:boolean}
    chat?:{id:number;type?:string}
    payload?:string
    reply(text:string):Promise<unknown>
}

/** Always plain text: changing compatibility must itself work on older clients. */
export async function handleTelegramDisplayCommand(ctx:DisplayContext,ownerId:number,botId:number,policy:TelegramDisplayPolicy,english = false):Promise<void> {
    if(!ownerId || ctx.from?.id !== ownerId || ctx.from.is_bot || !ctx.chat){
        await ctx.reply(english ? 'Only the configured bot owner can change display settings.' : '仅机器人主人可以查看和修改展示设置。')
        return
    }
    policy.configure(botId,ownerId);policy.observeOwner(ctx.from)
    const args = (ctx.payload || '').trim().split(/\s+/).filter(Boolean)
    const global = args[0] === 'global'
    const mode = args[global ? 1 : 0]
    const usage = '/display auto | compatible | enhanced | inherit\n/display global auto | compatible | enhanced | inherit'
    if(args.length){
        if(args.length !== (global ? 2 : 1) || (mode !== 'inherit' && !isDisplayMode(mode))){await ctx.reply(usage);return}
        try {policy.setMode(mode as 'auto'|'compatible'|'enhanced'|'inherit',global ? undefined : ctx.chat.id)}
        catch {await ctx.reply(english ? 'Could not save display settings. Previous settings remain active.' : '展示设置保存失败，仍使用原设置。');return}
    }
    const premium = policy.ownerPremium()
    const status = premium === undefined ? (english ? 'unknown' : '未知') : premium ? 'Premium' : (english ? 'non-Premium' : '非会员')
    const rich = policy.allows('richMessage',ctx.chat.id)
    const emoji = policy.emoji.snapshot(ctx.chat.id).state
    await ctx.reply(english
        ? `Display mode: ${policy.mode(ctx.chat.id)}\nConfigured owner: ${status}\nCustom emoji capability: ${emoji}\nRich layout: ${rich ? 'enabled' : 'compatible'}\nAuto detects custom emoji from delivery results; other rich layouts use recent owner membership evidence. Client versions cannot be detected.\n${usage}`
        : `当前会话展示：${policy.mode(ctx.chat.id)}\n已绑定主人：${status}\n原生表情能力：${({supported:'已确认支持',unsupported:'当前不支持',unknown:'尚未确认'})[emoji]}\n富媒体布局：${rich ? '增强' : '兼容'}\n自动模式按发送结果识别表情能力，其他富媒体参考主人会员状态。手动关闭与 compatible 优先。无法识别接收端版本。\n${usage}`)
}
