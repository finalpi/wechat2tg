const en = {
    command: {
        description: {
            help: 'Help',
            start: 'Start',
            login: 'Login with QR code',
            user: 'User list',
            room: 'Group list',
            recent: 'Recent contacts',
            settings: 'Application settings',
            check: 'Check WeChat login status',
            bind: 'Check group binding status',
            unbind: 'Unbind group',
            cgdata: 'Set group avatar and name (requires admin permissions)',
            reset: 'Clear cache and re-login',
            stop: 'Stop WeChat client, requires re-login',
            autocg: 'Automatic group creation mode, requires configuring the API and logging into the Telegram User Client',
        },
        helpText: `**Welcome to the WeChat message forwarding bot**
        
[This project](https://github.com/finalpi/wechat2tg) is developed based on Wechaty and wechat4u projects
**This project is for technical research and learning purposes only, and must not be used for illegal activities**
   
1\\. Use the /start or /login command to start the WeChat client instance, and use the /login command to log in by scanning the QR code
2\\. Use the /user or /room command to search for contacts or group chats \\(you can add a name or remark, for example, "/user Zhang" can search for users whose name or remark contains "Zhang"\\)
3\\. After each login, you need to wait for the contact list to load before selecting people and groups to send messages
4\\. Use /settings to open settings
5\\. The currently replied user or group will be pinned
6\\. Replying to a forwarded message can directly forward it to the corresponding person or group \\(temporarily does not support replying to replies, and does not change the currently replied user\\)
7\\. Because the WeChat protocol used is a web protocol, there may be a **ban** **please think twice before using it** \\(I haven't encountered this yet\\)
8\\. For more features, please check the GitHub repository README`,
        startText: 'Please enter /login to log in, or enter /help to view help\nPlease note that after executing /login, you will be the owner of this bot',
        settingsText: 'Program settings:',
        langText: 'Language settings:',
        resetText: 'Reset successful',
        autocg: {
            configApi: 'Please configure API_ID and API_HASH first',
            modelAutoCreate: 'Auto create group mode',
        },
        check: {
            onLine: 'WeChat online',
            offLine: 'WeChat offline',
        },
        settings: {},
        cgdata: {
            notBind: 'No contacts or groups are currently bound',
            notAdmin: 'The bot is not an admin of this group',
        },
        bind: {
            currentBindUser: 'Currently bound contact:',
            currentBindGroup: 'Currently bound group:',
            noBinding: 'No contacts or group chats are currently bound',
        },
        unbindText: 'Unbinding successful',
        login: {
            fail: 'Already logged in or login failed, please check the status',
        },
        stop: {
            success: 'Stopped successfully, use /login to start the bot',
            fail: 'Failed to stop',
        },
        room: {
            notFound: 'Group not found',
            plzSelect: 'Please select a group (click to reply)',
        },
        user: {
            onLogin: 'Please wait, logging in...',
            onLoading: 'Loading contact list, the returned data may be incomplete',
            plzSelect: 'Please select a contact (click to reply)',
            notFound: 'User not found:',
            individual: 'Individual',
            official: 'Official account',
            plzSelectType: 'Please select a type:',
        },
        recent: {
            noUsers: 'No recent contacts',
            plzSelect: 'Please select a contact (click to reply)',
        },
    },
    common: {
        open: 'Open',
        close: 'Close',
        sendSuccess: 'Send successful',
        sendFail: 'Send failed',
        plzLoginWeChat: 'Please log in to WeChat first',
        clickChange: 'Click to switch',
        onlyInGroup: 'This command is only supported in groups',
        nextPage: 'Next page',
        prevPage: 'Previous page',
        scanLogin: 'Scan the QR code to log in:',
        accept: 'Accept',
        error: 'Error',
        unknown: 'Unknown',
        large: 'Too large',
    },
    wechat: {
        requestAddFriend: 'Request to add you as a friend:',
        unknownUser: 'Unknown user',
        plzViewOnPhone: 'Please view on phone',
        get: 'Received',
        getOne: 'Received one',
        roomInvite: 'Invites you to join a group chat (unable to retrieve username and group name)',
        loginOutDate: 'Login status expired, restart bot',
        loginSuccess: 'WeChat login successful!',
        loginFail: 'WeChat login failed!',
        loadingMembers: 'Loading contacts...',
        me: 'Me',
        audioOrVideo: 'Audio/Video call',
        forwardFail: 'Forwarding failed',
        recallMessage: 'Recalled a message',
        messageType: {
            unknown: 'Unknown message',
            text: 'Text',
            card: 'Business card',
            file: 'File',
            image: 'Image',
            voice: 'Voice',
            video: 'Video',
            emoticon: 'Emoticon',
            miniProgram: 'Mini program',
            redPacket: 'Red packet',
            url: 'Link',
            transfer: 'Transfer',
            recalled: 'Recalled message',
            groupNote: 'Group announcement',
            chatHistory: 'Chat history',
            post: 'Post',
            location: 'Location',
        },
    },
}

export default en