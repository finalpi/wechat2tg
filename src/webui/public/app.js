'use strict'

const copy = {
    en: {
        workspace:'Personal workspace', workspaceSub:'A simpler way to connect', configuration:'CONFIGURATION', heading:'Let your messages flow.', intro:'A little space to connect your WeChat and Telegram.', heroKicker:'A SMALL BRIDGE. A BIG CONNECTION.', heroTitle:'Your messages. Together.', heroDescription:'Connect your accounts, set your preferences, and let conversation happen.', heroAction:'Set up your bridge', credentials:'Connection credentials', forwardPreferences:'Forwarding preferences', configurationState:'Configuration status', bridgeTitle:'Two platforms. One place.', bridgeDescription:'A thoughtful little bridge for your everyday conversations.', guideTitle:'Less friction. More flow.', guideDescription:'Start with the essentials, then add what you need. Every setting has a little guidance, and you can always come back.', step1:'Connect both sides', step1Description:'Add your Telegram credentials and WeChat service URL.', step2:'Make it yours', step2Description:'Choose forwarding preferences, templates, and integrations.', step3:'Save, and go', step3Description:'Forwarding preferences apply immediately. Environment settings need a restart.', privacyTitle:'Your secrets stay yours.', privacyDescription:'Saved secrets are never returned to the browser. Leave blank to keep them, or enter a new value to replace them.', footer:'A simpler connection. A calmer conversation.', discard:'Discard changes', save:'Save configuration', restartTitle:'Saved. Restart to apply.', restartDescription:'Connection, proxy, template, and service settings load on the next startup. Restart the app using your usual method.', noResults:'No matching settings', noResultsHelp:'Try a setting name or environment variable.', authTitle:'Welcome back.', authDescription:'Enter your access token to open your bridge console.', accessToken:'Access token', authHint:'Find your token in storage/webui-token, or use the WEBUI_TOKEN environment variable.', authPrivacy:'Your token stays in memory for this page only.', signIn:'Open console', logout:'Sign out', placeholderTitle:'Available placeholders', alias:'Contact alias', name:'Contact name', topic:'Group name', aliasFirst:'Alias, or name', identity:'Message prefix', body:'Message content', lineBreak:'Line break', configured:'Configured', needsSetup:'Needs setup', ready:'Credentials ready', setup:'Setup needed', active:'enabled', saved:'Saved', unsaved:'Unsaved changes', restart:'Restart needed', available:'AVAILABLE', offline:'UNAVAILABLE', fields:'settings', search:'Search all settings…', pending:'unsaved changes', allSaved:'All changes saved', savedDescription:'A little fine-tuning, whenever you need it.', pendingDescription:'Save your changes when you are ready.', saving:'Saving…', savedToast:'Configuration saved.', savedRestartToast:'Configuration saved. Restart the app to apply.', environment:'Environment settings', environmentHint:'WebUI overrides environment variables; restart to apply', runtime:'Bot preferences', runtimeHint:'Saved immediately; startup sync applies next launch', runtimeUnavailable:'Bot preferences are unavailable in setup mode or when the database is unavailable.', secretSet:'A secret is saved. Leave blank to keep it.', secretEmpty:'No secret configured', secretPlaceholder:'Enter to replace the saved secret', secretNewPlaceholder:'Enter your secret', clearSecret:'Clear saved secret', secretCleared:'Will be cleared on save', reveal:'Show or hide the new secret', trueLabel:'Enabled', falseLabel:'Disabled', direct:'Direct connection', confirmDiscard:'Discard all unsaved changes?', unauthorized:'The access token is incorrect. Please try again.', rateLimited:'Too many attempts. Please wait a minute.', forbidden:'Cross-origin requests are not allowed.', notFound:'The endpoint was not found.', assetsUnavailable:'WebUI assets are unavailable. Run npm run build.', jsonRequired:'The request must use JSON.', tooLarge:'The request is too large.', invalidJson:'The request contains invalid JSON.', invalidRequest:'The request is invalid.', conflict:'Configuration changed elsewhere. Reload to get the latest settings; your changes have not been saved.', serverError:'Could not save configuration. Check the server and try again.', networkError:'Could not reach the server. Check your connection.', proxyIncomplete:'Enter a proxy host and port, or choose Direct connection.', portConflict:'The callback port must differ from the WebUI port.', validation:'Some settings are invalid. Check the highlighted fields.', required:'This field is required.', range:'Enter an integer between {min} and {max}.', url:'Enter a complete URL with a supported protocol and no embedded credentials.', reload:'Reload configuration', long:'Use no more than 4096 characters.', partial:'Some changes were saved; the remaining changes are still pending.', connection:'Connection', forward:'Message forwarding', templates:'Message style', proxy:'Network proxy', ai:'AI & speech', advanced:'Advanced', connectionCaption:'Bring WeChat and Telegram together', forwardCaption:'Only the messages that matter to you', templatesCaption:'Add a personal touch to every message', proxyCaption:'Choose the right route for your connection', aiCaption:'A little inspiration for your conversations', advancedCaption:'Fine-tune retries, history, and logging', requiredLabel:'required', retry:'Try again',
    },
    zh: {
        workspace:'个人工作空间',workspaceSub:'连接，让沟通更简单',configuration:'配置管理',heading:'让消息，顺畅抵达。',intro:'在一个安静的空间里，配置你的微信与 Telegram。',heroKicker:'小小的桥，大大的连接',heroTitle:'你的消息，始终在一起。',heroDescription:'连接账号、选择转发偏好，让沟通自然发生。',heroAction:'开始配置',credentials:'连接凭证',forwardPreferences:'转发偏好',configurationState:'配置状态',bridgeTitle:'两端连接，一处掌控。',bridgeDescription:'为你的日常沟通，搭一座轻巧的桥。',guideTitle:'刚刚好，才是最好。',guideDescription:'从基本连接开始，再按需要开启更多功能。每个配置项都有说明，随时可以调整。',step1:'连接两端',step1Description:'填写 Telegram 凭证和微信服务地址。',step2:'选择你的偏好',step2Description:'调整消息转发、模板与扩展服务。',step3:'保存，然后出发',step3Description:'转发开关即时保存，环境配置重启后生效。',privacyTitle:'密钥，妥善保管。',privacyDescription:'已保存的密钥不会返回浏览器。留空保持不变，填写新值即可替换。',footer:'让连接更简单，让沟通更自在。',discard:'放弃更改',save:'保存配置',restartTitle:'配置已保存，等待重启生效',restartDescription:'连接、代理、模板和服务配置会在下次启动时加载，请通过原有方式重启应用。',noResults:'没有找到匹配的配置',noResultsHelp:'试试搜索配置名称或环境变量名。',authTitle:'欢迎回来。',authDescription:'输入访问令牌，进入你的消息控制台。',accessToken:'访问令牌',authHint:'令牌位于 storage/webui-token，或由 WEBUI_TOKEN 环境变量指定。',authPrivacy:'访问令牌仅保留在当前页面内存中。',signIn:'进入控制台',logout:'退出登录',placeholderTitle:'可用占位符',alias:'联系人备注',name:'联系人昵称',topic:'群聊名称',aliasFirst:'备注优先，否则昵称',identity:'消息身份前缀',body:'消息正文',lineBreak:'换行',configured:'已配置',needsSetup:'待配置',ready:'凭证已就绪',setup:'等待连接配置',active:'项已开启',saved:'已保存',unsaved:'有未保存更改',restart:'等待重启',available:'可用',offline:'不可用',fields:'个配置项',search:'搜索全部配置…',pending:'项未保存更改',allSaved:'所有更改已保存',savedDescription:'随时调整，让配置更适合你。',pendingDescription:'调整完成后，记得保存配置。',saving:'正在保存…',savedToast:'配置保存成功。',savedRestartToast:'配置保存成功，重启应用后生效。',environment:'环境配置',environmentHint:'WebUI 保存值优先于环境变量；重启后生效',runtime:'机器人偏好',runtimeHint:'保存后立即生效；启动同步在下次启动时执行',runtimeUnavailable:'配置模式或数据库不可用时，无法修改机器人偏好。',secretSet:'已有密钥，留空保持不变。',secretEmpty:'尚未配置密钥',secretPlaceholder:'填写新值以替换已保存密钥',secretNewPlaceholder:'请输入密钥',clearSecret:'清除已保存密钥',secretCleared:'保存时将清除密钥',reveal:'显示或隐藏新密钥',trueLabel:'开启',falseLabel:'关闭',direct:'不使用代理（直连）',confirmDiscard:'放弃所有未保存的更改？',unauthorized:'访问令牌不正确，请重试。',rateLimited:'尝试次数过多，请一分钟后再试。',forbidden:'不允许跨站请求。',notFound:'未找到接口。',assetsUnavailable:'WebUI 资源不可用，请执行 npm run build。',jsonRequired:'请求需要使用 JSON。',tooLarge:'请求内容过大。',invalidJson:'请求包含无效的 JSON。',invalidRequest:'请求格式无效。',conflict:'配置已在其他位置更新。请重新加载配置，本次更改尚未保存。',serverError:'保存失败，请检查服务后重试。',networkError:'无法连接服务，请检查网络。',proxyIncomplete:'请填写代理主机和端口，或选择直连。',portConflict:'回调端口不能与 WebUI 端口相同。',validation:'部分配置无效，请检查标记的字段。',required:'此项不能为空。',range:'请输入 {min}–{max} 范围内的整数。',url:'请输入支持协议的完整 URL，且不要在地址中包含认证凭证。',reload:'重新加载配置',long:'内容不能超过 4096 个字符。',partial:'部分配置已保存，其余更改仍保留，待重新保存。',connection:'连接配置',forward:'消息转发',templates:'消息样式',proxy:'网络代理',ai:'AI 与语音',advanced:'高级设置',connectionCaption:'让微信与 Telegram 轻松连接',forwardCaption:'只接收你关心的消息',templatesCaption:'为每一条消息添加个人风格',proxyCaption:'为连接选择合适的网络路径',aiCaption:'让沟通多一点灵感',advancedCaption:'调节重试、存储与日志',requiredLabel:'必填',retry:'重试',
    },
}

