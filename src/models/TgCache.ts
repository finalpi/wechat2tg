export class SelectedEntity {
    get showName(): string {
        return this._showName;
    }

    set showName(value: string) {
        this._showName = value;
    }

    get type(): string {
        return this._type;
    }

    set type(value: string) {
        this._type = value;
    }

    get id(): string {
        return this._id;
    }

    set id(value: string) {
        this._id = value;
    }

    private _id: string = '';
    private _type: string = '';
    private _showName: string = '';
}

export type MemberCacheType = {
    id: string;
    show_name: string;
    shot_id: string;
}

