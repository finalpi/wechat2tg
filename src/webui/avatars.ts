import axios from 'axios'
import sharp from 'sharp'
import fs from 'node:fs'
import path from 'node:path'
import {createHash} from 'node:crypto'

export function allowedAvatarURL(value:string) {
    try{
        const url=new URL(value)
        return ['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&(!url.port||['80','443'].includes(url.port))&&['qlogo.cn','qpic.cn'].some(domain=>url.hostname===domain||url.hostname.endsWith('.'+domain))
    }catch{return false}
}
export async function loadAvatar(value:string,directory='storage/webui-avatars'):Promise<Buffer> {
    const missing=()=>Object.assign(new Error('avatarUnavailable'),{code:'avatarUnavailable',status:404})
    if(!allowedAvatarURL(value))throw missing()
    fs.mkdirSync(directory,{recursive:true})
    const file=path.join(directory,createHash('sha256').update(value).digest('hex')+'.png')
    if(fs.existsSync(file)&&Date.now()-fs.statSync(file).mtimeMs<86400000)return fs.promises.readFile(file)
    let url=value
    for(let i=0;i<4;i++) {
        if(!allowedAvatarURL(url))break
        const response=await axios.get(url,{responseType:'arraybuffer',timeout:7000,maxContentLength:2*1024*1024,maxRedirects:0,validateStatus:()=>true})
        if(response.status>=300&&response.status<400&&response.headers.location){url=new URL(response.headers.location,url).href;continue}
        if(response.status!==200)break
        const buffer=Buffer.from(response.data),head=buffer.subarray(0,16)
        const image=head[0]===255&&head[1]===216||head.subarray(0,4).equals(Buffer.from([137,80,78,71]))||head.subarray(0,4).toString()==='GIF8'||head.subarray(0,4).toString()==='RIFF'&&head.subarray(8,12).toString()==='WEBP'
        if(!image)break
        const png=await sharp(buffer,{limitInputPixels:4000000}).resize(96,96,{fit:'cover'}).png().toBuffer()
        await fs.promises.writeFile(file,png,{mode:0o600})
        return png
    }
    throw missing()
}