// Field copy is keyed by stable configuration keys, independently of the bot language.
const englishFields = {
    BOT_TOKEN:['Bot Token','Get your Telegram bot token from @BotFather.'], API_ID:['API ID','Create an application at my.telegram.org to get your ID.'], API_HASH:['API Hash','The application credential paired with your API ID.'], BASE_API:['WeChat service URL','The wx2tg-server API URL, e.g. http://wx2tg-server:8058/api.'], DEVICE_TYPE:['Login device','Choose the device protocol used to sign in to WeChat.'], MODE:['Message delivery mode','Polling fetches messages periodically; callback receives server pushes.'], CALLBACK_PORT:['Callback port','Listening port for callback mode. Must differ from the WebUI port.'], CALLBACK_API:['Callback service URL','Optional callback service URL used by the application.'], FILE_API:['File service URL','Optional URL for a separate file service.'], receivePublicAccount:['Receive official account messages','Forward WeChat official account messages to Telegram.'], onlyReceiveOfficialNotify:['Only official account notifications','Skip regular articles and receive notification messages only.'], selfMessage:['Forward your own messages','Include messages you send in your Telegram conversations.'], emojiPicture:['Show emoji as image links','Display original emoji using image links.'], syncWechat:['Sync contacts and groups on startup','Refresh contact information, group names, and avatars on the next startup.'], language:['Bot language','Language used by Telegram bot menus and messages.'], PROXY_PROTOCOL:['Telegram proxy protocol','Choose Direct connection if you do not need a proxy.'], PROXY_HOST:['Proxy host','An IP address or hostname, without protocol or port.'], PROXY_PORT:['Proxy port','The port your proxy server listens on.'], PROXY_USERNAME:['Proxy username','Optional authentication username.'], PROXY_PASSWORD:['Proxy password','Optional authentication password.'], WX_PROXY_HOST:['WeChat SOCKS proxy','Use a login proxy in the same region as your WeChat account.'], WX_PROXY_USERNAME:['WeChat proxy username','Optional WeChat proxy authentication username.'], WX_PROXY_PASSWORD:['WeChat proxy password','Optional WeChat proxy authentication password.'], AI_API_URL:['AI API URL','The complete chat completions URL of an OpenAI-compatible service.'], AI_API_KEY:['AI API Key','The access key used to call your AI service.'], AI_MODEL:['Model name','Enter a model supported by your connected service.'], AI_CONTEXT_LIMIT:['Default context size','Fallback number of messages when no bot context size is set.'], aiContextLimit:['Bot context size','Takes priority over the default. New requests use this value immediately.'], autoTranscript:['Automatically transcribe voice','Use Tencent Cloud ASR to transcribe voice messages. Credentials are required below.'], TENCENT_SECRET_ID:['Tencent Cloud Secret ID','Access identifier for Tencent Cloud speech recognition.'], TENCENT_SECRET_KEY:['Tencent Cloud Secret Key','Secret key for Tencent Cloud speech recognition.'], SEND_TO_WX_MAX_RETRIES:['WeChat maximum retries','Use 0 for unlimited retries.'], SEND_TO_WX_TIMEOUT:['WeChat send timeout (ms)','How long to wait for a single delivery attempt.'], SEND_TO_TG_MAX_RETRIES:['Telegram maximum retries','Use 0 for unlimited retries.'], SEND_TO_TG_RETRY_DELAY:['Telegram retry interval (ms)','Base waiting time for exponential backoff.'], MESSAGE_BUFFER_EXPIRE_TIME:['Message buffer lifetime (ms)','Queued messages are removed after this duration.'], AUTO_DELETE_OLD_MESSAGES:['Automatically clean up message history','Deletes database records only. Expired messages cannot be quoted or recalled.'], MESSAGE_RETENTION_DAYS:['Message retention (days)','Remove history records older than this period.'], LOG_LEVEL:['Log level','Use info for everyday operation, or debug when troubleshooting.'], DEBUG_MODE:['Debug mode','Log additional diagnostics. Logs may contain message content.'],
}
;['CONTACT_MESSAGE','OFFICIAL_MESSAGE','ROOM_MESSAGE','CONTACT_MESSAGE_GROUP','OFFICIAL_MESSAGE_GROUP','ROOM_MESSAGE_GROUP','CREATE_ROOM_NAME','CREATE_CONTACT_NAME','MESSAGE_DISPLAY'].forEach((key,i)=>{
    englishFields[key]=[['Contact message prefix','Official account prefix','Group message prefix','Bound contact group prefix','Bound official account group prefix','Bound WeChat group prefix','New WeChat group name','New contact group name','Message body format'][i],'Supports existing HTML formatting and #[…] placeholders.']
})

