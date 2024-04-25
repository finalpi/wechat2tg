import {ContactInterface, RoomInterface} from "wechaty/impls";

export class TalkerEntity {
    get type(): number {
        return this._type;
    }

    set type(value: number) {
        this._type = value;
    }

    get talker(): ContactInterface | RoomInterface | undefined {
        return this._talker;
    }

    set talker(value: ContactInterface | RoomInterface | undefined) {
        this._talker = value;
    }

    get id(): string {
        return this._id;
    }

    set id(value: string) {
        this._id = value;
    }

    get name(): string {
        return this._name;
    }

    set name(value: string) {
        this._name = value;
    }

    private _name = '';
    // 类型:0-群组,1-个人
    private _type = 0;
    private _id = '';
    private _talker: ContactInterface | RoomInterface | undefined = undefined;

    constructor(name: string, type: number, id: string, talker: ContactInterface | RoomInterface | undefined) {
        this._name = name;
        this._type = type;
        this._id = id;
        this._talker = talker;
    }
}

