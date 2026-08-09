# Image2Diagram

图片转可编辑图表 Web MVP：上传任意 PNG / JPG / JPEG / WEBP，输出原生 draw.io XML、PPTX 和 Mermaid，并提供左右预览。

## 启动

```bash
npm install
npm run dev
```

打开终端显示的本地地址即可使用。

## GitHub Pages

推送到 `main` 分支后，`.github/workflows/deploy-pages.yml` 会自动构建并发布到：

```text
https://alanpeople.github.io/image2diagram/
```

网页端 API Key 仅保存在当前浏览器；生产环境不要把服务商 API Key 写入代码或仓库。

## 命令行转换

```bash
npm run image2drawio -- "图片路径" "输出路径.drawio"
```

项目不内置任何输入图片或样例输出。未配置识别引擎时，程序会生成可编辑的原生结构骨架；配置 OpenAI-compatible VLM 后，会按结构化 JSON 提取文字、形状、颜色、布局和连线，不会把整张图片嵌入 draw.io。

在网页“识别引擎配置”中填写 Endpoint、Model 和 API Key。支持能接受 `image_url` 多模态消息并返回 JSON 的 VLM 服务。

## 验证

```bash
npm run build
node "%USERPROFILE%/.codex/skills/drawio/scripts/cli.js" output.drawio output-validated.drawio --input-format drawio --validate
```

项目使用已安装的 `drawio` skill 进行 draw.io 结构校验；PPTX 使用 PptxGenJS 生成，Mermaid 从同一份结构化图数据生成。
