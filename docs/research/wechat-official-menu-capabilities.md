# Official/service-account bottom-menu capability: local server source audit

## dev.4 follow-up: authorized read-only evidence

The source audit below is a historical pre-probe assessment. Subsequent user-authorized contact-detail reads confirmed `ExternalInfo.MMBizMenu` and explicit top-level `ServiceType` in selected real accounts. SDK `6.0.18-dev.1` now normalizes and stores safe menus; Bot dev.4 exposes a cached, authenticated GET and renders menus with ordinary HTTP(S) navigation. Repeated placeholder button IDs occur in real data and are not treated as unique identities. See the [sanitized sample table and implementation boundaries](wechat-contact-classification.md).

This supersedes the earlier uncertainty about **retrieval through contact metadata**, not the absence of native click execution. No event clicks, subscriptions, authorizations or deployments were performed. Missing menu/type data remains unknown, not an empty menu or subscription-account claim. The dedicated BizProfileV2 and ClickCommand routes remain unimplemented; adjacent authorization helpers are not used as substitutes.

## Original source-only answer (before the authorized probes)

**Do not currently promise WeChat-like bottom-menu retrieval and activation through this server.** In both examined revisions:

- There is an implemented, routed **contact-detail request** that can return opaque official-account metadata. That is a possible source of menu-related data **if WeChat supplies it**, not a demonstrated, normalized, fresh bottom-menu API.
- The dedicated-looking `BizProfileV2.go` is **only a package declaration**. Menu/profile protobuf messages exist, but there is no corresponding implemented HTTP → request → response path.
- `ClickCommandRequest`/`ClickCommandResponse` exist as protobuf definitions, but no menu-click controller/model/transport caller was found. A logged-in self account therefore has **no demonstrated exposed operation for clicking a third-party official account's menu** in these revisions.
- URL-key resolution, OAuth authorization, mini-program authorization, QR login confirmation, ordinary message sending, and status notification have separate implementations. **None is evidence of a generic bottom-menu click implementation.** They must not be substituted for a menu event.

**Confidence:** high for the source-level implementation gaps and the existing request paths; parent-supplied startup evidence now ties the deployed server to the examined v6.0.17 commit. Live WeChat acceptance, returned menu contents, and action outcomes remain unverified. No real-account/contact/menu requests were executed.

## Scope, refs, and evidence boundary

Primary source root: **`/Users/leat/GolandProjects/fk-zhang`**. All source citations below are relative to this root.

| Ref | Exact revision | Evidence |
| --- | --- | --- |
| **A** | `2e95c86b2fa08f0110397d396da2b1ce42fba672` (local HEAD) | `VERSION:1` is `6.0.17`. |
| **B** | `v6.0.16`, peeled commit `5b3f42d8d384db944f1065314d2db7c96d9e2e44` | `git show v6.0.16:VERSION` is `6.0.16`. |

Unless stated otherwise, line citations use **A**. Unchanged files explicitly identified in the comparison section have the same lines/content at **B**.

**Runtime correction supplied by the parent investigator:** read-only SSH inspection identified container **`wechat-server`**, image **`finalpi/wx2tg-server:v6-latest`**. Its Docker startup log reports **`version=v6.0.17`**, **`commit=2e95c86b2fa08f0110397d396da2b1ce42fba672`**, **`build_time=2026-11-07T19:06:10Z`**. This matches A and supersedes the earlier user-context baseline of v6.0.16 as the last confirmed deployment. The moving image tag alone would not establish identity; the matching startup version/commit is the evidence. This subtask did not repeat that SSH inspection. The parent confirms no real-account/contact/menu requests were executed. B remains the historical comparison baseline, not the currently identified server build.

In particular, `controllers/Tools.go:22–33` returns the literal string **`"869"`** from `GET /api/Tools/Version`; it is not computed from `VERSION` or the build commit. This file is identical at A and B. Thus a log saying “detected protocol 869” cannot distinguish these server releases, nor establish the live account's device/protocol parameters. Local iPad/iPhone constants are `0x18004b21` / WeChat `8.0.75.33` (`Algorithm/Util.go:89–94`, `baseinfo/basedefine.go:8–9`), a separate version axis.