Object.assign(copy.en, {previewTitle:'Live preview',previewDescription:'Sample messages update as you type. Nothing is sent.',previewLabel:'Preview',previewContact:'Contact',previewGroup:'Group chat',previewOfficial:'Official account',previewSample:'Sample data',previewAlias:'Alias',previewName:'Name',previewTopic:'Group name',previewBody:'Message',sampleAlias:'Alex · Design',sampleName:'Alex',sampleTopic:'Weekend plans',sampleOfficial:'Daily updates',sampleGroupAlias:'Our weekend group',sampleBody:'Good morning! Shall we meet at 10 tomorrow? ☀️',previewEmpty:'This template produces an empty result.',previewNote:'Formatting preview only. Telegram determines final font and rendering; unsupported HTML is omitted here.',previewPlain:'Group name · plain text',previewFallback:'Test without an alias',previewTime:'Example · 10:24'})
Object.assign(copy.zh, {previewTitle:'实时预览',previewDescription:'边输入，边确认样式。示例不会发送消息。',previewLabel:'样式预览',previewContact:'联系人',previewGroup:'群聊',previewOfficial:'公众号',previewSample:'示例数据',previewAlias:'联系人备注',previewName:'联系人昵称',previewTopic:'群聊名称',previewBody:'消息正文',sampleAlias:'小林 · 设计',sampleName:'林晓',sampleTopic:'周末出行计划',sampleOfficial:'每日服务通知',sampleGroupAlias:'我们的周末群',sampleBody:'早上好！明天上午 10 点一起出发吧 ☀️',previewEmpty:'此模板的结果为空。',previewNote:'用于确认格式。实际字体与呈现以 Telegram 为准；预览会忽略不支持的 HTML。',previewPlain:'群组名称 · 纯文本',previewFallback:'测试没有备注的情况',previewTime:'示例 · 10:24'})

Object.assign(copy.en, {messages:'Messages',messagesCaption:'People and conversations in one place',messagesHeading:'A little closer to every conversation.',messagesIntro:'Find a contact, read your saved history, and send a message to WeChat.',telegramProxyTitle:'Telegram proxy',telegramProxyDescription:'Used by Telegram connections. Leave the protocol set to Direct connection to disable.',wechatProxyTitle:'WeChat proxy',wechatProxyDescription:'Used for WeChat login. Configured separately from the Telegram proxy.',conversations:'Conversations',searchContacts:'Search name, alias, or WeChat ID…',searchMessages:'Search this conversation…',contactsCount:'contacts',filter_all:'All',filter_contact:'Contacts',filter_group:'Groups',groupChat:'Group',contactChat:'Contact',chooseConversation:'Choose a conversation',chooseConversationHelp:'Select a contact or group on the left to view messages and start writing.',wechatConnected:'WeChat connected',wechatOffline:'WeChat is offline. Sign in through the existing bot first.',messagesUnavailable:'Message center is unavailable in setup mode.',recipientMissing:'This recipient is no longer in the contact directory.',requestConflict:'This request ID has already been used for another message.',sendQueueFull:'The sending queue is full. Please try again later.',loadingContacts:'Loading contacts…',noContacts:'No matching contacts.',directoryPending:'The full WeChat directory is not ready. Showing saved bindings.',loadMoreContacts:'Load more contacts',loadOlderMessages:'Load older messages',messageHistory:'Message history',noMessages:'No saved messages here yet. Incoming messages will appear automatically.',unknownDate:'Earlier messages',mediaMessage:'[Media or system message]',writeMessage:'Write a message to the selected WeChat contact…',sendMessage:'Send to WeChat',sendingMessage:'Submitting…',sendShortcut:'Ctrl / ⌘ + Enter to send',messageQueued:'Message queued. Check the status in the conversation.',sendStatusNote:'Submitted means the WeChat service returned a message ID, not a read receipt. Uncertain results are never retried automatically.',messageStatus_sending:'Sending',messageStatus_submitted:'Submitted',messageStatus_unknown:'Result uncertain — check WeChat',messageStatus_received:'Received',liveUpdates:'UPDATES EVERY 5s'})
Object.assign(copy.zh, {messages:'消息管理',messagesCaption:'联系人与对话，一处管理',messagesHeading:'每一段对话，都在这里。',messagesIntro:'搜索联系人，查看已保存的会话记录，直接向微信发送消息。',telegramProxyTitle:'Telegram 代理',telegramProxyDescription:'用于 Telegram 连接；不需要代理时选择直连。',wechatProxyTitle:'微信代理',wechatProxyDescription:'用于微信登录，与 Telegram 代理独立配置。',conversations:'联系人与会话',searchContacts:'搜索昵称、备注或微信 ID…',searchMessages:'搜索当前会话…',contactsCount:'位联系人',filter_all:'全部',filter_contact:'联系人',filter_group:'群聊',groupChat:'群聊',contactChat:'联系人',chooseConversation:'选择一段对话',chooseConversationHelp:'从左侧选择联系人或群聊，查看消息并开始输入。',wechatConnected:'微信已连接',wechatOffline:'微信未登录，请先通过现有机器人登录。',messagesUnavailable:'独立配置模式下消息管理不可用。',recipientMissing:'联系人已不在通讯录中。',requestConflict:'此请求编号已被另一条消息使用。',sendQueueFull:'发送队列已满，请稍后重试。',loadingContacts:'正在加载联系人…',noContacts:'没有找到匹配的联系人。',directoryPending:'微信完整通讯录尚未就绪，当前展示已保存的绑定。',loadMoreContacts:'加载更多联系人',loadOlderMessages:'加载更早的消息',messageHistory:'会话消息记录',noMessages:'暂无已保存的消息。新收到的消息会自动显示。',unknownDate:'较早的消息',mediaMessage:'[媒体或系统消息]',writeMessage:'输入消息，发送给当前选中的微信联系人…',sendMessage:'发送到微信',sendingMessage:'正在提交…',sendShortcut:'Ctrl / ⌘ + Enter 发送',messageQueued:'消息已进入发送队列，请在会话中查看状态。',sendStatusNote:'“已提交”表示微信服务返回了消息编号，不代表对方已读。结果不确定时不会自动重发。',messageStatus_sending:'发送中',messageStatus_submitted:'已提交',messageStatus_unknown:'结果待确认，请核对微信',messageStatus_received:'已接收',liveUpdates:'每 5 秒更新'})

