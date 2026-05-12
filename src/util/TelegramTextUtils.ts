export function normalizeEscapedTelegramCommandText(text: string): string {
    return text.startsWith('\\/') ? text.replace(/^\\\//, '/') : text
}
