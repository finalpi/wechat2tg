export class FormatUtils{
    public static NAME_REGEXP = new RegExp(/#\[(.*?)\]/, 'g')

    // eslint-disable-next-line @typescript-eslint/no-empty-function
    private constructor() {

    }

    static transformTitleStr(inputString: string, alias: string, name: string, topic: string): string {
        const alias_first = alias || name
        inputString = inputString.replace(this.NAME_REGEXP, (match, p1) => {
            if (p1.includes('alias_first')) {
                return alias_first ? p1.replaceAll('alias_first', alias_first) : ''
            } else if (p1.includes('alias')) {
                return alias ? p1.replaceAll('alias', alias) : ''
            } else if (p1.includes('name')) {
                return name ? p1.replaceAll('name', name) : ''
            } else if (p1.includes('topic')) {
                return topic ? p1.replaceAll('topic', topic) : ''
            } else {
                return match
            }
        })

        return inputString
    }

    static transformIdentityBodyStr(inputString: string, identity: string, body: string): string {
        inputString = inputString.replace(this.NAME_REGEXP, (match, p1) => {
            if (p1.includes('identity')) {
                return identity ? p1.replaceAll('identity', identity) : ''
            } else if (p1.includes('body')) {
                return body ? p1.replaceAll('body', body) : ''
            } else if (p1.includes('br')) {
                return p1.replaceAll('br', '\n')
            } else {
                return match
            }
        })

        return inputString
    }

}