Method: local source reads of complete relevant controller/model/function bodies and protobuf messages; local searches of routes, controllers, models, transport, and schema; read-only `git show`/`git diff` against B; parent-supplied runtime identity observation as explicitly attributed above. This subtask fetched no external documentation, contacted no service, ran no tests that could initialize services, and changed no implementation. Private configuration, raw message fixtures, and `message-example/` were not used as evidence.

## 1. Actual route inventory: no menu route hiding behind the namespace

`routers/router.go:23–122` creates the `/api` namespaces, including `/OfficialAccounts`. Its generated route entries are `routers/commentsRouter_controllers.go:971–1032`:

- `POST /api/OfficialAccounts/Follow`
- `POST /api/OfficialAccounts/Quit`
- `POST /api/OfficialAccounts/MpGetA8Key`
- `POST /api/OfficialAccounts/GetAppMsgExt`
- `POST /api/OfficialAccounts/GetAppMsgExtLike`
- `POST /api/OfficialAccounts/OauthAuthorize`
- `POST /api/OfficialAccounts/JSAPIPreVerify`

The full controller (`controllers/OfficialAccounts.go:1–188`) contains exactly these JSON-unmarshal → named-model → JSON-response handlers. There is no `GetMenu`, `BizProfileV2`, `ClickCommand`, or equivalent menu-event handler. Searching the model/controller/router paths for menu/click/profile/event identifiers found no executable menu path. `controllers/Report.go:1–7` is also only an empty controller type, and `/Report` is not a namespace in `routers/router.go`.

**Important distinction:** `models/OfficialAccounts/BizProfileV2.go:1` contains only `package OfficialAccounts`. It is a **source placeholder, not even an exposed route stub**. Do not build a capability claim from its filename or from generated protobuf registration.

## 2. Retrieval: real contact metadata path versus unimplemented menu-profile path

### Implemented contact-detail path

Trace:

1. `routers/commentsRouter_controllers.go:179–186` registers `POST /api/Friend/GetContractDetail`.
2. `controllers/Friend.go:161–182` unmarshals `Friend.GetContractDetailparameter` and calls `Friend.GetContractDetail`.
3. `models/Friend/GetContractDetail.go:17–21,23–77` accepts **`Wxid`, `Towxids`, `ChatRoom`**. `Wxid` identifies the self account's stored session. `Towxids` is a comma-separated list of target usernames; `ChatRoom` may be empty. The controller documents at most 20 targets and an empty `ChatRoom`; the model itself simply splits the string.
4. The model builds `mm.GetContactRequest`: `BaseRequest` carries session key, UIN, device ID, client version, device type, and scene 0; `UserCount`/`UserNameList` select the targets; `FromChatRoomCount`/`FromChatRoom` carry the optional room context. It marshals and sends **CGI 182**, **`/cgi-bin/micromsg-bin/getcontact`**, encryption type 5, no compression, session cookie/keys (`:62–108`).
5. It unmarshals `mm.GetContactResponse`, invokes metadata capture, and returns the decoded response (`:120–137`). At A, `models/Friend/response.go:9–20` requires an explicit successful `BaseResponse.Ret` for outer success. At B the final wrapper instead unconditionally reports success after successful unmarshalling (`B:models/Friend/GetContractDetail.go:136–142`).

The **actual response type** is `GetContactResponse.ContactList[]` → **`ModContacts`**, not singular `ModContact`:

- `Cilent/mm/mm123.proto:2727–2746`: request/response definitions, including per-contact `Ret[]`.
- `Cilent/mm/mm.pb.go:31498–31509`: compiled response struct.
- `Cilent/mm/mm.pb.go:20903–20975`: compiled `ModContacts`, including `CustomizedInfo` (wire field 42) and `ExtInfo` (wire field 54).
- `Cilent/mm/mm.pb.go:19467–19476` / `Cilent/mm/mm123.proto:1258–1263`: `CustomizedInfo` contains **`BrandFlag`, `ExternalInfo`, `BrandInfo`, `BrandIconURL`**; the information fields are strings, not typed menu trees.

Accordingly, raw HTTP response data can expose `Data.ContactList[].CustomizedInfo.ExternalInfo`, `Data.ContactList[].CustomizedInfo.BrandInfo`, and `Data.ContactList[].ExtInfo` when present. **The examined source neither parses these into menu buttons nor establishes that any particular field contains a current menu.** The possibility that one opaque string contains menu metadata is a lead for later, explicitly authorized verification, not a finding of working menu retrieval. There is no local evidence establishing its JSON/XML shape or universal availability; none is invented here.

`models/Tools/GetContact.go:17–132` is another implemented CGI-182 helper using `Wxid`/`UserNameList`, with compression enabled. There is **no `/api/Tools/GetContact` controller route** in the inspected Tools controller/route table; the public contact-detail route above is the demonstrated HTTP entry point.

### Freshness and persistence boundary

`GetContractDetail` makes a request rather than satisfying it from the local directory. Its `observedAt` timestamp (`models/Friend/GetContractDetail.go:88–89`) is a local observation timestamp, not an official-menu version or expiry guarantee. Inspect both native base status and the per-contact `Ret[]`, returned username, and actual field presence; an outer success alone does not prove that a complete target menu arrived.

The contact persistence layer deliberately whitelists fields and **does not persist `CustomizedInfo`, `ExternalInfo`, `BrandInfo`, or `ExtInfo`**: see complete extraction functions `srv/contactstore/capture.go:170–238`. Therefore the current directory store is not a menu cache, and directory synchronization/observation timestamps cannot be treated as menu freshness guarantees. Do not equate “field absent / not persisted / request rejected” with “this account has no menu.”

### Dedicated profile/menu schema: no executable request path

`Cilent/mm/mm123.proto:3177–3258` defines:

- `BizProfileV2Req`: `BaseRequest`, **`bizUserName`, `actionType`, `offset`, `pageSize`, `tmplControlFlag`, `bizSessionId`, `scene`**.
- `BizProfileV2Resp`: `BaseResponse`, account/base/brand/message/video data, **`serviceInfo`**, function flags, and notification information.
- `BizServiceInfo.menuInfo` → `BizServiceMenu`: **`uin`, `interactiveMode`, `updateTime`, `buttonList`, `version`, `type`**.
- `BizServiceMenuButton`: **`id`, `type`, `name`, `key`, `value`, `subButtonList`, `acttype`, `nativeUrl`**. `subButtonList` is **repeated bytes**, not a declared recursive button message.

The generated counterparts are `Cilent/mm/mm.pb.go:36060–36280,36652–36887`. These declarations describe potential wire data only. The empty model file supplies no request marshalling, CGI number/URL, dispatcher call, response decoding, action-type values, version negotiation, or recursive submenu decoder. **None of those missing pieces can be inferred merely from these definitions.** Even the schema's `updateTime`/`version` do not establish a usable refresh strategy because this response is not fetched by an implemented menu endpoint.

## 3. Activation: a click schema is not a click capability

`Cilent/mm/mm123.proto:3139–3175` declares:

- `ClickCommandRequest`: **`BaseRequest`, `clickTyp`, `clickInfo`, `bizUserName`, `msgSource`, `scene`, `sessionid`, `sessionStat`, `settingPageInfo`**.
- `ClickCommandResponse`: **`BaseResponse`, `wuRaoTips`**; tips have a send flag and wording/action wording.
- `SessionStat`: stay/unread durations, total unread count, latest message type, session-list index, mass-send/template unread counts.

