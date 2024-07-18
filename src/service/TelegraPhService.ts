interface TelegraPhService {
    createAccount: (short_name: string, author_name: string, author_url?: string) => Promise<any>;
    createPage: (access_token: string, title: string, author_name: string, author_url: string, content: any, return_content: boolean) => Promise<any>;
}

export class TelegraPhServiceImpl implements TelegraPhService {
    async createAccount(short_name: string, author_name: string, author_url?: string): Promise<any> {

    }

    async createPage(access_token: string, title: string, author_name: string, author_url: string, content: any, return_content: boolean): Promise<any> {

    }
}