Object.assign(copy.en,{attachmentTextSeparate:'Attachments and text are sent as separate WeChat messages.',filter_all:'All · Recent',attachMedia:'Attach media / file',attachVoice:'Send voice',mediaLimit:'Up to 50 MiB · MP4 video',uploadingMedia:'Uploading attachment…',mediaTooLarge:'Attachments are limited to 50 MiB.',emptyMedia:'The attachment is empty.',binaryRequired:'Upload a binary file.',invalidMediaType:'Unsupported attachment type.',invalidVoiceFormat:'Choose an MP3, WAV, OGG, WebM, M4A, AAC or FLAC voice file.',mediaConversionFailed:'Could not convert this attachment. Check the file format.',mediaMissing:'This attachment is unavailable or no longer cached.',mediaType_image:'Image',mediaType_emoji:'GIF / sticker',mediaType_video:'Video',mediaType_audio:'Audio',mediaType_voice:'Voice',mediaType_file:'File',mediaType_link:'Link',mediaType_location:'Location',mediaType_contact:'Contact card',mediaType_quote:'Quoted message',mediaType_text:'Text',mediaType_unknown:'Other message',viewMedia:'Open attachment',downloadFile:'Download',unsyncedLabel:'Not yet delivered to Telegram',retryTelegramOnly:'Sync to Telegram only',confirmTelegramRetry:'The previous Telegram result is uncertain. Retrying may create a duplicate in Telegram. Continue without resending to WeChat?',telegramOffline:'Telegram is offline. The WeChat message is retained; sync again after reconnecting.',telegramQueued:'This message is already queued for Telegram. Wait for its result.',syncUncertain:'Confirm the uncertain Telegram result before retrying.',messageNotSubmitted:'This message has not been submitted to WeChat yet.',messageExcluded:'Forwarding is disabled for this message.',telegramStatus_pending:'Telegram pending',telegramStatus_syncing:'Syncing to Telegram',telegramStatus_synced:'Telegram synced',telegramStatus_failed:'Telegram not synced',telegramStatus_unknown:'Telegram result uncertain',telegramStatus_excluded:'Forwarding excluded',messageStatus_failed:'Not sent to WeChat',messageStatus_submitted:'Submitted to WeChat'})
Object.assign(copy.zh,{attachmentTextSeparate:'附件和文字会分别发送为微信消息。',filter_all:'全部 · 最近',attachMedia:'图片 / 视频 / 文件',attachVoice:'发送语音',mediaLimit:'最大 50 MiB · 视频支持 MP4',uploadingMedia:'正在上传附件…',mediaTooLarge:'附件不能超过 50 MiB。',emptyMedia:'附件内容为空。',binaryRequired:'请上传二进制文件。',invalidMediaType:'不支持此附件类型。',invalidVoiceFormat:'语音支持 MP3、WAV、OGG、WebM、M4A、AAC、FLAC。',mediaConversionFailed:'无法转换附件，请检查文件格式。',mediaMissing:'附件不可用或已不在缓存中。',mediaType_image:'图片',mediaType_emoji:'GIF / 表情',mediaType_video:'视频',mediaType_audio:'音频',mediaType_voice:'语音',mediaType_file:'文件',mediaType_link:'链接',mediaType_location:'位置',mediaType_contact:'名片',mediaType_quote:'引用消息',mediaType_text:'文本',mediaType_unknown:'其他消息',viewMedia:'查看附件',downloadFile:'下载',unsyncedLabel:'尚未成功同步到 Telegram',retryTelegramOnly:'仅补发到 Telegram',confirmTelegramRetry:'此前 Telegram 发送结果不确定，重试可能产生重复消息。是否继续仅补发到 Telegram，不重发微信？',telegramOffline:'Telegram 未连接。微信消息已保留，恢复连接后可补发。',telegramQueued:'消息已在 Telegram 发送队列中，请等待结果。',syncUncertain:'此前 Telegram 结果不确定，请确认后再补发。',messageNotSubmitted:'消息尚未成功提交到微信。',messageExcluded:'此消息已关闭转发。',telegramStatus_pending:'Telegram 待同步',telegramStatus_syncing:'Telegram 同步中',telegramStatus_synced:'Telegram 已同步',telegramStatus_failed:'Telegram 未同步',telegramStatus_unknown:'Telegram 结果待确认',telegramStatus_excluded:'未开启转发',messageStatus_failed:'微信未发送',messageStatus_submitted:'微信已提交'})

Object.assign(copy.en,{mediaType_app_msg:'App message',mediaType_mini_app:'Mini app',mediaType_transfer:'Transfer',mediaType_red_packet:'Red packet',mediaType_pat:'Pat',mediaType_revoke:'Recalled message',mediaType_function_msg:'Service notification',mediaType_room_invitation:'Group invitation',mediaType_video_account:'Channels video',mediaType_chat_histroy:'Chat history',mediaType_add_friend:'Friend request',mediaType_voip:'Call',mediaType_new_monment_timeline:'Moments update',mediaType_real_time_location:'Live location',mediaType_file_start:'File preparing',mediaType_0:'Text',mediaType_1:'File'})
Object.assign(copy.zh,{mediaType_app_msg:'应用消息',mediaType_mini_app:'小程序',mediaType_transfer:'转账',mediaType_red_packet:'红包',mediaType_pat:'拍一拍',mediaType_revoke:'撤回消息',mediaType_function_msg:'服务通知',mediaType_room_invitation:'群邀请',mediaType_video_account:'视频号',mediaType_chat_histroy:'聊天记录',mediaType_add_friend:'好友申请',mediaType_voip:'通话',mediaType_new_monment_timeline:'朋友圈更新',mediaType_real_time_location:'位置共享',mediaType_file_start:'文件准备中',mediaType_0:'文本',mediaType_1:'文件'})

Object.assign(copy.en,{pastedImage:'Clipboard image',uploadInProgress:'Please wait for the current upload.',transcriptTitle:'Shared chat history · expand to read',avatarUnavailable:'Avatar unavailable',telegramStatus_unverified:'Historical delivery unverified',pasteHint:'Paste an image directly here',deliveryLegend:'Red count: Telegram pending or failed. Uncertain and historical records are listed separately.'})
Object.assign(copy.zh,{pastedImage:'剪贴板图片',uploadInProgress:'请等待当前附件上传完成。',transcriptTitle:'合并聊天记录 · 点击展开',avatarUnavailable:'头像暂不可用',telegramStatus_unverified:'历史同步结果未核实',pasteHint:'支持直接粘贴剪贴板图片',deliveryLegend:'红色数量仅表示 Telegram 待发送或明确失败；结果不确定、历史记录单独说明。'})

Object.assign(copy.en,{aiToolsTitle:'Connect, discover, and test',aiToolsHelp:'Use the URL and key currently entered below. A blank key retains the saved key. These checks do not save settings or send chat history.',aiReadModels:'Read model list',aiTestModel:'Test selected model',aiChooseModel:'Select a model to fill its name',aiWorking:'Connecting…',aiModelsLoaded:'models loaded',aiTestSuccess:'Request succeeded',aiEmptyReply:'Connected; model returned no text',aiBusy:'An AI check is already running.',aiInvalidURL:'Enter a valid HTTP or HTTPS API URL.',aiKeyForNewProvider:'Enter a key explicitly when switching to another provider.',aiInvalidModels:'The provider returned an invalid model list.',aiModelRequired:'Enter or select a model first.',aiUnauthorized:'The provider rejected the API key or permissions.',aiEndpointMissing:'The provider endpoint was not found. Check its URL.',aiRateLimited:'The provider rate limit was reached.',aiRequestRejected:'The provider rejected this model or request format.',aiConnectionFailed:'Could not reach the AI provider.'})
Object.assign(copy.zh,{aiToolsTitle:'连接、读取模型与测试',aiToolsHelp:'使用下方当前填写的地址和密钥；密钥留空时沿用已保存值。读取和测试不会保存设置，也不会发送聊天记录。',aiReadModels:'读取模型列表',aiTestModel:'测试当前模型',aiChooseModel:'选择模型，快速填写名称',aiWorking:'正在连接…',aiModelsLoaded:'个模型已读取',aiTestSuccess:'请求成功',aiEmptyReply:'接口已连接，模型未返回文本',aiBusy:'已有 AI 检查正在进行。',aiInvalidURL:'请输入有效的 HTTP 或 HTTPS API 地址。',aiKeyForNewProvider:'切换到其他服务时，请明确填写该服务的密钥。',aiInvalidModels:'服务返回的模型列表格式无效。',aiModelRequired:'请先填写或选择模型。',aiUnauthorized:'服务拒绝了密钥或访问权限。',aiEndpointMissing:'服务接口未找到，请检查地址。',aiRateLimited:'AI 服务触发了限流。',aiRequestRejected:'服务拒绝了当前模型或请求格式。',aiConnectionFailed:'无法连接 AI 服务，请检查地址和网络。'})