There is no model constructing or sending this request and no exposed handler consuming it. The schema supplies no enum mapping for `clickTyp` or format contract for `clickInfo`; it would be unjustified to guess “menu key → clickInfo” or a CGI URL/number. **There is no verified event acknowledgment, downstream official-account reply, or activation test.**

Two tempting substitutes are explicitly different:

- **Status notification:** `models/Report/statusnotify.go:13–64` sends `StatusNotifyRequest` with fixed `code=2`, self/target usernames, and a timestamp-derived client message ID to **CGI 251 `/cgi-bin/micromsg-bin/statusnotify`**. It discards the returned body and errors and returns no result. Its schema (`Cilent/mm/mm123.proto:3613–3632`) is not `ClickCommandRequest` and has no menu-key field. It is invoked before ordinary sends (`models/Msg/SendNewMsg.go:49–50`), not an implemented menu-click route.
- **Sending text/XML:** `models/Msg/SendNewMsg.go:38–145` constructs `NewSendMsgRequest`/`ChatInfo` and sends **CGI 522 `/cgi-bin/micromsg-bin/newsendmsg`**. Text containing a button label, key, or fabricated event XML is still a different request. No source maps such content to an official-account menu event.

These are self-session protocol operations, not publisher menu management. Existing model parameters load the logged-in user's session by `Wxid`; `Appid` in the OAuth/mini-program helpers is a target application identifier. Nothing in these routes grants that self account publisher privileges to create/edit another account's menu. Conversely, the hypothetical ability to use publisher-side management APIs would not prove this client can activate menus as an ordinary subscriber. No management API was called or externally researched in this audit.

## 4. Separate action types: what existing code actually does

“Activate a menu” must be split by the button's action; the following implementations are **adjacent primitives, not a menu dispatcher**.

