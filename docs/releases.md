# 三仓库统一发行规则

## 当前配套版本：v6.0.12

| 仓库 | 维护分支 | Git 标签 | 包 / 镜像 |
| --- | --- | --- | --- |
| `wechat2tg` | `v6` | `v6.0.12` | 包版本 `6.0.12`；`finalpi/wechat2tg-v3:v6.0.12` |
| `wx2tg-puppet` | `v6` | `v6.0.12` | `wx2tg-puppet@6.0.12` |
| `wx2tg-server`（源码仓库 `fk-zhang`） | `v6`，继承 `875` | `v6.0.12` | `finalpi/wx2tg-server:v6.0.12` |

本轮只准备本地提交、标签和制品，没有执行远程推送、npm 发布、Docker 发布或部署。**本地存在标签，不等于对应远程镜像可以拉取。** `v7` / server `878` 本轮不改动。

## 以后怎么编号

- `v6` / `v7` 分支表示兼容系列；完整 Git 标签为 `v6.x.y` / `v7.x.y`。
- 同一套发行在三个仓库打相同的完整标签。修复递增 patch，向后兼容功能递增 minor，跨兼容系列使用新的 major。
- npm / `package.json` / 根目录 `VERSION` 使用不带 `v` 的版本，如 `6.0.12`；Git 和 Docker 标签带 `v`。
- bot 精确依赖同版本 puppet，不用 `^`、`~` 或 `latest`。部署默认固定两个镜像的完整版本，避免滚动标签各自更新时混装。
- `v6-latest` 仅是对应镜像仓库的 v6 滚动别名；稳定完整版本标签构建才更新它。v7 使用自己的别名，不能覆盖 v6。不要再写跨主版本的全局 `latest`。
- 手动 Docker 构建只允许 `v6` 分支，发布 `v6-dev-<短 SHA>`，不覆盖稳定标签。
- 原来的 `wx2tg-v3` / `860-v3` / `875` 分支和 `3.x`、`v51.*`、裸 `v6` / `v7` 标签保留，不删除、不移动。新发布不用裸主版本标签。server 同时有历史 `refs/tags/v6` 和新 `refs/heads/v6`，脚本中请写完整 ref，避免歧义。

## npm 未发布时如何保持 bot 可构建

本仓库 `vendor/wx2tg-puppet-6.0.12.tgz` 是同版本 puppet 源码构建后的 npm 包，不是修改 `node_modules` 得到的补丁。

- `package.json` 仍精确声明 `wx2tg-puppet: "6.0.12"`。
- `package-lock.json` 将该版本解析到仓库内 `file:vendor/wx2tg-puppet-6.0.12.tgz`，记录 npm 实际计算的 SHA-512 integrity。
- `npm ci` 和 Docker 都使用该固定制品，不依赖尚未发布的 registry 版本。Docker 在安装依赖前复制 `vendor/`。
- 保留 lockfile；删除它重新解析会尝试访问 npm 上的 `6.0.12`，在正式发布前可能失败。
- `vendor/README.md` 记录来源与校验值；新发行重打包后必须更新 lockfile 和校验值。

重新打包/更新锁定的流程（会改本地文件，但不会发布）：

```sh
# 在 wx2tg-puppet 仓库
npm ci
npm run check:version
npm test
npm pack --pack-destination ../wechat2tg/vendor

# 在 wechat2tg 仓库
npm install --package-lock-only --ignore-scripts ./vendor/wx2tg-puppet-6.0.12.tgz
npm pkg set dependencies.wx2tg-puppet=6.0.12
npm install --package-lock-only --ignore-scripts --offline
npm ci
npm run check:version
npm test
```

正式发布 npm 后，可在**新的提交**中显式切换到 registry 来源并重新生成/校验 lockfile；不要凭空填写下载地址和 integrity，也不要为了改变制品而移动已存在的 Git 标签。

## 发布前检查

1. 三个仓库根目录 `VERSION` 一致。
2. bot / puppet 的包版本、lockfile 根版本和 bot 的 puppet 依赖一致：各自运行 `npm run check:version`。
3. 运行 puppet 和 bot 的 `npm test`，核对 bot 安装的是本次 puppet 制品；运行 server 的 `bash scripts/check-release-version.sh` 和 `go test ./buildinfo`。
4. `GITHUB_REF_TYPE=tag GITHUB_REF_NAME=v6.0.12` 下运行版本检查应通过；错误标签必须失败。
5. 审查差异并提交，只选择本次文件，尤其不要带入 server 工作区已有的测试修改、样本消息或私有配置。
6. 创建三个仓库的本地注释标签 `v6.0.12`，检查指向的提交；不使用 `-f`，不覆盖同名标签。

## 真正发布的顺序（需另行确认）

1. 完成真实微信/Telegram 的必要验收。离线回归通过不等于线上全链路验收完成。
2. 明确授权后发布 puppet npm 包或确认继续使用固定本地制品；发布时应核对与已测试制品内容一致。
3. 明确授权后推送三个仓库的 `v6` 分支及指定完整标签。**bot/server 标签推送会触发 CI 发布镜像；server 还会创建 GitHub Release。** 不能把 tag push 当成纯备份操作。
4. 等待所有配套制品成功后，再安排部署，不自动重启或迁移任何远程环境。

puppet 的测试不使用真实账号；本次 server 仅改发行元数据，没有改变数据库或回调业务逻辑。消息存储、callback 配置及可靠性边界见 [v6 配置与消息链路](server-v6.md)。
