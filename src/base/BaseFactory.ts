// src/base/BaseFactory.ts

import {IClient} from './BaseClient'

export interface BaseFactory {
    create(type: botType): IClient;
}

export type botType = 'botClient' | 'userMTPClient' | 'wxClient' | 'botMTPClient' | 'fhClient'