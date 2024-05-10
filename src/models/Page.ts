export class Page<T> {
    private readonly total: number
    private page: number
    private readonly pageSize: number
    private list: T []


    constructor(list: T [], page = 1, pageSize = 5) {
        this.list = list
        this.page = page
        this.pageSize = pageSize
        this.total = list.length
    }

    public getList(page: number): T [] {
        // 更新当前页码
        this.page = page

        // 计算需要显示的数据的起始和结束索引
        const start = (this.page - 1) * this.pageSize
        const end = start + this.pageSize

        // 切片出当前页的数据
        return this.list.slice(start, Math.min(end, this.total)) // 确保不会超出数组的边界
    }

    public hasLast(): boolean {
        return this.page !== 1
    }

    public hasNext(): boolean {
        return this.page !== Math.ceil(this.total / this.pageSize)
    }
}