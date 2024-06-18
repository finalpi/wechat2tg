import {Database} from 'sqlite3'
import {config} from '../config'

abstract class AbstractSqlService {
    protected db: Database = new Database(config.DB_SQLITE_PATH)

    protected createManualBindTable() {
        this.db.serialize(() => {
            this.db.get('SELECT * FROM sqlite_master WHERE type=\'table\' AND name=\'tb_bind_item\'', (err, row) => {
                if (!row) {
                    this.db.run('CREATE TABLE tb_bind_item (name TEXT, chat_id INT, type INT, bind_id TEXT, alias TEXT,wechat_id TEXT, avatar TEXT)')
                }else {
                    const createTableSQL = (row as { sql: string }).sql
                    if (!createTableSQL.includes('avatar')) {
                        this.db.run('ALTER TABLE tb_bind_item ADD COLUMN avatar TEXT', (err) => {
                            if (err) {
                                console.error('Failed to add column:', err)
                            } else {
                                console.log('Column avatar added successfully.')
                            }
                        })
                    }
                    if (!createTableSQL.includes('has_bound')) {
                        this.db.run('ALTER TABLE tb_bind_item ADD COLUMN has_bound TEXT', (err) => {
                            if (err) {
                                console.error('Failed to add column:', err)
                            } else {
                                console.log('Column avatar added successfully.')
                            }
                        })
                    }
                }
            })
        })
    }

    protected createMessageTable() {
        this.db.serialize(() => {
            this.db.get('SELECT * FROM sqlite_master WHERE type=\'table\' AND name=\'tb_message\'', (err, row) => {
                if (!row) {
                    this.db.run('CREATE TABLE tb_message (wechat_message_id TEXT, chat_id INT, telegram_message_id TEXT, type INT, msg_text TEXT,send_by TEXT, create_time TEXT)')
                }
            })
        })
    }

    protected createAutoBindTable() {
        this.db.serialize(() => {
            this.db.get('SELECT name FROM sqlite_master WHERE type=\'table\' AND name=\'dynamic_chat_mapping\'', (err, row) => {
                if (!row) {
                    this.db.run('create table main.dynamic_chat_mapping\n' +
                        '(\n' +
                        '    id              integer not null\n' +
                        '        constraint dynamic_chat_mapping_pk\n' +
                        '            primary key autoincrement,\n' +
                        '    wx_id           TEXT    not null,\n' +
                        '    wx_contact_type INTEGER not null,\n' +
                        '    wx_contact_hash TEXT    not null,\n' +
                        '    tg_chat_id      integer not null\n' +
                        ');\n' +
                        '\n')
                }
            })
        })
    }
}

export default AbstractSqlService