// Synthetic protocol structures only; no real call IDs, credentials or users.
const control = event=>`<sysmsg type="ilinkvoip"><voipmt>${event}</voipmt></sysmsg>`
const invite = control('<invite>c3ludGhldGljLWludml0ZQ==</invite>')
const cancel = control('<cancel>c3ludGhldGljLWNhbmNlbA==</cancel>')
const dismiss = control('<dismissapns></dismissapns>')
const bubble = '<voipmsg type="VoIPBubbleMsg"><VoIPBubbleMsg><msg><![CDATA[已在其它设备接听]]></msg><room_type>1</room_type><red_dot>false</red_dot><roomid>9007199254740993123</roomid><msg_type>101</msg_type><duration>0</duration></VoIPBubbleMsg></voipmsg>'
module.exports = {control,invite,cancel,dismiss,bubble}