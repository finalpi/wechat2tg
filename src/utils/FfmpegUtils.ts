import ffmpegStatic from "ffmpeg-static";
import * as stream from "node:stream";
import * as buffer from "node:buffer";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpeg = require('fluent-ffmpeg');



export class ConverterHelper {
    constructor() {
        // 设置 ffmpeg-static 的路径
        ffmpeg.setFfmpegPath(ffmpegStatic);
    }

    async webmToGif(inputFile: string | Buffer, outputFile: string): Promise<void> {
        return new Promise((resolve, reject) => {
            ffmpeg()
                .input(inputFile)
                // .outputOptions('-vf', 'fps=16,scale=360:-1')
                .format('gif')
                .saveToFile(outputFile)
                .on('end', () => {
                    console.log('file has been converted successfully')
                    resolve();
                })
                .on('error', (error: Error) => {
                    console.error('an error happened: ' + error.message);
                    reject(error);
                });
        });
    }

}
