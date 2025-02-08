// src/entity/Contact.ts
import { Entity, Column, PrimaryColumn } from 'typeorm'

@Entity('room')
export class WxRoom {
    @PrimaryColumn('text')
    chatroomId: string

    @Column('text')
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

    @Column('integer', {nullable: true})
    chatRoomNotify: number

    @Column('text', {nullable: true})
    chatRoomOwner: string

    @Column('text', {nullable: true})
    smallHeadImgUrl: string

    @Column('text', {nullable: true})
    memberList: string


}