import {FriendshipInterface} from 'wechaty/impls'

export class FriendshipItem {
    get id(): string {
        return this._id
    }

    set id(value: string) {
        this._id = value
    }

    get friendship(): FriendshipInterface {
        return this._friendship
    }

    set friendship(value: FriendshipInterface) {
        this._friendship = value
    }

    private _id: string
    private _friendship: FriendshipInterface


    constructor(id: string, friendship: FriendshipInterface) {
        this._id = id
        this._friendship = friendship
    }
}