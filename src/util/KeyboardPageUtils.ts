// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import * as tg from 'telegraf/src/core/types/typegram'
import {Markup} from 'telegraf'
import {InlineKeyboardButton} from '@telegraf/types/markup'
import I18n from '../i18n'

export class KeyboardPageUtils {
    private i18n = I18n.getInstance()
    
    constructor(
        public data: dataType[],
        public page: number,
        public actionMark: string,
        public pageSize: number = 10,
    ) {}

    getMarkup() {
        const buttons: InlineKeyboardButton[][] = []

        // 计算分页范围
        const startIndex = (this.page - 1) * this.pageSize
        const endIndex = startIndex + this.pageSize
        const pageData = this.data.slice(startIndex, endIndex)  // 只获取当前页的数据

        for (let i = 0; i < pageData.length; i += 2) {
            const buttonRow = [
                Markup.button.callback(`🌐${pageData[i].remark}`, `${this.actionMark}:${pageData[i].action}`)
            ]
            if (i + 1 < pageData.length) {
                buttonRow.push(Markup.button.callback(`🌐${pageData[i + 1].remark}`, `${this.actionMark}:${pageData[i + 1].action}`))
            }
            buttons.push(buttonRow)
        }

        const option = []
        if (this.page > 1) {
            option.push(Markup.button.callback(this.i18n.t('pagination.previous'), `${this.actionMark}:page-${this.page - 1}`))
        }
        if (this.hasNext()) {
            option.push(Markup.button.callback(this.i18n.t('pagination.next'), `${this.actionMark}:page-${this.page + 1}`))
        }
        if (option.length > 0) {
            buttons.push(option)
        }

        return { inline_keyboard: buttons }
    }

    private hasNext(): boolean {
        return this.page < Math.ceil(this.data.length / this.pageSize)
    }
}

export type dataType = {
    remark: string,
    action: string
}