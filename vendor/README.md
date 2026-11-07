# 固定的 puppet 制品

Bot `v6.0.40-dev.4` 使用以下**开发包**，包含登录 / 后台联系人同步修复，以及安全的公众号服务类型和菜单元数据：

- 文件：`wx2tg-puppet-6.0.18-dev.1.tgz`
- 来源仓库：`https://github.com/finalpi/wx2tg-puppet`
- 唯一维护分支：`v6`（dev 是 tag 后缀，不是分支）
- 来源提交：`9d40313f726376a145002e4617ea7df3c13cda1e`
- 包版本：`6.0.18-dev.1`
- 对应开发标签：`v6.0.18-dev.1`，npm 发布状态以工作流和 registry 核验为准。
- SHA-256：`7d831c7edfc9d85223ee14a6d70c90d008b94030551e1b0e968f29d5c6ebc1d7`
- npm SHA-512 integrity：由 npm 生成并保存在 `package-lock.json`，`npm ci` 和 `test/release.test.cjs` 验证，不手填。

由上述源码完成测试、构建、提交后执行 `npm pack` 生成，不是修改 `node_modules` 得到的补丁，不包含配置凭据或真实消息。`package.json` 精确依赖 `6.0.18-dev.1`，lockfile 解析到本目录；即使 registry 尚未发布，构建也可以重现。

当前正式版仍为 SDK `6.0.17`，原制品不变：

- 文件：`wx2tg-puppet-6.0.17.tgz`
- 来源提交：`f13313245ab791585fcdccfa16f3634c95e869c5`，标签 `v6.0.17`
- SHA-256：`e9b38f8c2b6c9e39ffd6d3e740c03f290a08eb955d77e844c8560ab6769297d7`

目录内旧包作为历史参考保留，不参与当前工作区安装。已发布 Bot `v6.0.40-dev.3` 的 SDK 仍是 `6.0.17`，不能通过覆盖旧制品让该不可变标签偷偷获得修复。

本轮按用户授权发布开发 tag，不更新稳定通道、不代用户部署；SDK 工作流会执行 npm 发布并核验 registry。若认证失败，不能仅凭本地打包成功判断已发布。完整规则见 [发行说明](../docs/releases.md)，本次根因与验证见 [登录启动诊断](../docs/diagnostics/login-contact-sync.md)。
