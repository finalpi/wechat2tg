export class Settings<T> {
    // 描述
    description: string
    // 值
    value: T
    // 选项
    options: Map<T, string>
}