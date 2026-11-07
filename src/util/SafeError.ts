/** Operational diagnostics without raw exception messages, request data or SQL parameters. */
export function safeErrorDetails(error: unknown) {
    const value = error && typeof error === 'object' ? error as Record<string, unknown> : {}
    const allowedNames = new Set(['Error', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError',
        'QueryFailedError', 'EntityMetadataNotFoundError', 'ConnectionIsNotSetError',
        'ConnectionNotFoundError', 'CannotExecuteNotConnectedError', 'FetchError', 'AbortError'])
    const name = typeof value.name === 'string' && allowedNames.has(value.name) ? value.name : 'Error'
    const code = typeof value.code === 'string' && /^(SQLITE_[A-Z_]+|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ENETUNREACH|EHOSTUNREACH|ENOENT|EACCES|EPERM)$/.test(value.code) ? value.code : undefined
    // Messages can embed credentials, SQL, or user content; classify only known failures.
    const message = typeof value.message === 'string' ? value.message : ''
    const constraint = message.length < 512 ? message.match(/^SQLITE_CONSTRAINT: UNIQUE constraint failed: ([A-Za-z_][A-Za-z0-9_.]*(?:, [A-Za-z_][A-Za-z0-9_.]*)*)$/)?.[1] : undefined
    const reason = constraint ? `unique constraint: ${constraint}` : /no such column/i.test(message) ? 'missing database column'
        : /no such table/i.test(message) ? 'missing database table'
        : /database is locked/i.test(message) ? 'database locked'
        : /database.*(?:not established|not initialized)/i.test(message) ? 'database not initialized'
        : /Cannot read properties of (?:undefined|null)/.test(message) ? 'missing object'
        : undefined
    // Keep source locations, not the exception's first line, absolute paths or URLs.
    const locations = typeof value.stack === 'string' ? value.stack.split('\n').slice(1)
        .filter(line => /^\s+at /.test(line))
        .map(line => line.match(/[/\\]([A-Za-z0-9_-]+\.[cm]?[jt]s:\d+:\d+)\)?$/)?.[1])
        .filter(Boolean).slice(0, 8) : []
    return {name, code, reason, locations}
}