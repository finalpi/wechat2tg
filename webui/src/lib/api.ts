export type FieldType = 'text' | 'password' | 'number' | 'select' | 'boolean' | 'textarea'
export type FieldSource = 'environment' | 'runtime'

export interface Field {
  key: string
  label: string
  description: string
  group: string
  type: FieldType
  source: FieldSource
  options?: string[]
  min?: number
  max?: number
  required?: boolean
}

export interface Group {
  id: string
  label: string
  caption: string
  icon: string
}

export interface ConfigSnapshot {
  revision: string
  values: Record<string, unknown>
  secrets: Record<string, boolean>
  restartRequired: boolean
  runtimeAvailable: boolean
  startedAt: string
  templateDefaults?: Record<string, string>
  fields: Field[]
  groups: Group[]
}

export class ApiError extends Error {
  code: string
  status: number
  constructor(message: string, code = 'serverError', status = 500) {
    super(message)
    this.code = code
    this.status = status
  }
}

export async function request<T>(path: string, token: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {}),
      },
    })
  } catch {
    throw new ApiError('无法连接服务，请检查网络。', 'networkError')
  }
  if (response.status === 401) throw new ApiError('访问令牌不正确，请重试。', 'unauthorized', 401)
  let body: any = {}
  try { body = await response.json() } catch { /* ignore */ }
  if (!response.ok) throw new ApiError(body?.error || 'serverError', body?.error || 'serverError', response.status)
  return body as T
}

export const api = {
  getConfig: (token: string) => request<ConfigSnapshot>('/api/config', token),
  patchConfig: (token: string, source: FieldSource, revision: string, values: Record<string, unknown>) =>
    request<ConfigSnapshot>('/api/config', token, {method: 'PATCH', body: JSON.stringify({source, revision, values})}),
  mcpSettings: (token: string) => request<McpMetadata>('/api/mcp/settings', token),
  mcpUpdate: (token: string, body: Record<string, unknown>) =>
    request<McpMetadata>('/api/mcp/settings', token, {method: 'PATCH', body: JSON.stringify(body)}),
  mcpToken: (token: string, body: Record<string, unknown>) =>
    request<McpTokenResult>('/api/mcp/token', token, {method: 'POST', body: JSON.stringify(body)}),
  aiModels: (token: string, body: Record<string, unknown>) =>
    request<AiModelsResult>('/api/ai/models', token, {method: 'POST', body: JSON.stringify(body)}),
  aiTest: (token: string, body: Record<string, unknown>) =>
    request<AiTestResult>('/api/ai/test', token, {method: 'POST', body: JSON.stringify(body)}),
}

export interface McpMetadata {
  enabled: boolean
  endpoint: string
  scriptPath: string
  revision: string
  writeConfigured: boolean
  readConfigured: boolean
  available: boolean
}

export interface McpTokenResult extends McpMetadata {
  role: 'read' | 'write'
  token: string
}

export interface AiModelsResult {
  models: string[]
  elapsedMs: number
}

export interface AiTestResult {
  ok: boolean
  model: string
  elapsedMs: number
  reply: string
  emptyReply: boolean
}
