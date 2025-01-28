export type Page<T> ={
    pageSize: number,
    pageNo: number,
    total?: number,
    data?: T[]
}