import {xmlToJson} from './xml-to-json'


interface AppMsgXmlSchema {
  msg: {
    appmsg: {
      title: string;
      des: string;
      type: string;
      url: string;
      appattach: {
        totallen: string;
        attachid: string;
        emoticonmd5: string;
        fileext: string;
        cdnattachurl: string;
        cdnthumbaeskey: string;
        aeskey: string;
        encryver: string;
        islargefilemsg: string;
      };
      thumburl: string;
      md5: any;
      recorditem?: string;
      weappinfo?: {
        username: string;
        appid: string;
        pagepath: string;
        weappiconurl: string;
        shareId: string;
      };
      refermsg?: {
        type: string;
        svrid: string;
        fromusr: string;
        chatusr: string;
        displayname: string;
        content: string;
      };
      finderFeed?: {
        objectId: string;
        feedType: string;
        nickname: string;
        avatar: string;
        desc: string;
        mediaCount: string;
        objectNonceId: string;
        liveId: string;
        username: string;
        authIconUrl: string;
        authIconType: string;
        mediaList?: {
           media?: {
            thumbUrl: string,
            fullCoverUrl: string,
            videoPlayDuration: string,
            url: string,
            height: string,
            mediaType: string,
            width: string
          }
        },
        megaVideo?: object,
        bizAuthIconType: string
      };
      mmreader?: {
        category?: {
          item?: appMsgXmlSchema_mmreader_item []
        }
      }
    };
    fromusername: string;
    appinfo: {
      appname: any;
    };
  };
}

export enum AppMessageType {
  Text = 1,
  Img = 2,
  Audio = 3,
  Video = 4,
  Url = 5,
  Attach = 6,
  Open = 7,
  Emoji = 8,
  VoiceRemind = 9,
  ScanGood = 10,
  Good = 13,
  Emotion = 15,
  CardTicket = 16,
  RealtimeShareLocation = 17,
  ChatHistory = 19,
  MiniProgram = 33,
  MiniProgramApp = 36, // this is forwardable mini program
  Channels = 51, // 视频号
  GroupNote = 53,
  ReferMsg = 57,
  Transfers = 2000,
  RedEnvelopes = 2001,
  ReaderType = 100001,
}

export interface AppAttachPayload {
  totallen?: number;
  attachid?: string;
  emoticonmd5?: string;
  fileext?: string;
  cdnattachurl?: string;
  aeskey?: string;
  cdnthumbaeskey?: string;
  encryver?: number;
  islargefilemsg: number;
}

export interface ReferMsgPayload {
  type: string;
  svrid: string;
  fromusr: string;
  chatusr: string;
  displayname: string;
  content: string;
}

export interface ChannelsMsgPayload {
  objectId: string;
  feedType: string;
  nickname: string;
  avatar: string;
  desc: string;
  mediaCount: string;
  objectNonceId: string;
  liveId: string;
  username: string;
  authIconUrl: string;
  authIconType: string;
  mediaList?: {
    media?: {
      thumbUrl: string,
      fullCoverUrl: string,
      videoPlayDuration: string,
      url: string,
      height: string,
      mediaType: string,
      width: string
    }
  },
  megaVideo?: object,
  bizAuthIconType?: string
}

export interface MiniAppMsgPayload {
    username: string;
    appid: string;
    pagepath: string;
    weappiconurl: string;
    shareId: string;
}

export interface AppMessagePayload {
  des?: string;
  thumburl?: string;
  title: string;
  url: string;
  appattach?: AppAttachPayload;
  channel?: ChannelsMsgPayload;
  miniApp?: MiniAppMsgPayload;
  type: AppMessageType;
  md5?: string;
  fromusername?: string;
  recorditem?: string;
  refermsg?: ReferMsgPayload;
  items?: appMsgXmlSchema_mmreader_item [];
}

interface appMsgXmlSchema_mmreader_item {
  title: string;
  cover: string;
  url: string;
  summary?: string;
}

export async function parseAppmsgMessagePayload (messageContent: string): Promise<AppMessagePayload> {
  const appMsgXml: AppMsgXmlSchema = await xmlToJson(messageContent)
  const { title, des, url, thumburl, type, md5, recorditem, mmreader } = appMsgXml.msg.appmsg

  let appattach: AppAttachPayload | undefined
  let channel: ChannelsMsgPayload | undefined
  let miniApp: MiniAppMsgPayload | undefined
  const tmp = appMsgXml.msg.appmsg.appattach
  const channeltmp = appMsgXml.msg.appmsg.finderFeed
  const minitmp = appMsgXml.msg.appmsg.weappinfo
  if (tmp) {
    appattach = {
      aeskey: tmp.aeskey,
      attachid: tmp.attachid,
      cdnattachurl: tmp.cdnattachurl,
      cdnthumbaeskey: tmp.cdnthumbaeskey,
      emoticonmd5: tmp.emoticonmd5,
      encryver: (tmp.encryver && parseInt(tmp.encryver, 10)) || 0,
      fileext: tmp.fileext,
      islargefilemsg: (tmp.islargefilemsg && parseInt(tmp.islargefilemsg, 10)) || 0,
      totallen: (tmp.totallen && parseInt(tmp.totallen, 10)) || 0,
    }
  }
  if (channeltmp) {
    channel = {
      authIconType: channeltmp.authIconType,
      authIconUrl: channeltmp.authIconUrl,
      avatar: channeltmp.avatar,
      desc: channeltmp.desc,
      feedType: channeltmp.feedType,
      liveId: channeltmp.liveId,
      mediaCount: channeltmp.mediaCount,
      nickname: channeltmp.nickname,
      objectId: channeltmp.objectId,
      objectNonceId: channeltmp.objectNonceId,
      username: channeltmp.username,
    }
  }
  if (minitmp) {
    miniApp = {
      appid: minitmp.appid,
      pagepath: minitmp.pagepath,
      shareId: minitmp.shareId,
      username: minitmp.username,
      weappiconurl: minitmp.weappiconurl,
    }
  }

  return {
    appattach,
    channel,
    des,
    md5,
    miniApp,
    recorditem,
    refermsg: appMsgXml.msg.appmsg.refermsg,
    thumburl,
    title,
    type: parseInt(type, 10),
    url,
    items: mmreader?.category?.item,
  }
}