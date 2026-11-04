# 固定的 puppet 发行制品

当前正式版使用：

- 文件：`wx2tg-puppet-6.0.15.tgz`
- 来源仓库：`https://github.com/finalpi/wx2tg-puppet`
- 唯一维护分支：`v6`（dev 是 tag 后缀，不是分支）
- 来源提交：`45d199bcfe64b5ba2d8d3015e2999d020e80672f`
- 对应发行标签：`v6.0.15`
- 包版本：`6.0.15`
- SHA-256：`5fe4d13286840b2a2b7d9f16702d118ecf3c9cbf57c4349220a8266d85db4f1f`
- npm SHA-512 integrity：由 `package-lock.json` 保存，`npm ci` 和 `test/release.test.cjs` 验证。

由上述源码执行测试、构建和 `npm pack` 生成，不是修改 `node_modules` 得到的补丁，不包含配置凭据或真实消息。当前 lockfile 仅使用这一正式版制品；目录内旧 `6.0.12` 包保留为历史参考，不参与当前安装。

保留制品是为了在 npm registry 尚未发布该版本时仍能重现构建。`package.json` 精确依赖 `6.0.15`，lockfile 将其解析到本目录；不要删除 lockfile 后改用不存在的 registry 地址，也不要手填 integrity。

这个来源记录不代表 npm registry 已发布。Git tag 工作流上传的是 npm 格式 Actions artifact，不会自动 npm publish。完整规则见 [发行说明](../docs/releases.md)。
