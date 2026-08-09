import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const [, , inputArg, outputArg] = process.argv

if (!inputArg) {
  console.error('用法: node scripts/image2drawio.mjs <图片路径> [输出.drawio]')
  process.exit(1)
}

const input = path.resolve(inputArg)
if (!fs.existsSync(input)) {
  console.error(`输入文件不存在: ${input}`)
  process.exit(1)
}

const output = path.resolve(outputArg || `${path.basename(input, path.extname(input))}.drawio`)
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, genericDrawio(path.basename(input)), 'utf8')
console.log(JSON.stringify({ input, output, method: 'native-generic-fallback', calibrated: false }, null, 2))

function xmlEscape(value) {
  return String(value).replace(/[<>&'"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[character]))
}

function genericDrawio(filename) {
  const title = xmlEscape(filename.replace(/\.[^.]+$/, ''))
  const stamp = Date.now()
  return `<mxfile host="app.diagrams.net" modified="${new Date().toISOString()}" agent="Image2Diagram"><diagram name="Image2Diagram 通用识别草图" id="image2diagram-${stamp}"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" page="1" pageScale="1" pageWidth="1200" pageHeight="800" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="bg" value="" style="shape=rectangle;fillColor=#FFFFFF;strokeColor=#FFFFFF;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="1200" height="800" as="geometry"/></mxCell><mxCell id="title" value="${title}" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;fontSize=28;fontStyle=1;fontColor=#0F172A;" vertex="1" parent="1"><mxGeometry x="200" y="80" width="800" height="60" as="geometry"/></mxCell><mxCell id="input" value="图片输入" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#E0F2FE;strokeColor=#0284C7;fontColor=#0C4A6E;fontSize=20;" vertex="1" parent="1"><mxGeometry x="120" y="320" width="240" height="100" as="geometry"/></mxCell><mxCell id="detect" value="本地几何识别" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#FEF3C7;strokeColor=#D97706;fontColor=#78350F;fontSize=20;" vertex="1" parent="1"><mxGeometry x="480" y="320" width="240" height="100" as="geometry"/></mxCell><mxCell id="output" value="可编辑 draw.io" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#DCFCE7;strokeColor=#16A34A;fontColor=#14532D;fontSize=20;" vertex="1" parent="1"><mxGeometry x="840" y="320" width="240" height="100" as="geometry"/></mxCell><mxCell id="e1" edge="1" source="input" target="detect" style="edgeStyle=orthogonalEdgeStyle;html=1;endArrow=open;strokeColor=#64748B;strokeWidth=2;" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell><mxCell id="e2" edge="1" source="detect" target="output" style="edgeStyle=orthogonalEdgeStyle;html=1;endArrow=open;strokeColor=#64748B;strokeWidth=2;" parent="1"><mxGeometry relative="1" as="geometry"/></mxCell><mxCell id="note" value="未配置 OCR / VLM：这是原生结构骨架，不是整图嵌入。" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;fontSize=14;fontColor=#64748B;" vertex="1" parent="1"><mxGeometry x="160" y="620" width="880" height="60" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>`
}
