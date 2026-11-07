# 固定的 puppet 制品

当前开发工作区使用以下**本地待发布开发包**，用于修复微信登录等待全量联系人同步的问题：

- 文件：`wx2tg-puppet-6.0.18-dev.1.tgz`
- 来源仓库：`https://github.com/finalpi/wx2tg-puppet`
- 唯一维护分支：`v6`（dev 是 tag 后缀，不是分支）
- 来源提交：`ab26768e92e14889a1039745c96d6779e1dd3c38`
- 包版本：`6.0.18-dev.1`
- 计划标签：`v6.0.18-dev.1`，尚未创建或推送，尚未发布 npm。
- SHA-256：`00a9239e4fc723c87b008a823b5c3bd1cd59ef5168f272002154dd21e1a7f725`
- npm SHA-512 integrity：由 npm 生成并保存在 `package-lock.json`，`npm ci` 和 `test/release.test.cjs` 验证，不手填。

由上述源码完成测试、构建、提交后执行 `npm pack` 生成，不是修改 `node_modules` 得到的补丁，不包含配置凭据或真实消息。`package.json` 精确依赖 `6.0.18-dev.1`，lockfile 解析到本目录；即使 registry 尚未发布，构建也可以重现。

当前正式版仍为 SDK `6.0.17`，原制品不变：

- 文件：`wx2tg-puppet-6.0.17.tgz`
- 来源提交：`f13313245ab791585fcdccfa16f3634c95e869c5`，标签 `v6.0.17`
- SHA-256：`e9b38f8c2b6c9e39ffd6d3e740c03f290a08eb955d77e844c8560ab6769297d7`

目录内旧包作为历史参考保留，不参与当前工作区安装。已发布 Bot `v6.0.40-dev.3` 的 SDK 仍是 `6.0.17`，不能通过覆盖旧制品让该不可变标签偷偷获得修复。

后续获准发布时才推送新 tag；SDK 工作流会执行 npm 发布并核验 registry。若认证失败，不能仅凭本地打包成功判断已发布。完整规则见 [发行说明](../docs/releases.md)，本次根因与验证见 [登录启动诊断](../docs/diagnostics/login-contact-sync.md)。
