# 董俊叶的个人主页

一间可以探索的个人书房，展示数据工程、AI Agent、储能安全与风险分析相关项目，以及个人介绍、实习经历、学习记录和联系方式。支持中英文切换、物件提示、内容目录和书本阅读。

## 本地预览与部署

在仓库根目录运行：

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

打开 [本地预览](http://127.0.0.1:8765/)。项目使用原生 HTML、CSS、JavaScript ES 模块，无需安装依赖或执行构建；通过 GitHub Pages 从仓库根目录发布，保留 `.nojekyll`。

## 文件结构

- `index.html`：页面入口、目录与阅读面板容器，以及不依赖 JavaScript 的完整 HTML 内容。
- `assets/room.js`：原创程序化 Three.js 场景，使用几何体与 Canvas 纹理构建房间和物件。
- `assets/app.js`：页面状态、语言、路由、目录和阅读器；与三维场景使用同一组内容 ID。
- `assets/content.js`：双语个人资料、界面文案、七个项目记录及场景入口 ID。
- `assets/style.css`：房间界面、书本阅读、移动端与减少动态效果样式。
- `assets/vendor/`：本地 Three.js 0.180.0 模块；MIT 许可见 `assets/vendor/THREE-LICENSE.txt`。
- `assets/room-landscape.webp`、`assets/room-portrait.webp`：从实际场景导出的横版、竖版静态后备图；`og.png` 用于社交分享。

## 修改内容

在 `assets/content.js` 的 `translations.zh` / `translations.en` 中同步修改个人资料，在 `ui.zh` / `ui.en` 中修改界面文案。项目由 `projects` 数组定义，使用稳定的 `id`、文案键、时间、技术列表和可选公开链接；保留已有 ID 可以维持已分享链接有效。

项目路由示例：`#project/anchorcell`；目录入口包括 `#projects`、`#about`、`#experience`、`#learning` 和 `#contact`。新增场景入口时，同步更新 `entryIds`、双语 `entryLabels` 和 `room.js` 中对应物件。修改实质个人资料时，也同步维护 `index.html` 中的静态 HTML 后备内容与页面元信息。

语言参数为 `?lang=zh` 或 `?lang=en`，优先于本地保存的 `site-language` 偏好，默认中文；例如 `?lang=en#project/anchorcell`。

## 降级与参考

界面尊重系统 `prefers-reduced-motion` 设置。WebGL 无法启动时保留静态房间、内容入口和阅读器；JavaScript 不可用时显示完整 HTML 内容。

视觉与交互参考的实际观察过程见 [参考网站观察记录](docs/reference-observations.md)。房间、物件和项目示意为本项目制作，个人事实来自原有主页。

## 验收与预览记录

见 [浏览器验收记录](docs/verification.md)，包括桌面、手机截图和 [实际翻页动画](docs/previews/book-turn.gif)。

闪烁问题的复现与修复结果见验收记录末尾。相关自动回归可运行 `node tests/browser-regression.mjs`；需要先启动本地服务器和独立 Chrome 调试配置，完整命令见测试文件头部。
