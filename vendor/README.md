# 固定的 puppet 发行制品

- 文件：`wx2tg-puppet-6.0.12.tgz`
- 来源仓库：`https://github.com/finalpi/wx2tg-puppet`
- 来源分支：`v6`
- 来源提交：`f0d8af1db4cc64afad721f6aa7d78f7b34256a37`
- 对应本地 Git 标签：`v6.0.12`
- 包版本：`6.0.12`
- SHA-256：`870eaea0dcfa1bcae01e1c5e0ef353d5c9420cbd07c100a6e8213436eed1810c`
- npm SHA-512 integrity：由 `package-lock.json` 记录，`npm ci` 和 `test/release.test.cjs` 会验证。

这是从上述源码提交执行 `npm test`、`npm pack` 生成的完整 npm 包，已验证重新打包与本文件逐字节相同。不是从 `node_modules` 手工修改或拼装的制品；不包含配置凭据或真实消息。

保留本文件是为了在 npm `6.0.12` 尚未发布时保持 bot 可重现构建。`package.json` 精确依赖 `6.0.12`，lockfile 将它解析到本目录。必须保留 lockfile 和此制品；不要改用尚不存在的 registry URL 或手填 integrity。

此记录说明本地来源，不代表该提交、Git 标签或 npm 包已经发布远程。更新方法与正式发布顺序见 [发行规则](../docs/releases.md)。
