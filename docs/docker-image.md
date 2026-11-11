# Docker 运行镜像瘦身

自 `v6.0.41-dev.3` 起，开发依赖与编译工具不再进入最终运行镜像。保留 WebUI、MCP、自动化及媒体转换功能；不改变数据目录、端口、`npm start` 启动方式或发布通道。

## 构建与运行分离

- `builder-gifski` / `builder-lottie-to-png`：编译原有贴纸转换工具。
- `runtime-base`：Node 18 / Debian 运行基础，包含 FFmpeg、ffprobe、中文字体与原有媒体动态库。
- `builder-app`：在同一基础上安装编译器，按 lockfile 执行完整 `npm ci`，编译微信 SILK 编解码器、TypeScript 与 Vite 前端，然后裁剪开发依赖。
- `runtime`：从干净的 `runtime-base` 开始，只复制生产依赖、`dist`、版本元数据、MCP stdio 入口和媒体工具。不会复制构建阶段的 npm 缓存、编译器、源码、测试或 vendor 制品目录。

不能仅在原有最终镜像末尾增加 `npm prune`：更早镜像层中的文件仍会占用镜像空间。因此裁剪发生在构建阶段，最终镜像只复制裁剪后的结果。

TypeORM 的可选 `ts-node` peer 会让 npm 在 `--omit=dev` 后仍留下 TypeScript。运行镜像只执行已编译的 JavaScript，因此显式移除 `ts-node` / `typescript`，而不是使用 `--omit=optional` 误删 sharp 的平台二进制。仍被生产依赖使用的共享包不会因为也出现在 devDependencies 就被删除。

微信语音复用 SDK 的 lockfile 锁定 `wx-voice`，在构建阶段直接用 make 编译其 SILK encoder / decoder。保留 `wx-voice` 命令入口，不再额外全局安装第二份。生产镜像中不支持重新编译这些工具；需要开发或调试编译时使用源码工作区 / `builder-app` 阶段。

## 最终镜像验证

每次 Docker 构建都会在最终镜像中以 `--network=none` 执行 `scripts/test-docker-runtime.cjs`。脚本临时挂载而不打包进镜像，仅创建 `/tmp` 合成数据，检查：

- 前端开发依赖、TS 工具、编译器、npm 下载缓存与源码目录不在运行镜像中。
- SDK、Telegraf、TypeORM、MCP 可加载；SQLite 实际查询及 sharp 图片编码可用。
- QuickJS 独立 worker 能运行合成自动化脚本。
- 系统 FFmpeg / ffprobe 和应用的 ffmpeg-static 均可执行。
- 合成音频能完成 SILK 编码 → MP3 解码；合成 TGS 能转换成 GIF。
- WebUI `/chat`、`/manage`、Vite JS / CSS、表情资源、Service Worker、manifest 及鉴权配置接口可用。

没有真实微信 / Telegram 账号连接，没有挂载用户数据库，不向外部发送请求。amd64、arm64 的构建都会执行相同检查；本地 amd64 通过不等于 ARM 工作流已经通过。

本地复验（不部署、不推送）：

```sh
docker build --progress=plain -t wechat2tg-local:slim-verify .
docker run --rm --network=none --entrypoint node \
  --mount type=bind,src="$PWD/scripts/test-docker-runtime.cjs",dst=/tmp/check.cjs,readonly \
  wechat2tg-local:slim-verify /tmp/check.cjs
```

## 体积测量口径

在同一台 amd64 主机、同一份应用代码与 lockfile 下分别使用旧 Dockerfile 和多阶段 Dockerfile 构建，比较未压缩镜像层合计。合入 dev.2、更新版本为 dev.3 后的本地复测：

| 构建方式 | 未压缩层字节数 | MiB |
| --- | ---: | ---: |
| 旧 Dockerfile | 1,661,325,312 | 1,584.36 |
| 多阶段运行镜像 | 1,076,260,864 | 1,026.40 |
| 减少 | **585,064,448** | **557.96（35.22%）** |

这是本地实测而非远端镜像大小承诺。旧构建会把下载缓存也打进去，缓存内容、apt 包、基础镜像及压缩方式可能变化；不把某次测量当作所有架构或构建的固定大小。

```sh
docker history --no-trunc --human=false --format '{{.Size}}' IMAGE \
  | awk '{bytes += $1} END {printf "%d bytes; %.2f MiB\n", bytes, bytes / 1048576}'
```

Docker 的经典存储与 containerd image store 对 `image inspect .Size` / `image ls` 的展示口径可能不同；不能混用这些数字计算节省比例。镜像层大小也不是 registry 压缩下载量，不是考虑共享层之后的实际新增磁盘占用。

数据库、WAL、头像 / 附件缓存等挂载数据不包含在镜像里。本次不执行数据库压缩、镜像清理或 Docker builder prune；构建缓存仍可能占用构建机器磁盘。
