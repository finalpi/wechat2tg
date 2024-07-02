const zh = {
    command: {
        description: {
            help: '使用说明',
            start: '开始',
            login: '扫码登陆',
            user: '用户列表',
            room: '群组列表',
            recent: '最近联系人',
            settings: '程序设置',
            check: '微信登录状态',
            bind: '查询群组的绑定状态',
            unbind: '解绑群组',
            cgdata: '设置群组的头像和名称(需要管理员权限)',
            reset: '清空缓存重新登陆',
            stop: '停止微信客户端, 需要重新登陆',
            autocg: '自动设置群组的头像和名称(需要管理员权限)',
        },
        helpText: `**欢迎使用微信消息转发bot**

[本项目](https://github.com/finalpi/wechat2tg)是基于Wechaty和wechat4u项目开发。
**本项目仅用于技术研究和学习，不得用于非法用途。**

1\\. 使用 /start 或 /login 命令来启动微信客户端实例，使用 /login 命令进行扫码登录。
2\\. 使用 /user 或者 /room 命令搜索联系人或者群聊（可以加名称或者备注,例如"/user 张"可以搜索名称或备注含有"张"的用户）。
3\\. 每次登陆后需要等待联系人列表加载才能选择人和群发送信息。
4\\. /settings 打开设置。
5\\. 当前回复的用户或者群会被pin。
6\\. 回复转发的消息能直接直接转发到对应的人或者群（暂时不支持回复回复的消息，而且不改变当前正在回复的用户）。
7\\. 由于使用的web协议的微信协议所以可能会**封号**（目前我没遇到过），使用前请三思。
8\\. 更多功能请查看 github 仓库（For more features, please check the GitHub repository README）。
`,
        startText: '请输入 /login 登陆,或者输入 /help 查看帮助\n请注意执行/login 后你就是该机器的所有者',
        settingsText: '程序设置:',
        langText: '语言设置:',
        resetText: '重置成功',
        autocg: {
            configApi: '请先配置API_ID和API_HASH',
            modelAutoCreate: '自动创建群组模式',
        },
        check: {
            onLine: '微信在线',
            offLine: '微信不在线',
        },
        settings: {},
        cgdata: {
            notBind: '当前未绑定联系人或群组',
            notAdmin: '机器人不是该群组的管理员',
        },
        bind: {
            currentBindUser: '当前绑定联系人:',
            currentBindGroup: '当前绑定群组:',
            noBinding: '当前未绑定任何联系人或者群聊',
        },
        unbindText: '取消绑定成功',
        login: {
            fail: '已经登陆或登录失败请检查状态',
        },
        stop: {
            success: '停止成功,使用 /login 启动bot',
            fail: '停止失败',
        },
        room: {
            notFound: '未找到群组',
            plzSelect: '请选择群组(点击回复)',
        },
        user: {
            onLogin: '请等待,正在登陆...',
            onLoading: '正在加载联系人列表,现在返回的数据可能不完整',
            plzSelect: '请选择联系人(点击回复)',
            notFound: '未找到该用户:',
            individual: '个人',
            official: '公众号',
            plzSelectType: '请选择类型:',
        },
        recent: {
            noUsers: '最近联系人为空',
            plzSelect: '请选择联系人(点击回复)',
        },
    },
    common:{
        open: '开启',
        close: '关闭',
        sendSuccess: '发送成功',
        sendFail: '发送失败',
        plzLoginWeChat: '请先登录微信',
        clickChange: '点击切换',
        onlyInGroup: '该命令仅支持在群组使用',
        nextPage: '下一页',
        prevPage: '上一页',
        scanLogin: '请扫码登陆:',
        accept: '接受',
        error: '错误',
        unknown: '未知',
        large: '过大',
    },
    wechat: {
        requestAddFriend: '请求添加您为好友:',
        unknownUser: '未知用户',
        plzViewOnPhone: '请在手机上查看',
        get: '收到',
        getOne: '收到一条',
        roomInvite: '邀请你加入群聊(无法获取用户名和群名)',
        loginOutDate: '登录状态过期, 重启bot',
        loginSuccess: '微信登录成功!',
        loginFail: '微信登录失败!',
        loadingMembers: '正在加载联系人...',
        me: '我',
        audioOrVideo: '语音/视频通话',
        forwardFail: '转发失败',
        recallMessage: '撤回了一条消息',
        messageType: {
            unknown: '未知消息',
            text: '文本',
            card: '名片',
            file: '文件',
            image: '图片',
            voice: '语音',
            video: '视频',
            emoticon: '表情',
            miniProgram: '小程序',
            redPacket: '红包',
            url: '链接',
            transfer: '转账',
            recalled: '撤回消息',
            groupNote: '群公告',
            chatHistory: '聊天记录',
            post: '帖子',
            location: '位置',
        },
    },
}

export default zh