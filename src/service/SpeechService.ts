import { Client } from 'tencentcloud-sdk-nodejs/tencentcloud/services/asr/v20190614/asr_client'
import { ClientConfig } from 'tencentcloud-sdk-nodejs/tencentcloud/common/interface'
import { SentenceRecognitionRequest } from 'tencentcloud-sdk-nodejs/tencentcloud/services/asr/v20190614/asr_models'

export class SpeechService {
    private static instance?: SpeechService = undefined
    private client: Client

    private constructor() {
        const clientConfig: ClientConfig = {
            credential: {
                secretId: process.env.TENCENT_SECRET_ID,
                secretKey: process.env.TENCENT_SECRET_KEY,
            },
            region: "ap-guangzhou",
            profile: {
                signMethod: "TC3-HMAC-SHA256",
                httpProfile: {
                    reqMethod: "POST",
                    reqTimeout: 30,
                },
            },
        }
        this.client = new Client(clientConfig)
    }

    public static getInstance(): SpeechService {
        if (!SpeechService.instance) {
            SpeechService.instance = new SpeechService()
        }
        return SpeechService.instance
    }

    public async getTranscript(audioBuffer: Buffer): Promise<string> {
        const base64Audio = audioBuffer.toString('base64')
        
        const params: SentenceRecognitionRequest = {
            EngSerViceType: "16k_zh",
            SourceType: 1,
            Data: base64Audio,
            DataLen: audioBuffer.length,
            VoiceFormat: "mp3",
        }

        const result = await this.client.SentenceRecognition(params)
        return result.Result
    }
}