| Action class | Implemented source trace / payload | Limit of the evidence |
| --- | --- | --- |
| Web URL / URL-key resolution | `POST /api/Tools/GetA8Key` → `controllers/Tools.go:60–83` → `models/Tools/GetA8Key.go:14–120`. Payload: `Wxid`, `OpCode`, `Scene`, `CodeType`, `CodeVersion`, `ReqUrl`, `CookieBase64`, `NetType`, `Flag`. Sends `GetA8KeyReq` via **CGI 233 `/cgi-bin/micromsg-bin/geta8key`** and decodes `GetA8KeyResp`. | This resolves/authorizes a supplied URL; it neither obtains a menu nor emits a demonstrated click event nor renders a webpage. The main helper actually hardcodes protobuf `Flag=0` despite accepting `Flag`. Controller “default” values are documentation, not injected defaults. |
| MP article URL-key resolution | `POST /api/OfficialAccounts/MpGetA8Key` → `controllers/OfficialAccounts.go:65–88` → `models/OfficialAccounts/MpGetA8Key.go:13–124`. Input `Wxid`, `Url`; fixed `OpCode=2`, `CodeType=0`, `CodeVersion=0`, `NetType=WIFI`; **CGI 238 `/cgi-bin/micromsg-bin/mp-geta8key`**. | The controller binds `MpGetA8Key`, not the differently parameterized `MpGetA8KeyNew` in the neighboring file. The wrapper reports success after decoding without inspecting native base status. Article URL handling does not prove menu activation. |
| OAuth web action | `POST /api/OfficialAccounts/OauthAuthorize` → `controllers/OfficialAccounts.go:140–163` → full `models/OfficialAccounts/OauthAuthorize.go:15–112`. Input **`Wxid`, `Url`, `Appid`**. First calls GetA8Key with `OpCode=2`, `Scene=4`, `CodeType=19`, `CodeVersion=10`; builds an OAuth URL with fixed **`scope=snsapi_base`, `state=123`**; packs `OauthAuthorizeReq` with empty `BizUsername`, scene 4; **CGI 1254 `/cgi-bin/mmbiz-bin/oauth_authorize`**. | A real authorization attempt, not passive menu reading or a browser session. It does not preserve arbitrary original menu OAuth scope/state, does not check the first call's success before using its data, and reports outer success after decode without checking native base status. No complete consent/redirect/browser flow was verified. |
| Web JSAPI preverification | `POST /api/OfficialAccounts/JSAPIPreVerify` → `controllers/OfficialAccounts.go:165–188` → `models/OfficialAccounts/JSAPIPreVerify.go:14–105`; **CGI 1093 `/cgi-bin/mmbiz-bin/jsapi-preverify`**, input `Wxid`, `Url`, `Appid`. | Hardcodes the requested JSAPI list to **`startTempSession`**, a fixed nonce, and empty signature/signature method. Not a general JS bridge, menu click, QR scanner, or location-permission implementation. |
| Mini-program target | `POST /api/Wxapp/JSLogin` → `controllers/Wxapp.go:15–37` → `models/Wxapp/JSLogin.go:13–101`; input **`Wxid`, `Appid`**, fixed `LoginType=1`, `VersionType=0`, external scene 1001/source environment 1; **CGI 1029 `/cgi-bin/mmbiz-bin/js-login`**. | Authorizes and decodes `JSLoginResponse`, not a mini-program renderer or menu-to-page launch. Request parameters expose no selected button/page path. Native base status and nested JSAPI status are not validated by this wrapper. |
| QR action | `POST /api/Wxapp/QrcodeAuthLogin` is registered at `routers/commentsRouter_controllers.go:1496–1503`; full model `models/Wxapp/QrcodeAuthLogin.go:13–132`. Input **`Wxid`, `Url`**; accepts a connect-confirm URL or treats input as its UUID; calls GetA8Key, then POSTs `s=1` and GETs a confirmation URL with **`snsapi_login=on&allow=allow`**. | This is an active **login-approval flow**, not generic QR scanning or a menu scan-result event. Never call it to “test whether a menu works.” Its final result even combines `Code=0` with `Success=false`; no success claim is based on it here. |
| Location action | `POST /api/Msg/ShareLocation` → `controllers/Msg.go:532–562`, parameter fields `models/Msg/Util.go:11–20`: **`Wxid`, `ToWxid`, `X`, `Y`, `Scale`, `Label`, `Poiname`, `Infourl`**. Constructs location XML and calls `SendNewMsg`. | Not location permission acquisition or a menu-bound location event. The controller hardcodes **`Type=42`** and ignores the provided `Infourl` in its XML; this audit does not validate that as a working location message. Its existence must not be advertised as menu-location support. |

Response bodies matter:

- `GetA8KeyResp` (`Cilent/mm/mm123.proto:851–875`) can contain `FullURL`, `A8key`, `ActionCode`, JSAPI permissions/control bits, headers, cookie, and `MenuWording`. **`MenuWording` is one string, not a bottom-menu button tree.** A returned URL may carry sensitive account-bound credentials and is not evidence that a normal browser has the same session or native permissions.
- `OauthAuthorizeResp` (`:3739–3748`) includes scope data, redirect URL, and recent/silent/confirmation flags; decoding it is not the same as completing the requested action.
- `JSAPIPreVerifyResponse` (`:3764–3771`) includes both `BaseResponse` and `jsapiBaseresponse` plus verify/domain data.
- `JSLoginResponse` and `JSAPIBaseResponse` (`:2993–3011`) include native/nested status, code, openid/session data and lifespan. Authorization credentials are not a menu definition or proof of mini-program launch.

## 5. Transport and protocol-specific constraints

The implemented protocol helpers above marshal protobuf and supply account/session/device fields to `comm.SendRequest`. The complete function at **`comm/Mmtls.go:67–112`** packs via `Algorithm.Pack`, dispatches HTTP/MMTLS, handles short native errors, and decrypts a business response before the model unmarshals it. **`Algorithm/Pack.go:267–348`** performs compression/AES selection, writes CGI/UIN/cookies and a protocol header, and invokes native `v08.Rqtx`.

Relevant limits, without inventing unsupported policy:

