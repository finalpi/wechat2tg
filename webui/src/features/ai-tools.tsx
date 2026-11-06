import {useState} from 'react'
import {Button} from '@/components/ui/button'
import {Badge} from '@/components/ui/badge'
import {Alert, AlertDescription} from '@/components/ui/alert'
import {Spinner} from '@/components/ui/spinner'
import {api} from '@/lib/api'

const ERRORS: Record<string, string> = {
  aiBusy: '已有请求在进行中。',
  aiInvalidURL: '请输入有效的 HTTP/HTTPS API 地址。',
  aiKeyForNewProvider: '切换到其他服务时请明确填写密钥。',
  aiInvalidModels: '服务返回的模型列表格式无效。',
  aiModelRequired: '请先填写或选择模型。',
  aiUnauthorized: '服务拒绝了密钥或权限。',
  aiEndpointMissing: '服务接口未找到，请检查地址。',
  aiRateLimited: '服务触发了限流。',
  aiRequestRejected: '服务拒绝了请求格式。',
  aiConnectionFailed: '无法连接服务。',
}

export function AITools({token, url, model, onModel}: {
  token: string
  url: string
  model: string
  onModel: (model: string) => void
}) {
  const [models, setModels] = useState<string[]>([])
  const [busy, setBusy] = useState<'' | 'models' | 'test'>('')
  const [result, setResult] = useState('')
  const [error, setError] = useState('')

  const readModels = async () => {
    setBusy('models')
    setError('')
    setResult('')
    try {
      const data = await api.aiModels(token, {url})
      setModels(data.models)
      setResult(`已读取 ${data.models.length} 个模型。`)
    } catch (e) {
      const code = (e as {code?: string}).code
      setError(ERRORS[code || ''] || '请求失败。')
    } finally {
      setBusy('')
    }
  }

  const test = async () => {
    setBusy('test')
    setError('')
    setResult('')
    try {
      const data = await api.aiTest(token, {url, model})
      setResult(data.ok ? (data.emptyReply ? '已连接，但模型未返回文本。' : `测试成功。`) : '测试未通过。')
    } catch (e) {
      const code = (e as {code?: string}).code
      setError(ERRORS[code || ''] || '请求失败。')
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">连接测试</span>
        <Button variant="outline" size="sm" onClick={readModels} disabled={busy !== ''}>
          {busy === 'models' && <Spinner />} 读取模型列表
        </Button>
        <Button variant="outline" size="sm" onClick={test} disabled={busy !== ''}>
          {busy === 'test' && <Spinner />} 测试当前模型
        </Button>
      </div>

      {models.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">模型列表（点击填入名称）：</span>
          <div className="flex flex-wrap gap-1">
            {models.slice(0, 50).map(name => (
              <Badge key={name} variant="secondary" className="cursor-pointer" onClick={() => onModel(name)}>
                {name}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {result && <p className="text-sm text-muted-foreground">{result}</p>}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    </div>
  )
}
