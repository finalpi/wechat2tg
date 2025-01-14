// src/base/BaseFactory.ts

import {IClient} from './BaseClient'

export interface BaseFactory {
    create(type: 'singleton' | 'multiple'): IClient;
    destroy(): Promise<boolean>;
}