1. These are **logged-in client-session operations**, not anonymous HTTP menu reads. Stored session and device/protocol compatibility are necessary; local source cannot establish live WeChat acceptance. `comm/Redis.go:455–475` can return a zero-value login record with nil error when storage lookup fails, so an `err == nil` check alone in older helpers is not proof of a usable login.
2. `Algorithm.Pack` writes **`IPhoneVersion` in the outer header** (`Algorithm/Pack.go:294–302`), while request `BaseRequest.ClientVersion`/`DeviceType` come from the saved account. This audit does not establish cross-platform equivalence for Android/Windows/macOS sessions. The code inspected contains **no menu-specific device/version allow-list or tested compatibility matrix**; absence of such a guard is not universal support.
3. No source evidence establishes which official accounts require subscription, which service accounts expose which menus, button-type numeric meanings, click/report prerequisites, per-account entitlement, rate limits, or current upstream policy. These remain **unknown**, not bypassed by existing schema fields.
4. The hardcoded action/scene/scope values documented above constrain those helpers. A generic bottom-menu dispatcher cannot treat arbitrary URL/OAuth/mini-program/QR/location buttons as interchangeable.
5. At A the transport protects a list of core writes from replay (`comm/Mmtls.go:114–140`), but that list does not include the OAuth/JSAPI/mini-program CGI paths above. Its MMTLS error-recovery path can retry unprotected requests (`:142–162`). This is another reason not to probe authorization helpers casually or assume a future menu event is automatically replay-safe.

## 6. A versus v6.0.16: what changed and what did not

Verified with local read-only `git diff v6.0.16 HEAD -- <paths>` and `git show v6.0.16:<path>`; no checkout or stash.

**Byte-identical between A and B:** `controllers/OfficialAccounts.go`, `controllers/Tools.go`, `controllers/Friend.go`, `controllers/Wxapp.go`, `controllers/Report.go`, `models/OfficialAccounts/`, `models/Report/`, `models/Wxapp/`, `routers/`, `Cilent/mm/mm123.proto`, `Cilent/mm/mm.pb.go`, `Algorithm/Pack.go`, `Algorithm/Util.go`, `baseinfo/basedefine.go`, and `srv/contactstore/capture.go`.

Consequences: B has the **same empty BizProfileV2 placeholder, no routed menu retrieval/click operation, same menu/click schemas, same version literal `869`, same auxiliary action limitations**, and no directory-menu persistence. The now runtime-identified A does **not** add menu capability over the earlier v6.0.16 baseline.

Relevant differences:

- `models/Friend/GetContractDetail.go`: same CGI/request/response body; A uses injectable transport/login aliases and `friendReadResult` to require native base success. B returns outer success after unmarshalling. A still returns the raw response including per-contact statuses.
- `models/Tools/GetContact.go` and `models/Tools/GetA8Key.go`: same request packing and native endpoints; A adds native-base-status validation via `directoryToolResult` (`A:models/Tools/GetContact.go:22–33`), replacing B's unconditional success wrappers. This does not introduce menu retrieval or clicking.
- `comm/Mmtls.go`: A uses checked business packet decoders, rejects empty decrypted responses, and automatically protects selected writes from replay; B lacks those changes. Transport hardening is not new menu support.
- OfficialAccounts and Wxapp authorization wrappers **remain unchanged**, including their incomplete native-status validation. Do not generalize A's improved GetA8Key/contact success checks to every helper.

## Decision boundary

For menu capability alone, the evidence supports **“not implemented as an end-to-end exposed feature; contact metadata and several adjacent URL/auth primitives exist.”** It does not support either “all menus work” or “the underlying WeChat protocol can never support them.”

Any future validation would need separate explicit authorization and evidence for (a) a current, sanitized menu definition for the target/self-account context, (b) a real request implementation and known field semantics for the selected action type, and (c) native response plus action-specific outcome. This audit performed none of those live actions. Classification and WebUI/SDK design are intentionally out of scope for this file.
