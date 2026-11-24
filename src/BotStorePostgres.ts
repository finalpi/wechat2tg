import {Pool,PoolClient,types} from 'pg'
import {botPostgresDsn} from './DatabaseOptions'
import {botStores,BotStoreKind} from './BotStoreSchema'

const keys = ('requestId wxId remoteId senderId senderName attachmentId telegramStatus telegramTracked bodyFormat revokeStatus revokeRequestId revokedAt revokeTelegramStatus cacheKey chatId threadId updatedAt nextAt transferId transactionId invalidTime').split(' ')
const mapped = new Map(keys.map(key=>[key.toLowerCase(),key]))

function safeInt(value:string) {
    const result = Number(value)
    if(!Number.isSafeInteger(result))throw new Error('Unsafe PostgreSQL store integer')
    return result
}
const parsers = {getTypeParser:(id:number,format:'text'|'binary' = 'text')=>id === 20 && format === 'text' ? safeInt : types.getTypeParser(id,format)}

// Internal statements only. Never rewrite the contents of SQL string literals
// or interpolate user values. SQLite and PostgreSQL both use the same bind order.
export function pgStoreSql(sql:string) {
    let count = 0
    return sql.replace(/'(?:''|[^'])*'|"(?:""|[^"])*"|\?/g,token=>token === '?' ? `$${++count}` : token)
}

export class BotStorePostgres {
    private pool:Pool
    constructor(dsn:string,kind:BotStoreKind) {
        this.pool = new Pool({connectionString:dsn,options:'-c search_path=public',connectionTimeoutMillis:5000,max:2,allowExitOnIdle:true,
            application_name:`wechat2tg-${kind}`,types:parsers})
        this.pool.on('error',()=>console.warn('[Bot storage] Idle PostgreSQL connection failed'))
    }
    static configured(kind:BotStoreKind,file?:string):BotStorePostgres|undefined {
        const dsn = file === undefined ? botPostgresDsn() : undefined
        return dsn ? new BotStorePostgres(dsn,kind) : undefined
    }
    async initialize(kind:BotStoreKind,maintenance:string) {
        // Runtime tables are created at startup, or inside the offline migration.
        await this.pool.query(botStores[kind].ddl)
        if(maintenance)await this.pool.query(maintenance)
    }
    async exec(sql:string,values:unknown[] = [],client?:PoolClient) {
        return (client ?? this.pool).query(pgStoreSql(sql),values)
    }
    async rows<T>(sql:string,values:unknown[] = [],client?:PoolClient):Promise<T[]> {
        const result = await this.exec(sql,values,client)
        return result.rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[mapped.get(key) ?? key,value]))) as T[]
    }
    async changes(sql:string,values:unknown[] = []):Promise<number> {
        return (await this.exec(sql,values)).rowCount ?? 0
    }
    async transact<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T> {
        const client = await this.pool.connect()
        try {
            await client.query('BEGIN')
            const result = await fn(client)
            await client.query('COMMIT')
            return result
        } catch(error) {
            await client.query('ROLLBACK').catch(()=>undefined)
            throw error
        } finally {client.release()}
    }
    async close() {await this.pool.end()}
}