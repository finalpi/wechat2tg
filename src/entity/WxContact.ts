// src/entity/Contact.ts
import { Entity, Column, PrimaryColumn } from 'typeorm'

@Entity('contact')
export class WxContact {
    @PrimaryColumn('text')
    userName: string

    @Column('text',{nullable: true})
    nickName: string

    @Column('text', {nullable: true})
    pyInitial: string

    @Column('text', {nullable: true})
    quanPin: string

    @Column('integer', {nullable: true})
    sex: number

    @Column('text', {nullable: true})
    remark: string

    @Column('text', {nullable: true})
    remarkPyInitial: string

    @Column('text', {nullable: true})
    remarkQuanPin: string

    @Column('text', {nullable: true})
    signature: string

    @Column('text', {nullable: true})
    alias: string

    @Column('text', {nullable: true})
    snsBgImg: string

    @Column('text', {nullable: true})
    country: string

    @Column('text', {nullable: true})
    bigHeadImgUrl: string

    @Column('text', {nullable: true})
    smallHeadImgUrl: string

    @Column('text', {nullable: true})
    description: string

    @Column('text', {nullable: true})
    cardImgUrl: string

    @Column('text', {nullable: true})
    labelList: string

    @Column('text', {nullable: true})
    province: string

    @Column('text', {nullable: true})
    city: string

    @Column('text', {nullable: true})
    phoneNumList: string
}