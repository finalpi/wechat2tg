import {extractFull} from 'node-7z'
import fs from 'node:fs'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import converter from 'lottie-converter'

extractFull('save-files/AnimatedSticker.tgs', 'save-files', {
    $bin: '7z'
}).on('end', async () => {
    console.log('end extract tgs to json')
    const converted = await converter({
        file: fs.readFileSync('save-files/AnimatedSticker'),
        format: 'gif',
        width: 1000,
        height: 1000,
    })
    fs.writeFileSync('save-files/AnimatedSticker.gif', converted, 'base64')
})

console.log('end')