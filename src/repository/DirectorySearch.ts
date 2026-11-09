import {Raw} from 'typeorm'

/** Keep user search text literal, including WeChat IDs containing '_' or '%'. */
export function directoryContains(query: string) {
    const pattern = '%' + query.replace(/[\\%_]/g, '\\$&') + '%'
    return Raw(column => `${column} LIKE :directoryQuery ESCAPE '\\'`, {directoryQuery: pattern})
}