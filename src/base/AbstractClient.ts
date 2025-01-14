export default abstract class AbstractClient {

}

export interface IClient {
    logIn(): Promise<boolean>
}