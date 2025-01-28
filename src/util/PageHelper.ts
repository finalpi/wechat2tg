import {Telegraf, Context} from 'telegraf'
import {Markup} from 'telegraf'
import {Page} from '../entity/Page'
import {WxContact} from '../entity/WxContact'
import {WxContactRepository} from '../repository/WxContactRepository'

/**
 * 定义分页结果类型 (示例)
 */
interface PagedResult<T> {
    data: T[]
    total: number     // 符合条件的总条数，用于判断是否还有下一页
}

/**
 * 定义分页所需的两个核心函数：
 *  - fetchData: 负责根据 pageNo/pageSize 拿数据并返回 {data, total}
 *  - renderItem: 负责把单条数据渲染成字符串
 */
interface PaginationHandler<T> {
    fetchData: (pageNo: number, pageSize: number, queryParams: object) => Promise<PagedResult<T>>
    renderItem: (item: T, index: number, pageNo: number, pageSize: number) => string
}

/**
 * 全局的分页管理器 (Map)，key 为字符串(比如 'USER', 'ORDER' 等)
 * value 就是 fetchData/renderItem 的实现
 */
const paginationMap: Record<string, PaginationHandler<any>> = {}

/**
 * 注册分页（在初始化时调用）
 *  - queryKey: 唯一标识，如 'USER'
 *  - fetchData: 获取分页数据
 *  - renderItem: 渲染单条数据
 */
function registerPagination<T>(
    queryKey: string,
    fetchData: (pageNo: number, pageSize: number, queryParams: object) => Promise<PagedResult<T>>,
    renderItem: (item: T, index: number, pageNo: number, pageSize: number) => string,
) {
    paginationMap[queryKey] = {
        fetchData,
        renderItem,
    }
}

/**
 * 通用的分页发送函数
 *  - ctx: Telegraf 上下文
 *  - queryKey: 唯一标识(对应注册过的分页类型)
 *  - pageNo/pageSize: 当前要展示的页码和每页数量
 *  - extraMessage: 可选，额外要显示在前面的内容(如搜索词)
 */
async function sendPagedList<T>(
    ctx: Context,
    queryKey: string,
    pageNo: number,
    pageSize: number,
    extraMessage = {
        keyword: '',
    }
) {
    const handler = paginationMap[queryKey]
    if (!handler) {
        await ctx.reply(`没有找到 queryKey = ${queryKey} 的分页配置！`)
        return
    }

    // 1. 调用 fetchData 获取对应页的数据
    const {fetchData, renderItem} = handler
    const page = await fetchData(pageNo, pageSize, extraMessage)

    // 2. 组装要发送的文本
    let text = extraMessage ? `${extraMessage.keyword}\n` : ''
    text += `当前页: ${pageNo}, 每页: ${pageSize}, 总数: ${page.total}\n`
    text += '------------------------\n'

    page.data.forEach((item, idx) => {
        text += renderItem(item, idx, pageNo, pageSize)
    })

    // 3. 生成翻页按钮
    const buttons = []
    // 上一页按钮
    if (pageNo > 1) {
        buttons.push(
            Markup.button.callback(
                '上一页',
                `paging:${queryKey}:${pageNo - 1}:${pageSize}`
            )
        )
    }
    // 下一页按钮
    if (pageNo * pageSize < page.total) {
        buttons.push(
            Markup.button.callback(
                '下一页',
                `paging:${queryKey}:${pageNo + 1}:${pageSize}`
            )
        )
    }

    // 4. 发送
    await ctx.reply(text, {
        ...Markup.inlineKeyboard([buttons]),
    })
}

/**
 * 初始化 bot，并注册通用的分页回调
 */
export function initBot(bot: Telegraf) {
    // 1) 注册一个通用的翻页 action，拦截所有 paging:xxx 的回调
    //    格式:  paging:<queryKey>:<pageNo>:<pageSize>
    bot.action(/^paging:(.*):(.*):(.*)$/, async (ctx) => {
        try {
            const queryKey = ctx.match[1] as string
            const pageNoStr = ctx.match[2] as string
            const pageSizeStr = ctx.match[3] as string
            const pageNo = parseInt(pageNoStr, 10)
            const pageSize = parseInt(pageSizeStr, 10)

            // 这里再次调用通用的发送函数
            await sendPagedList(ctx, queryKey, pageNo, pageSize)

            // 为了避免按钮点击后一直 loading
            await ctx.answerCbQuery()
        } catch (err) {
            console.error(err)
            await ctx.answerCbQuery('分页回调出错~')
        }
    })
}

/**
 * 下面是一个示例：对 "USER" 数据类型进行分页
 * (仅演示, 可在其他地方写成真实的 Repository 调用)
 */

// 假设这是一个模拟的数据库查询
async function fetchUserPage(pageNo: number, pageSize: number): Promise<PagedResult<{
    userName: string;
    nickName: string
}>> {
    // 模拟总数据
    const allUsers = [
        {userName: 'Alice', nickName: 'AA'},
        {userName: 'Bob', nickName: 'BB'},
        // ... 假装有很多
    ]
    const total = allUsers.length
    const start = (pageNo - 1) * pageSize
    const end = start + pageSize
    const data = allUsers.slice(start, end)

    return {
        data,
        total,
    }
}

async function userPage(pageNo: number, pageSize: number, queryParams: {keyword: string}): Promise<PagedResult<{
    userName: string;
    nickName: string
}>> {
    return new Promise((resolve, reject) => {
        WxContactRepository.getInstance().pageByName(queryParams.keyword, {
            pageNo: pageNo,
            pageSize: pageSize
        }).then(pages => {
            return resolve({
                data: pages.data.map(p => {
                    return {
                        userName: p.userName,
                        nickName: p.nickName
                    }
                }),
                total: pages.total
            })
        })
    })
}

// 渲染单条数据
function renderUserItem(
    user: { userName: string; nickName: string },
    index: number,
    pageNo: number,
    pageSize: number
) {
    const realIndex = (pageNo - 1) * pageSize + (index + 1)
    return `[${realIndex}] userName: ${user.userName}, nickName: ${user.nickName}\n`
}

// 注册 USER 这个分类的分页
registerPagination('USER', userPage, renderUserItem)

/**
 * 在你的命令处理时，只需简单调用一下 sendPagedList 即可
 * 比如 /user 命令
 */
export function setupUserCommand(bot: Telegraf) {
    bot.command('user', async (ctx) => {
        // 通常你会解析 ctx.message.text 来获取搜索词，这里只演示
        const pageNo = 1
        const pageSize = 10
        const keyword = ctx.args[0] ? ctx.args[0] : ''
        await sendPagedList(ctx, 'USER', pageNo, pageSize, {keyword: keyword})
    })
}