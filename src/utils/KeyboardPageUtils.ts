import * as tg from "telegraf/src/core/types/typegram";
import {Markup} from "telegraf";

export class KeyboardPageUtils {

    public static async nextKeyboardPage<T>(source: T[], page: number, size: number, lineSize: number,
                                            keyboardType: (arg: T) => {
                                                text: string,
                                                data: string,
                                                hide?: boolean | undefined
                                            },
                                            nextButtonType: (arg: {
                                                page: number
                                            }) => string): Promise<tg.KeyboardButton[][]> {

        const buttons: tg.KeyboardButton[][] = [];
        const currentIndex = size * page;
        const nextIndex = size * (page + 1);
        const slice = source.slice(currentIndex, nextIndex);

        for (let i = 0; i < slice.length; i += lineSize) {
            const row = [];
            for (let j = i; j < i + lineSize && j < slice.length; j++) {
                const arg = slice[j];
                const keyboard = keyboardType(arg);
                row.push(Markup.button.callback(keyboard.text, keyboard.data, keyboard.hide))
            }
            buttons.push(row);
        }

        const nextButton = Markup.button.callback('下一页', nextButtonType({page: page + 1}));
        const prevButton = Markup.button.callback('上一页', nextButtonType({page: page - 1}));

        if (page === 0 && buttons.length !== 0) {
            buttons.push([nextButton]);
        } else if (nextIndex < source.length) {
            buttons.push([prevButton, nextButton]);
        } else {
            buttons.push([prevButton]);
        }

        return buttons;
    }
}
