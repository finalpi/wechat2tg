import { GeWeChatDataSource } from '../data-sourse'
import {Like, Repository, SelectQueryBuilder} from 'typeorm'
import { WxContact } from '../entity/WxContact'
import {Page} from '../entity/Page'

export class WxContactRepository {
    private WxContactRepository: Repository<WxContact>
    private static instance: WxContactRepository

    private constructor() {
        // GeWeChatDataSource.initialize().then(() => {
            this.WxContactRepository = GeWeChatDataSource.getRepository(WxContact)
        // })
    }

    static getInstance(): WxContactRepository {
        if (!WxContactRepository.instance) {
            WxContactRepository.instance = new WxContactRepository()
        }
        return WxContactRepository.instance
    }

    async createOrUpdate(WxContact: WxContact): Promise<WxContact> {
        return this.WxContactRepository.save(WxContact)
    }

    async getByUserName(userName: string): Promise<WxContact | null> {
        return this.WxContactRepository.findOneBy({ userName })
    }

    async getByNickNameOrRemark(query: string) {
        return this.WxContactRepository.find({
            where: [
                { nickName: Like(`%${query}%`) },
                { remark: Like(`%${query}%`) }
            ]
        })
    }

    async getAll(): Promise<WxContact[]> {
        return this.WxContactRepository.find()
    }

    /**
     * 分页查询
     * @param name 昵称或备注名
     * @param page 分页信息
     */
    async pageByName(name: string, page: Page<WxContact>): Promise<Page<WxContact>> {
        return new Promise((resolve, reject) => {
            WxContactRepository.instance.WxContactRepository.createQueryBuilder()
                .where('alias like :name OR nickName like :name',
                    {name: `%${name}%`})
                .getCount()
                .then(count => {
                if (count > 0) {
                    this.WxContactRepository.createQueryBuilder()
                        .where('alias like :name OR nickName like :name',
                            {name: `%${name}%`})
                        .skip(page.pageSize * (page.pageNo - 1))
                        .take(page.pageSize)
                        .getMany()
                        .then(data => {
                            resolve({pageSize: page.pageSize, pageNo: page.pageNo, total: count, data})
                        })
                        .catch(err => {
                            reject(err)
                        })
                } else {
                    resolve({pageSize: 0, pageNo: 0, total: 0, data: []})
                }
            }).catch(err => {
                reject(err)
            })
        })
    }


}