# 董俊叶的书房

以明亮的三维书房展示项目、经历和个人成长。物件可直接打开内容，目录提供快捷入口；中英文独立切换，中文界面只保留必要的项目与技术专名。

## 本地预览

在仓库根目录运行：

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

打开 [本地网站](http://127.0.0.1:8765/)。项目为原生 HTML、CSS、JavaScript ES 模块，无需安装依赖或构建；GitHub Pages 从仓库根目录发布，保留 `.nojekyll`。

宽度至少 1024px 且高度至少 720px 时显示双页书册；其他尺寸采用连续阅读。切换语言和调整窗口会保留对应章节。手机和平板将场景、介绍分区呈现。

## 内容与源码

- `assets/content.js`：个人事实、双语文案和项目定义。项目正文分别由 `ui.projectSummaries`、`projectContributions`、`projectOutcomes` 承载；`flows` 定义流程示意，`techLabels` 翻译通用技术类别。项目对象保留 `id`、`title/titleKey`、`roleKey`、`date`、`tech` 和可选 `href`。
- `assets/app.js`：语言、路由、热点、目录、阅读器及焦点管理。阅读器以 `data-chapter` 记录章节，模式由统一的媒体条件决定。
- `assets/room.js`：原创 Three.js 场景、物件、日光与本地化纹理；无运行时 CDN。场景静止时停止渲染，阅读和切换到后台时暂停。
- `assets/style.css`：统一色彩、字体、间距、双页/连续阅读与减少动态效果。
- `assets/fallback.js`：从同一内容源生成当前语言的完整打印文档。
- `index.html`：页面入口及不依赖 JavaScript 的完整中文文档。修改个人事实时，同步更新此处后备正文和元信息。
- `assets/poster-anchors.js`：与横竖后备图一同生成的热点坐标，不单独手改。
- `assets/vendor/`：Three.js 0.180.0 本地模块；许可证见 `THREE-LICENSE.txt`。

保留七个项目 ID、四个公开源码链接和全部既有路由。示例：`#project/anchorcell`；目录为 `#projects`、`#about`、`#experience`、`#learning`、`#contact`。`#featured`、`#case-notes`、`#education` 继续兼容。

语言参数 `?lang=zh` 或 `?lang=en` 优先于本地偏好，默认中文，例如 `?lang=en#project/anchorcell`。WebGL 不可用或丢失时保留静态场景与内容入口；入口模块失败或关闭 JavaScript 时显示完整文档。

## 浏览器回归

需 Node 22+，先启动上述本地服务器，再启动独立 Chrome：

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --remote-debugging-port=9224 \
  --user-data-dir=/tmp/connerald-browser-regression about:blank
```

在另一终端运行：

```sh
CHROME_DEBUG_URL=http://127.0.0.1:9224 node tests/browser-regression.mjs
```

脚本创建并关闭自己的测试页面，不复用日常标签页。25 组检查覆盖旧版闪烁修复、双语深链接、13 种视口、翻页、位置保持、焦点、打印及故障降级。可通过 `REGRESSION_FILTER` 定点运行自包含检查。

## 更新视觉资源

场景调整并通过检查后，在同一服务器和独立 Chrome 运行期间执行：

```sh
CHROME_DEBUG_URL=http://127.0.0.1:9224 node tests/capture-previews.mjs
```

该命令保存桌面、手机和双语书页截图，并同步导出 `room-landscape.webp`、`room-portrait.webp`、`poster-anchors.js`、`og.png`。后备图使用不含可翻译文字的场景，导出后恢复当前语言。加载采样与异常记录保存在 `docs/previews/measurements.json`。

详见 [本轮验收与前后对照](docs/verification.md)。原始设计来源见 [参考观察记录](docs/reference-observations.md)。本轮验证在本地完成，未执行远程推送或部署。