const paths = {
    link:'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2 M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2', send:'m22 2-7 20-4-9-9-4 20-7Z M22 2 11 13', type:'M4 4h16 M12 4v16 M8 20h8', globe:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M3 12h18 M12 3c5 5 5 13 0 18-5-5-5-13 0-18', spark:'m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z M20 3v4 M18 5h4', bell:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 21h4', sliders:'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 10h6 M9 12h6 M17 16h6', grid:'M3 3h7v7H3V3Z M14 3h7v7h-7V3Z M3 14h7v7H3v-7Z M14 14h7v7h-7v-7Z', message:'M21 11a8 8 0 0 1-8 8H8l-5 3 1-6a8 8 0 0 1-1-5 9 9 0 0 1 18 0Z M7 10h.01 M12 10h.01 M17 10h.01', bridge:'M3 16V8 M21 16V8 M3 12c6-8 12-8 18 0 M3 16h18 M8 8v8 M16 8v8', arrow:'M4 12h16 M14 6l6 6-6 6', check:'m5 12 4 4L19 6', search:'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0 M15 15l6 6', shield:'m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z m-4 9 3 3 5-6', info:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M12 11v6 M12 7h.01', logout:'M10 3H4v18h6 M8 12h13 m-5-5 5 5-5 5', eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
}
paths.refresh='M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 12-2l2 3 M4 16l2 3a7 7 0 0 0 12-2'
const $=id=>document.getElementById(id)
const icon=name=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','1.6');svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');svg.setAttribute('aria-hidden','true');const p=document.createElementNS(svg.namespaceURI,'path');p.setAttribute('d',paths[name]||paths.sliders);svg.append(p);return svg}
const node=(tag,className,text)=>{const el=document.createElement(tag);if(className)el.className=className;if(text!==undefined)el.textContent=text;return el}
let language='zh'
try{language=localStorage.getItem('webui-language')||'zh'}catch{}
if(!copy[language])language='zh'
Object.assign(copy.zh,{mcp:'MCP 接入',mcpCaption:'连接你的 AI 客户端',mcpInvalidSettings:'MCP 设置格式不正确。',mcpInvalidEndpoint:'请输入以 /mcp 结尾的有效访问地址。',mcpHTTPSRequired:'远程访问请使用 HTTPS，或配置本地 SSH 隧道。',mcpInvalidToken:'Token 需为 16–256 位字母、数字或 . _ ~ -，不能包含空格。',mcpTokensMustDiffer:'读写和只读 Token 不能相同。',mcpConflict:'设置已被其他页面更新，请切换页面重新加载。'})
Object.assign(copy.en,{mcp:'MCP access',mcpCaption:'Connect your AI client',mcpInvalidSettings:'Invalid MCP settings.',mcpInvalidEndpoint:'Enter a valid endpoint ending in /mcp.',mcpHTTPSRequired:'Use HTTPS for remote access, or a local SSH tunnel.',mcpInvalidToken:'Token must contain 16–256 letters, digits, or . _ ~ -, without spaces.',mcpTokensMustDiffer:'Read and write tokens must differ.',mcpConflict:'Settings changed in another page. Reopen this page to reload.'})
Object.assign(copy.zh,{closeImagePreview:'关闭图片预览',revokeExpired:'已超过微信撤回时限：普通消息 2 分钟，文件 3 小时。',revokeMessage:'撤回',messageRevoked:'消息已撤回',confirmRevoke:'确定撤回这条微信消息并在 Telegram 标记已撤回？撤回时限由微信校验。',confirmRevokeUnknown:'上次撤回结果不确定。请先确认微信状态；继续可能重复请求撤回，并在 Telegram 标记已撤回。确定继续？',revokeUnavailable:'缺少原始微信编号或消息尚未提交，无法撤回。',revokeOwnOnly:'只能撤回当前微信账号自己发送的消息。',revokeUnknown:'撤回结果不确定，请先检查微信，不要自动重试。',revokeInProgress:'撤回正在处理中。',revokeStatus_revoking:'正在撤回',revokeStatus_revoked:'已撤回',revokeStatus_failed:'微信拒绝撤回，请检查撤回时限和权限。',revokeStatus_unknown:'撤回结果不确定，请检查微信。',syncRevokeTelegram:'同步撤回到 Telegram',quoteMessage:'引用',quoteReplyTo:'回复',quoteUnavailable:'这条消息缺少可引用的微信编号。',quoteWrongConversation:'只能引用当前会话的消息。',quoteTextOnly:'引用回复仅支持文字。',quoteMentionsUnsupported:'当前微信协议接口不支持引用与艾特同时发送，请分别使用。',mentionKeyboardHelp:'↑↓ 切换 · Enter 选择 · Esc 关闭；选中后自动回到聊天框。',mentionMembers:'@ 群成员',mentionEveryone:'所有人',mentionSearch:'搜索群昵称、备注或微信 ID…',mentionLoading:'正在读取群成员…',mentionEmpty:'未找到群成员。',mentionLimit:'最多选择 20 位成员。',mentionAllHelp:'艾特仅用于文字；@所有人需要微信允许的群主或管理员权限。',invalidMentions:'艾特参数不正确。',mentionAllExclusive:'@所有人不能与单个成员同时选择。',mentionsGroupOnly:'艾特只支持微信群聊。',mentionsTextOnly:'艾特仅支持文字消息。',groupMembersUnavailable:'无法读取群成员，请确认微信在线并稍后重试。',mentionMemberMissing:'选中的成员已不在群中，请重新选择。',mentionTextTooLong:'加上艾特内容后超过 4000 字符，请缩短消息。',wechatSendRejected:'微信拒绝了发送请求，请检查群权限。'})
Object.assign(copy.en,{closeImagePreview:'Close image preview',revokeExpired:'WeChat recall window expired: ordinary messages 2 minutes, files 3 hours.',revokeMessage:'Revoke',messageRevoked:'Message revoked',confirmRevoke:'Revoke this WeChat message and mark its Telegram counterpart as revoked? WeChat enforces its recall time limit.',confirmRevokeUnknown:'The last recall outcome is uncertain. Check WeChat first. Continuing may repeat the request and mark the Telegram counterpart as revoked. Continue?',revokeUnavailable:'Original WeChat receipt missing or message not submitted.',revokeOwnOnly:'Only messages sent by the current WeChat account can be revoked.',revokeUnknown:'Recall outcome is uncertain. Check WeChat before retrying.',revokeInProgress:'Recall is in progress.',revokeStatus_revoking:'Revoking',revokeStatus_revoked:'Revoked',revokeStatus_failed:'WeChat rejected the recall. Check time limits and permissions.',revokeStatus_unknown:'Recall outcome uncertain. Check WeChat.',syncRevokeTelegram:'Sync recall to Telegram',quoteMessage:'Reply',quoteReplyTo:'Replying to',quoteUnavailable:'This message has no valid WeChat reference ID.',quoteWrongConversation:'Only messages in this conversation can be quoted.',quoteTextOnly:'Quoted replies support text only.',quoteMentionsUnsupported:'The current WeChat protocol cannot combine quoted replies with mentions. Use them separately.',mentionKeyboardHelp:'↑↓ Navigate · Enter Select · Esc Close. Selection returns to the composer.',mentionMembers:'@ Group members',mentionEveryone:'Everyone',mentionSearch:'Search group name, remark, or WeChat ID…',mentionLoading:'Loading group members…',mentionEmpty:'No matching members.',mentionLimit:'Select at most 20 members.',mentionAllHelp:'Mentions apply to text only. @Everyone requires owner/admin permissions granted by WeChat.',invalidMentions:'Invalid mention parameters.',mentionAllExclusive:'@Everyone cannot be combined with individual mentions.',mentionsGroupOnly:'Mentions require a WeChat group.',mentionsTextOnly:'Mentions apply to text messages only.',groupMembersUnavailable:'Unable to read group members. Check WeChat connectivity and try again.',mentionMemberMissing:'A selected member is no longer in the group. Select again.',mentionTextTooLong:'Text including mentions exceeds 4000 characters.',wechatSendRejected:'WeChat rejected the send request. Check group permissions.'})
let token='',data=null,selected='messages',draft={},errors={},busy=false,toastTimer
const authStorageKey='webui-access-token'
function forgetAuth(){try{localStorage.removeItem(authStorageKey)}catch{};try{sessionStorage.removeItem(authStorageKey)}catch{}}
function saveAuth(remember){
    try{sessionStorage.setItem(authStorageKey,token)}catch{}
    try{if(remember)localStorage.setItem(authStorageKey,token);else localStorage.removeItem(authStorageKey)}catch{}
}
function restoreAuth(){
    try{const remembered=localStorage.getItem(authStorageKey);if(remembered){$('remember-token').checked=true;return remembered}}catch{}
    try{return sessionStorage.getItem(authStorageKey)||''}catch{return ''}
}
function showAuth(){token='';forgetAuth();document.querySelector('.app-shell').inert=true;$('auth-overlay').classList.remove('hidden');$('access-token').focus()}
Object.assign(copy.zh,{rememberToken:'记住访问令牌（此浏览器）',authPrivacy:'当前标签页保留登录；勾选记住后，重新打开也可自动登录。退出登录会清除保存的令牌。'})
Object.assign(copy.en,{rememberToken:'Remember access token in this browser',authPrivacy:'This tab keeps your login. Remembering the token also signs you in after reopening. Signing out clears the saved token.'})
let previewScenario='contact',previewWithoutAlias=false
let messageCenter
const t=(key,params={})=>Object.entries(params).reduce((text,[name,value])=>text.replaceAll(`{${name}}`,value),copy[language][key]||copy.en[key]||key)
const fieldCopy=f=>language==='en'?englishFields[f.key]||[f.key,'']:[f.label,f.description]
const currentValue=f=>Object.hasOwn(draft,f.key)?draft[f.key]:data.values[f.key]

function translate(){
    document.documentElement.lang=language==='zh'?'zh-CN':'en'
    document.title=`wechat2tg · ${language==='zh'?'配置控制台':'Configuration console'}`
    document.querySelectorAll('[data-i18n]').forEach(el=>{el.textContent=t(el.dataset.i18n)})
    document.querySelectorAll('[data-title]').forEach(el=>{el.title=t(el.dataset.title);el.setAttribute('aria-label',t(el.dataset.title))})
    $('language-label').textContent=$('auth-language').textContent=language==='zh'?'English':'简体中文'
    $('search').placeholder=t('search');$('search').setAttribute('aria-label',t('search'))
    $('navigation').setAttribute('aria-label',t('configuration'))
    if(data)render()
}
function switchLanguage(){language=language==='zh'?'en':'zh';try{localStorage.setItem('webui-language',language)}catch{};errors={};$('auth-error').textContent='';translate()}
async function api(method='GET',body,route='/api/config'){
    let response
    try{response=await fetch(route,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})}catch{throw new Error(t('networkError'))}
    const result=await response.json()
    if(!response.ok){if(response.status===401)showAuth();throw new Error(t(result.error||'serverError'))}
    return result
}
function toast(message,error=false){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').classList.remove('hidden');toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),error?8000:4500)}
async function mediaTransfer(route,file){
    let response
    try{response=await fetch(route,{method:file?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(file?{'Content-Type':'application/octet-stream'}:{})},body:file})}catch{throw new Error(t('networkError'))}
    if(!response.ok){if(response.status===401)showAuth();const result=await response.json();throw new Error(t(result.error||'serverError'))}
    return file?response.json():response.blob()
}
function updateSummary(){
    const count=Object.keys(draft).length
    const complete=Boolean(data.secrets.BOT_TOKEN&&data.secrets.API_HASH&&data.values.API_ID)
    $('credential-status').textContent=t(complete?'configured':'needsSetup')
    $('connection-state').textContent=t(complete?'ready':'setup')
    $('forward-status').textContent=data.runtimeAvailable?`${data.fields.filter(f=>f.source==='runtime'&&f.type==='boolean'&&data.values[f.key]).length} ${t('active')}`:t('offline')
    $('runtime-tag').textContent=t(data.runtimeAvailable?'available':'offline')
    $('save-status').textContent=t(count?'unsaved':data.restartRequired?'restart':'saved')
    $('change-count').textContent=count?`${count} ${t('pending')}`:''
    $('pending-title').textContent=count?`${count} ${t('pending')}`:t('allSaved')
    $('pending-description').textContent=t(count?'pendingDescription':'savedDescription')
    $('save-label').textContent=t(busy?'saving':'save')
    $('save').disabled=busy||!count;$('discard').disabled=busy||!count
    $('restart-banner').classList.toggle('hidden',!data.restartRequired)
    $('savebar-icon').replaceChildren(icon(count?'info':'check'))
}
function edit(f,value,container){
    if(f.type==='password'&&value==='')delete draft[f.key]
    else if(String(value)===String(data.values[f.key])&&f.type!=='password')delete draft[f.key]
    else draft[f.key]=value
    delete errors[f.key]
    container.classList.toggle('modified',Object.hasOwn(draft,f.key))
    container.classList.remove('invalid');container.querySelector('.field-error')?.remove()
    updateSummary()
    if(f.group==='templates')updateTemplatePreviews()
}
function previewSample(){return {alias:previewWithoutAlias?'':t('sampleAlias'),name:t('sampleName'),topic:t('sampleTopic'),official:t('sampleOfficial'),groupAlias:previewWithoutAlias?'':t('sampleGroupAlias'),body:t('sampleBody')}}
function previewValues(){return Object.fromEntries(data.fields.filter(f=>f.group==='templates').map(f=>[f.key,currentValue(f)]))}
function paintPreview(target,key){
    const result=TemplatePreview.example(key,previewValues(),previewSample(),previewScenario)
    target.replaceChildren()
    target.classList.toggle('plain-preview',result.plain)
    if(!result.text)target.append(node('span','preview-empty',t('previewEmpty')))
    else if(result.plain)target.textContent=result.text
    else target.append(TemplatePreview.richText(document,result.text))
}
function updateTemplatePreviews(){
    document.querySelectorAll('[data-preview-key]').forEach(el=>paintPreview(el,el.dataset.previewKey))
}
function renderTemplatePanel(){
    const context=document.querySelector('.context-panel')
    let panel=$('template-preview-panel')
    if(!panel){panel=node('section','preview-card');panel.id='template-preview-panel';context.prepend(panel)}
    panel.classList.toggle('hidden',selected!=='templates')
    context.classList.toggle('preview-context',selected==='templates')
    if(selected!=='templates')return
    panel.replaceChildren()
    const heading=node('div','preview-card-heading');heading.append(node('h3','',t('previewTitle')),node('span','live-badge','LIVE'));panel.append(heading,node('p','preview-description',t('previewDescription')))
    const tabs=node('div','preview-tabs');tabs.setAttribute('role','group');tabs.setAttribute('aria-label',t('previewSample'))
    for(const kind of ['contact','group','official']){const button=node('button',`preview-tab${previewScenario===kind?' active':''}`,t(`preview${kind[0].toUpperCase()+kind.slice(1)}`));button.type='button';button.setAttribute('aria-pressed',String(previewScenario===kind));button.addEventListener('click',()=>{previewScenario=kind;renderTemplatePanel();updateTemplatePreviews()});tabs.append(button)}
    panel.append(tabs)
    const scene=node('div','telegram-scene'),bubble=node('div','message-bubble');bubble.dataset.previewKey='MESSAGE_DISPLAY';scene.append(node('div','preview-chat-name',previewScenario==='group'?t('sampleTopic'):previewScenario==='official'?t('sampleOfficial'):t('sampleName')),bubble,node('div','preview-timestamp',t('previewTime')));panel.append(scene)
    const fallback=node('label','preview-fallback'),checkbox=node('input');checkbox.type='checkbox';checkbox.checked=previewWithoutAlias;checkbox.addEventListener('change',()=>{previewWithoutAlias=checkbox.checked;renderTemplatePanel();updateTemplatePreviews()});fallback.append(checkbox,node('span','',t('previewFallback')));panel.append(fallback)
    const sample=previewSample(),details=node('dl','preview-sample')
    for(const [label,value] of [['previewAlias',sample.alias||'—'],['previewName',sample.name],['previewTopic',sample.topic],['previewBody',sample.body]])details.append(node('dt','',t(label)),node('dd','',value))
    panel.append(details,node('p','preview-note',t('previewNote')))
}
function renderField(f){
    const [label,description]=fieldCopy(f)
    const disabled=busy||(f.source==='runtime'&&!data.runtimeAvailable)
    const container=node('div',`field${f.type==='boolean'?' boolean-field':''}${Object.hasOwn(draft,f.key)?' modified':''}${disabled?' disabled':''}${errors[f.key]?' invalid':''}`)
    const text=node('div','field-content'),top=node('div','field-top'),title=node('label','',label)
    title.htmlFor=`field-${f.key}`
    if(f.required){const required=node('span','required','*');required.title=t('requiredLabel');title.append(required)}
    top.append(title,node('span','field-code',f.key));text.append(top)
    const descriptionNode=node('p','field-description',description);descriptionNode.id=`description-${f.key}`;text.append(descriptionNode)
    container.append(text)
    let input
    if(f.type==='boolean'){
        const toggle=node('label','switch');input=node('input');input.type='checkbox';input.checked=Boolean(currentValue(f));input.setAttribute('role','switch');const track=node('span','switch-track');toggle.append(input,track);container.append(toggle)
    }else{
        const wrap=node('div','input-wrapper')
        if(f.type==='select'){
            input=node('select');for(const value of f.options){const option=node('option','',value===''?t('direct'):f.key==='language'?(value==='zh-CN'?'简体中文':'English'):value);option.value=value;input.append(option)}
        }else if(f.type==='textarea'){input=node('textarea');input.rows=2}
        else{input=node('input');input.type=f.type==='password'?'password':f.type==='number'?'number':'text';input.autocomplete='off';input.spellcheck=false;if(f.min!==undefined){input.min=f.min;input.max=f.max;input.step=1}}
        input.value=currentValue(f)??''
        if(f.type==='password'){
            // Avoid password-manager autofill silently creating configuration changes.
            input.readOnly=true;input.addEventListener('focus',()=>{input.readOnly=false})
            input.placeholder=t(data.secrets[f.key]?'secretPlaceholder':'secretNewPlaceholder')
            const reveal=node('button','reveal');reveal.type='button';reveal.setAttribute('aria-label',t('reveal'));reveal.title=t('reveal');reveal.append(icon('eye'));reveal.disabled=disabled;reveal.addEventListener('click',()=>{input.type=input.type==='password'?'text':'password'});wrap.append(input,reveal)
        }else wrap.append(input)
        text.append(wrap)
        if(f.type==='password'){
            const meta=node('div','secret-meta'),hint=node('span','',t(Object.hasOwn(draft,f.key)&&draft[f.key]===''?'secretCleared':data.secrets[f.key]?'secretSet':'secretEmpty'));meta.append(hint)
            if(data.secrets[f.key]&&!f.required){const clear=node('button','clear-secret',t('clearSecret'));clear.type='button';clear.disabled=disabled;clear.addEventListener('click',()=>{draft[f.key]='';render()});meta.append(clear)}
            text.append(meta)
        }
    }
    input.id=`field-${f.key}`;input.name=f.key;input.disabled=disabled;input.setAttribute('aria-describedby',descriptionNode.id)
    if(f.required)input.setAttribute('aria-required','true')
    if(errors[f.key]){const error=node('p','field-error',errors[f.key]);error.id=`error-${f.key}`;text.append(error);input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby',`${descriptionNode.id} ${error.id}`)}
    input.addEventListener(f.type==='boolean'||f.type==='select'?'change':'input',()=>edit(f,f.type==='boolean'?input.checked:input.value,container))
    if(f.group==='templates'){
        const preview=node('div','inline-preview'),caption=node('div','inline-preview-caption',t(f.key.startsWith('CREATE_')?'previewPlain':'previewLabel')),bubble=node('div','message-bubble');bubble.dataset.previewKey=f.key;preview.append(caption,bubble);text.append(preview)
    }
    return container
}
function render(){
    const navigation=$('navigation');navigation.replaceChildren()
    for(const group of data.groups){const button=node('button',`nav-item${selected===group.id?' active':''}`);button.type='button';button.append(icon(group.icon),node('span','',t(group.id)));if(selected===group.id)button.setAttribute('aria-current','page');button.addEventListener('click',()=>{selected=group.id;$('search').value='';errors={};render()});navigation.append(button)}
    const group=data.groups.find(g=>g.id===selected)
    document.querySelector('.main-shell').classList.toggle('messaging',selected==='messages')
    document.querySelector('.main-shell').classList.toggle('mcp-config',selected==='mcp')
    $('search').disabled=selected==='mcp'
    let inbox=$('message-center-panel')
    if(!inbox){inbox=node('div','message-center hidden');inbox.id='message-center-panel';document.querySelector('main').append(inbox)}
    inbox.classList.toggle('hidden',selected!=='messages')
    document.querySelector('.page-heading h1').textContent=t(selected==='messages'?'messagesHeading':'heading')
    document.querySelector('.page-heading p').textContent=t(selected==='messages'?'messagesIntro':'intro')
    $('section-title').textContent=$('breadcrumb-title').textContent=t(selected)
    $('section-description').textContent=t(`${selected}Caption`)
    $('section-icon').replaceChildren(icon(group.icon))
    $('template-help').classList.toggle('hidden',selected!=='templates')
    renderTemplatePanel()
    if(selected==='messages'){
        if(!messageCenter)messageCenter=MessageCenterUI.create({request:(method,route,body)=>api(method,body,route),transfer:mediaTransfer,t,node,icon,isActive:()=>selected==='messages'&&Boolean(token)&&Boolean(data),notify:toast})
        messageCenter.show(inbox)
        updateSummary()
        return
    }
    const query=$('search').value.trim().toLowerCase()
    const visible=data.fields.filter(f=>query?[f.key,...fieldCopy(f),f.label,f.description].join(' ').toLowerCase().includes(query):f.group===selected)
    $('field-count').textContent=`${visible.length} ${t('fields')}`
    $('empty-state').classList.toggle('hidden',visible.length>0)
    const parent=$('fields');parent.replaceChildren()
    if(selected==='mcp'){
        $('empty-state').classList.add('hidden')
        $('field-count').textContent='MCP · 11 tools'
        MCPSettingsUI.render(parent,{node,request:(method,route,body)=>api(method,body,route),english:language==='en'})
        updateSummary();return
    }
    for(const source of ['environment','runtime']){
        const items=visible.filter(f=>f.source===source);if(!items.length)continue
        const heading=node('div','source-heading');heading.append(node('span','',t(source)),node('small','',t(`${source}Hint`)));parent.append(heading)
        if(source==='runtime'&&!data.runtimeAvailable)parent.append(node('p','field field-description',t('runtimeUnavailable')))
        if(selected==='proxy'&&!query){
            for(const part of ['telegram','wechat']){
                const card=node('section',`proxy-section ${part}-proxy`),header=node('div','proxy-section-header'),badge=node('span','proxy-section-icon');badge.append(icon(part==='telegram'?'send':'message'));const title=node('div');title.append(node('h3','',t(`${part}ProxyTitle`)),node('p','',t(`${part}ProxyDescription`)));header.append(badge,title);card.append(header)
                items.filter(f=>part==='wechat'?f.key.startsWith('WX_'):!f.key.startsWith('WX_')).forEach(f=>card.append(renderField(f)))
                parent.append(card)
            }
        }else items.forEach(f=>parent.append(renderField(f)))
    }
    updateSummary()
    updateTemplatePreviews()
    if(selected==='ai'&&!query)AISettingsUI.render(parent,{t,node,request:(method,route,body)=>api(method,body,route),getValues:()=>({url:$('field-AI_API_URL')?.value||'',key:$('field-AI_API_KEY')?.value||'',model:$('field-AI_MODEL')?.value||''}),onModel:value=>{const field=data.fields.find(f=>f.key==='AI_MODEL'),input=$('field-AI_MODEL');input.value=value;edit(field,value,input.closest('.field'))}})
}
function validate(){
    errors={}
    for(const [key,value] of Object.entries(draft)){
        const f=data.fields.find(f=>f.key===key),text=String(value)
        if(f.required&&!text.trim())errors[key]=t('required')
        else if(text.length>4096)errors[key]=t('long')
        else if(f.type==='number'&&(text!==''||f.source==='runtime')&&(!/^\d+$/.test(text)||Number(text)<f.min||Number(text)>f.max))errors[key]=t('range',{min:f.min,max:f.max})
        else if(['BASE_API','FILE_API','CALLBACK_API','AI_API_URL'].includes(key)&&text){try{const url=new URL(text),allowed=['http:','https:'];if(!allowed.includes(url.protocol)||url.username||url.password)errors[key]=t('url')}catch{errors[key]=t('url')}}
    }
    return !Object.keys(errors).length
}
async function save(){
    if(busy||!Object.keys(draft).length)return
    if(!validate()){const first=data.fields.find(f=>errors[f.key]);selected=first.group;$('search').value='';render();$(`field-${first.key}`).focus();toast(t('validation'),true);return}
    busy=true;render();let savedCount=0
    try{
        for(const source of ['environment','runtime']){
            const values=Object.fromEntries(Object.entries(draft).filter(([key])=>data.fields.some(f=>f.key===key&&f.source===source)))
            if(!Object.keys(values).length)continue
            const result=await api('PATCH',{source,revision:data.revision,values})
            Object.keys(values).forEach(key=>delete draft[key]);data={...data,...result};savedCount+=Object.keys(values).length
        }
        toast(t(data.restartRequired?'savedRestartToast':'savedToast'))
    }catch(error){toast(`${savedCount?t('partial')+' ':''}${error.message}`,true)}
    finally{busy=false;render()}
}
document.querySelectorAll('[data-icon]').forEach(el=>el.append(icon(el.dataset.icon)))
$('language').addEventListener('click',switchLanguage);$('auth-language').addEventListener('click',switchLanguage)
async function signIn(candidate){
    token=candidate.trim();$('auth-error').textContent='';$('auth-submit').disabled=true
    try{data=await api();saveAuth($('remember-token').checked);draft={};errors={};selected='messages';$('access-token').value='';$('auth-overlay').classList.add('hidden');document.querySelector('.app-shell').inert=false;render();document.querySelector('#message-center-panel input[type="search"]')?.focus()}catch(error){token='';$('auth-error').textContent=error.message}finally{$('auth-submit').disabled=false}
}
$('auth-form').addEventListener('submit',async event=>{event.preventDefault();await signIn($('access-token').value)})
$('logout').addEventListener('click',()=>{if((Object.keys(draft).length||messageCenter?.hasDraft())&&!window.confirm(t('confirmDiscard')))return;forgetAuth();token='';draft={};data=null;messageCenter?.clear();$('fields').replaceChildren();$('navigation').replaceChildren();document.querySelector('.app-shell').inert=true;$('auth-overlay').classList.remove('hidden');$('access-token').focus()})
$('search').addEventListener('input',render)
$('reload').addEventListener('click',async()=>{
    if(!data||busy)return
    if(Object.keys(draft).length&&!window.confirm(t('confirmDiscard')))return
    try{data=await api();draft={};errors={};render()}catch(error){toast(error.message,true)}
})
$('settings-form').addEventListener('submit',event=>{event.preventDefault();save()})
$('save').addEventListener('click',save)
$('discard').addEventListener('click',()=>{if(window.confirm(t('confirmDiscard'))){draft={};errors={};render()}})
window.addEventListener('beforeunload',event=>{if(Object.keys(draft).length||messageCenter?.hasDraft()){event.preventDefault();event.returnValue=''}})
document.addEventListener('keydown',event=>{if(event.key==='/'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)&&data){event.preventDefault();$('search').focus()}if((event.ctrlKey||event.metaKey)&&event.key==='s'&&data){event.preventDefault();save()}})
translate();const restoredToken=restoreAuth();if(restoredToken)void signIn(restoredToken);else $('access-token').focus()
