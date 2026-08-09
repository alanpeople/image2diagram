import PptxGenJS from 'pptxgenjs';

const STORAGE = { settings: 'image2diagram_ai_settings', history: 'image2diagram_history' };
const state = {
  files: [],
  results: [],
  history: loadHistory(),
  settings: loadSettings(),
  converting: false,
  completed: 0,
  toastTimer: null
};

const $ = (selector) => document.querySelector(selector);
const fileInput = $('#file-input');
const dropZone = $('#drop-zone');
const workbench = $('#workbench');
const fileQueue = $('#file-queue');
const resultsSection = $('#results-section');
const resultsList = $('#results-list');
const historySection = $('#history-section');
const historyList = $('#history-list');
const progressWrap = $('#progress-wrap');
const progressBar = $('#progress-bar');
const progressLabel = $('#progress-label');
const progressValue = $('#progress-value');
const toast = $('#toast');

hydrateSettings();
renderHistory();

function loadSettings() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE.settings) || '{}');
    return { endpoint: value.endpoint || '', model: value.model || '', apiKey: value.apiKey || '' };
  } catch {
    return { endpoint: '', model: '', apiKey: '' };
  }
}

function loadHistory() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE.history) || '[]');
    return Array.isArray(value) ? value.slice(0, 10) : [];
  } catch {
    return [];
  }
}

function saveHistory() {
  localStorage.setItem(STORAGE.history, JSON.stringify(state.history.slice(0, 10)));
}

function hydrateSettings() {
  $('#ai-endpoint').value = state.settings.endpoint;
  $('#ai-model').value = state.settings.model;
  $('#ai-api-key').value = state.settings.apiKey;
  updateEngineStatus();
}

function updateEngineStatus() {
  const configured = state.settings.endpoint && state.settings.model;
  $('#engine-status').textContent = configured
    ? `当前：VLM 结构化识别 · ${state.settings.model}`
    : '当前：本地几何识别（未配置 OCR/VLM，文字准确率有限）';
  $('#engine-status').classList.toggle('engine-ready', Boolean(configured));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function escapeXml(value) {
  return String(value ?? '').replace(/[<>&'"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[character]));
}

function safeFilename(value) {
  return String(value || 'diagram').replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]/g, '-').trim().slice(0, 80) || 'diagram';
}

function showToast(message, tone = 'default') {
  toast.textContent = message;
  toast.className = `toast ${tone}`;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => toast.classList.add('hidden'), 3600);
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function addFiles(fileList) {
  const accepted = [...fileList].filter((file) => /^(image\/(png|jpeg|webp))$/i.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name));
  const remaining = Math.max(0, 20 - state.files.length);
  const additions = accepted.slice(0, remaining).map((file) => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, file, previewUrl: URL.createObjectURL(file), status: 'queued' }));
  if (!accepted.length) showToast('请选择 PNG、JPG、JPEG 或 WEBP 图片', 'error');
  if (accepted.length > remaining) showToast('单次最多处理 20 张图片，超出部分未加入队列', 'error');
  state.files.push(...additions);
  workbench.classList.toggle('hidden', state.files.length === 0);
  renderQueue();
}

function removeFile(id) {
  const item = state.files.find((entry) => entry.id === id);
  if (item) URL.revokeObjectURL(item.previewUrl);
  state.files = state.files.filter((entry) => entry.id !== id);
  state.results = state.results.filter((entry) => entry.fileId !== id);
  workbench.classList.toggle('hidden', state.files.length === 0);
  renderQueue();
  renderResults();
}

function clearAll() {
  state.files.forEach((item) => URL.revokeObjectURL(item.previewUrl));
  state.files = [];
  state.results = [];
  workbench.classList.add('hidden');
  resultsSection.classList.add('hidden');
  progressWrap.classList.add('hidden');
  fileInput.value = '';
  renderQueue();
  renderResults();
}

function renderQueue() {
  fileQueue.innerHTML = state.files.map((item) => {
    const statusText = ({ queued: '等待转换', processing: '识别中…', done: '已完成', error: '失败' })[item.status] || '等待转换';
    return `<div class="queue-item ${item.status}"><img src="${item.previewUrl}" alt="" /><div class="queue-info"><strong>${escapeHtml(item.file.name)}</strong><span>${formatBytes(item.file.size)} · ${statusText}</span></div><div class="queue-status">${item.status === 'processing' ? '<span class="spinner"></span>' : item.status === 'done' ? '✓' : item.status === 'error' ? '!' : '·'}</div><button class="icon-button remove-file" data-id="${item.id}" type="button" aria-label="移除">×</button></div>`;
  }).join('');
}

function setProgress(done, total, label = '处理中…') {
  const percent = total ? Math.round((done / total) * 100) : 0;
  progressWrap.classList.remove('hidden');
  progressBar.style.width = `${percent}%`;
  progressValue.textContent = `${percent}%`;
  progressLabel.textContent = label;
}

async function readImageSize(file) {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: 1200, height: 800 };
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

function normalizeEndpoint(value) {
  const endpoint = String(value || '').trim().replace(/\/+$/, '');
  if (!endpoint) return '';
  return /\/chat\/completions$/i.test(endpoint) ? endpoint : `${endpoint}/chat/completions`;
}

const VLM_PROMPT = `你是一个技术图表结构化解析器。请分析用户上传的流程图、架构图、组织架构图、思维导图或时序图，并只返回 JSON，不要 Markdown，不要解释。
JSON schema:
{
  "confidence": 0-100,
  "canvas": {"width": number, "height": number, "background": "#RRGGBB"},
  "nodes": [{"id": "node_1", "label": "完整文字", "type": "rect|rounded|ellipse|diamond|parallelogram|document|text", "x": number, "y": number, "w": number, "h": number, "fill": "#RRGGBB", "stroke": "#RRGGBB", "fontSize": number, "fontColor": "#RRGGBB"}],
  "edges": [{"id": "edge_1", "source": "node_1", "target": "node_2", "label": "可选文字", "dashed": boolean, "arrow": boolean, "stroke": "#RRGGBB", "waypoints": [{"x": number, "y": number}]}]
}
要求：保留所有可读中文和英文；坐标使用图片左上角为原点；每个形状、文字框、连接线都是独立对象；没有把整张图片作为节点；无法判断的字段使用合理默认值。`;

const GEMINI_JSON_RULES = `Gemini 输出要求：不要输出思考过程、前缀、后缀或 Markdown 代码块；第一个字符必须是 {，最后一个字符必须是 }；只输出一个合法 JSON 对象。`;
const GEMINI_COMPACT_PROMPT = `请识别这张技术图表并只返回一个合法 JSON 对象。为了避免输出被截断：保留所有节点 label、type、x、y、w、h；连线保留 source、target、label、arrow；fill、stroke、fontSize、fontColor、waypoints 只有在原图明确需要时输出；直线不要输出 waypoints。不要输出 Markdown、思考过程、解释或注释。JSON 顶层必须包含 confidence、canvas、nodes、edges。`;

function isGeminiModel(model) {
  return /gemini/i.test(String(model || ''));
}

function textFromVlmPart(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(textFromVlmPart).join('');
  if (!value || typeof value !== 'object') return '';
  if (typeof value.text === 'string') return value.text;
  if (typeof value.content === 'string') return value.content;
  if (Array.isArray(value.parts)) return value.parts.map(textFromVlmPart).join('');
  if (Array.isArray(value.content)) return value.content.map(textFromVlmPart).join('');
  if (value.json && typeof value.json === 'object') return JSON.stringify(value.json);
  return '';
}

function extractVlmText(payload) {
  const candidates = [
    payload?.choices?.[0]?.message?.content,
    payload?.choices?.[0]?.text,
    payload?.candidates?.[0]?.content?.parts,
    payload?.candidates?.[0]?.content,
    payload?.candidates?.[0]?.text,
    payload?.output_text,
    payload?.text,
    payload?.result
  ];
  for (const candidate of candidates) {
    const text = textFromVlmPart(candidate);
    if (text.trim()) return text;
  }
  return '';
}

async function requestVlm(file, size) {
  const endpoint = normalizeEndpoint(state.settings.endpoint);
  if (!endpoint || !state.settings.model) throw new Error('未配置 VLM endpoint 或 model');
  const dataUrl = await fileToDataUrl(file);
  const gemini = isGeminiModel(state.settings.model);
  const attempts = gemini
    ? [
      { prompt: `${VLM_PROMPT}\n${GEMINI_JSON_RULES}`, detail: 'high' },
      { prompt: `${GEMINI_COMPACT_PROMPT}\n${GEMINI_JSON_RULES}`, detail: 'low' }
    ]
    : [{ prompt: VLM_PROMPT, detail: 'high' }];
  let lastError = null;

  for (const attempt of attempts) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(state.settings.apiKey ? { Authorization: `Bearer ${state.settings.apiKey}` } : {}) },
      body: JSON.stringify({
        model: state.settings.model,
        temperature: 0.1,
        max_tokens: 12000,
        messages: [{ role: 'user', content: [{ type: 'text', text: `${attempt.prompt}\n图片文件名：${file.name}\n图片尺寸：${size.width}x${size.height}` }, { type: 'image_url', image_url: { url: dataUrl, detail: attempt.detail } }] }]
      })
    });
    if (!response.ok) throw new Error(`VLM 请求失败：HTTP ${response.status}`);
    const payload = await response.json();
    const text = extractVlmText(payload);
    if (!text) throw new Error('VLM 没有返回结构化内容');
    try {
      return normalizeExtraction(parseJsonResponse(text), size);
    } catch (error) {
      lastError = error;
      if (gemini && attempt !== attempts[attempts.length - 1]) continue;
      const recovered = gemini ? recoverPartialDiagram(text) : null;
      if (recovered) return normalizeExtraction(recovered, size);
      throw error;
    }
  }
  throw lastError || new Error('VLM 转换失败');
}

function tryParseJsonValue(candidate) {
  let value = String(candidate || '').trim();
  for (let pass = 0; pass < 3; pass += 1) {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'string') {
        value = parsed.trim();
        continue;
      }
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      const relaxed = value.replace(/,\s*([}\]])/g, '$1');
      if (relaxed !== value) {
        value = relaxed;
        continue;
      }
    }
    break;
  }
  return null;
}

function balancedJsonCandidates(text) {
  const candidates = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === '{') {
      if (depth === 0) start = index;
      depth += 1;
    } else if (character === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return candidates;
}

function cleanVlmJsonText(text) {
  return String(text ?? '')
    .replace(/^\uFEFF/, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<analysis>[\s\S]*?<\/analysis>/gi, '')
    .replace(/```(?:json|jsonc|javascript|js)?/gi, '')
    .replace(/```/g, '')
    .trim();
}

function findJsonArray(text, key) {
  const keyIndex = text.indexOf(`"${key}"`);
  if (keyIndex < 0) return '';
  const start = text.indexOf('[', keyIndex);
  if (start < 0) return '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === '[') depth += 1;
    else if (character === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return text.slice(start);
}

function firstJsonNumber(text, key, fallback) {
  const match = text.match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`));
  return match ? Number(match[1]) : fallback;
}

function firstJsonString(text, key, fallback) {
  const match = text.match(new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`));
  return match ? match[1] : fallback;
}

function recoverPartialDiagram(text) {
  const cleaned = cleanVlmJsonText(text);
  const nodeArray = findJsonArray(cleaned, 'nodes');
  const nodes = balancedJsonCandidates(nodeArray)
    .map(tryParseJsonValue)
    .filter((node) => node && (node.id || node.label || node.text || node.type));
  if (!nodes.length) return null;

  const edgeArray = findJsonArray(cleaned, 'edges');
  const edges = balancedJsonCandidates(edgeArray)
    .map(tryParseJsonValue)
    .filter((edge) => edge && (edge.source || edge.target || edge.from || edge.to));
  return {
    _partial: true,
    confidence: firstJsonNumber(cleaned, 'confidence', 60),
    canvas: {
      width: firstJsonNumber(cleaned, 'width', 1200),
      height: firstJsonNumber(cleaned, 'height', 800),
      background: firstJsonString(cleaned, 'background', '#FFFFFF')
    },
    nodes,
    edges
  };
}

function parseJsonResponse(text) {
  const cleaned = cleanVlmJsonText(text);
  const direct = tryParseJsonValue(cleaned);
  if (direct) return direct;
  for (const candidate of balancedJsonCandidates(cleaned)) {
    const parsed = tryParseJsonValue(candidate);
    if (parsed) return parsed;
  }
  const snippet = cleaned.replace(/\s+/g, ' ').slice(0, 180);
  throw new Error(`VLM JSON 解析失败：Gemini 返回内容不是合法 JSON${snippet ? `（返回片段：${snippet}）` : ''}`);
}

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function safeId(value, fallback) {
  const id = String(value || fallback).replace(/[^A-Za-z0-9_-]/g, '_');
  return /^[A-Za-z]/.test(id) ? id : `node_${id}`;
}

function safeColor(value, fallback) {
  const color = String(value || '').trim();
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color.slice(0, 7) : fallback;
}

function normalizeType(type) {
  const value = String(type || 'rect').toLowerCase();
  if (value.includes('diamond') || value.includes('rhombus') || value.includes('decision')) return 'diamond';
  if (value.includes('ellipse') || value.includes('oval') || value.includes('circle')) return 'ellipse';
  if (value.includes('parallel') || value.includes('queue')) return 'parallelogram';
  if (value.includes('document')) return 'document';
  if (value === 'text' || value.includes('label') || value.includes('caption')) return 'text';
  if (value.includes('round') || value.includes('stadium')) return 'rounded';
  return 'rect';
}

function normalizeExtraction(raw, size) {
  const canvas = raw?.canvas || {};
  const width = Math.max(200, Math.round(finite(canvas.width, size.width)));
  const height = Math.max(200, Math.round(finite(canvas.height, size.height)));
  const nodes = (Array.isArray(raw?.nodes) ? raw.nodes : []).slice(0, 100).map((node, index) => {
    const bounds = node.bounds || {};
    return {
      id: safeId(node.id, `node_${index + 1}`),
      label: String(node.label ?? node.text ?? `节点 ${index + 1}`).slice(0, 200),
      type: normalizeType(node.type || node.shape),
      x: finite(node.x ?? bounds.x, 40), y: finite(node.y ?? bounds.y, 40),
      w: Math.max(20, finite(node.w ?? bounds.width ?? node.width, 160)), h: Math.max(20, finite(node.h ?? bounds.height ?? node.height, 70)),
      fill: safeColor(node.fill, '#E2E8F0'), stroke: safeColor(node.stroke, '#64748B'),
      fontSize: Math.max(8, Math.min(72, finite(node.fontSize, 16))), fontColor: safeColor(node.fontColor, '#0F172A')
    };
  });
  if (!nodes.length) throw new Error('VLM 未识别到节点');
  const ids = new Set(nodes.map((node) => node.id));
  const edges = (Array.isArray(raw?.edges) ? raw.edges : []).slice(0, 200).map((edge, index) => ({
    id: safeId(edge.id, `edge_${index + 1}`), source: safeId(edge.source ?? edge.from, ''), target: safeId(edge.target ?? edge.to, ''), label: String(edge.label || '').slice(0, 120), dashed: Boolean(edge.dashed), arrow: edge.arrow !== false, stroke: safeColor(edge.stroke, '#64748B'), waypoints: Array.isArray(edge.waypoints) ? edge.waypoints.map((point) => ({ x: finite(point.x, 0), y: finite(point.y, 0) })) : []
  })).filter((edge) => ids.has(edge.source) && ids.has(edge.target));
  return { width, height, background: safeColor(canvas.background, '#FFFFFF'), nodes, edges, confidence: Math.max(0, Math.min(100, finite(raw?.confidence, 78))), partial: Boolean(raw?._partial) };
}

async function localFallback(size) {
  const width = Math.max(900, Math.min(1600, Math.round(size.width || 1200)));
  const height = Math.max(620, Math.min(1000, Math.round(size.height || 800)));
  const y = Math.round(height * .38);
  const w = Math.round(width * .22);
  const h = Math.round(height * .14);
  const gap = Math.round(width * .06);
  return {
    width, height, background: '#FFFFFF', confidence: 20,
    nodes: [
      { id: 'input', label: '图片输入', type: 'rounded', x: Math.round(width * .09), y, w, h, fill: '#E0F2FE', stroke: '#0284C7', fontSize: 18, fontColor: '#0C4A6E' },
      { id: 'detect', label: '本地几何识别', type: 'rounded', x: Math.round(width * .09) + w + gap, y, w, h, fill: '#FEF3C7', stroke: '#D97706', fontSize: 18, fontColor: '#78350F' },
      { id: 'output', label: '可编辑图表', type: 'rounded', x: Math.round(width * .09) + (w + gap) * 2, y, w, h, fill: '#DCFCE7', stroke: '#16A34A', fontSize: 18, fontColor: '#14532D' },
      { id: 'note', label: '未配置 VLM/OCR：当前仅生成原生结构骨架。填写识别引擎配置后可解析任意图表中的文字、形状和连接关系。', type: 'text', x: Math.round(width * .12), y: Math.round(height * .65), w: Math.round(width * .76), h: 90, fill: 'none', stroke: 'none', fontSize: 15, fontColor: '#64748B' }
    ],
    edges: [{ id: 'e1', source: 'input', target: 'detect', arrow: true, dashed: false, stroke: '#64748B', waypoints: [] }, { id: 'e2', source: 'detect', target: 'output', arrow: true, dashed: false, stroke: '#64748B', waypoints: [] }]
  };
}

function shapeStyle(node) {
  const shape = node.type === 'ellipse' ? 'ellipse' : node.type === 'diamond' ? 'rhombus' : node.type === 'parallelogram' ? 'parallelogram' : node.type === 'document' ? 'document' : node.type === 'text' ? 'text' : 'rectangle';
  if (node.type === 'text') return `text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;fontSize=${node.fontSize};fontColor=${node.fontColor};`;
  return `${shape === 'rectangle' ? 'rounded=1;' : `shape=${shape};`}whiteSpace=wrap;html=1;fillColor=${node.fill};strokeColor=${node.stroke};fontSize=${node.fontSize};fontColor=${node.fontColor};${node.type === 'rounded' ? 'rounded=1;' : ''}`;
}

function diagramToDrawio(diagram, title) {
  const nodes = diagram.nodes.map((node) => `<mxCell id="${escapeXml(node.id)}" value="${escapeXml(node.label).replace(/\n/g, '&#10;')}" style="${shapeStyle(node)}" vertex="1" parent="1"><mxGeometry x="${node.x}" y="${node.y}" width="${node.w}" height="${node.h}" as="geometry" /></mxCell>`).join('');
  const edges = diagram.edges.map((edge) => {
    const points = edge.waypoints?.length ? `<Array as="points">${edge.waypoints.map((point) => `<mxPoint x="${point.x}" y="${point.y}" />`).join('')}</Array>` : '';
    const edgeStyle = `edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;endArrow=${edge.arrow ? 'block' : 'none'};endFill=${edge.arrow ? '1' : '0'};strokeColor=${edge.stroke};${edge.dashed ? 'dashed=1;' : ''}`;
    return `<mxCell id="${escapeXml(edge.id)}" value="${escapeXml(edge.label || '').replace(/\n/g, '&#10;')}" edge="1" source="${escapeXml(edge.source)}" target="${escapeXml(edge.target)}" style="${edgeStyle}" parent="1"><mxGeometry relative="1" as="geometry">${points}</mxGeometry></mxCell>`;
  }).join('');
  return `<mxfile host="app.diagrams.net" modified="${new Date().toISOString()}" agent="Image2Diagram"><diagram name="${escapeXml(safeFilename(title))}" id="image2diagram-${Date.now()}"><mxGraphModel dx="1600" dy="1200" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="${diagram.width}" pageHeight="${diagram.height}" math="0" shadow="0"><root><mxCell id="0" /><mxCell id="1" parent="0" /><mxCell id="bg" value="" style="shape=rectangle;fillColor=${diagram.background};strokeColor=${diagram.background};" vertex="1" parent="1"><mxGeometry x="0" y="0" width="${diagram.width}" height="${diagram.height}" as="geometry" /></mxCell>${nodes}${edges}</root></mxGraphModel></diagram></mxfile>`;
}

function parseStyle(styleText = '') {
  return styleText.split(';').reduce((style, pair) => {
    const index = pair.indexOf('=');
    if (index === -1) return style;
    style[pair.slice(0, index)] = pair.slice(index + 1);
    return style;
  }, {});
}

function childElement(element, tagName) { return [...element.children].find((child) => child.tagName === tagName) || null; }

function parseDiagram(xml) {
  const document = new DOMParser().parseFromString(xml, 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('draw.io XML 无法解析');
  const model = document.querySelector('mxGraphModel');
  const root = document.querySelector('root');
  if (!model || !root) throw new Error('缺少 draw.io 图表根节点');
  const cells = [...root.children].filter((element) => element.tagName === 'mxCell');
  const nodes = [];
  const edges = [];
  for (const cell of cells) {
    const geometry = childElement(cell, 'mxGeometry');
    const bounds = geometry ? { x: Number(geometry.getAttribute('x') || 0), y: Number(geometry.getAttribute('y') || 0), width: Number(geometry.getAttribute('width') || 0), height: Number(geometry.getAttribute('height') || 0), points: [...geometry.querySelectorAll('mxPoint')].map((point) => ({ x: Number(point.getAttribute('x') || 0), y: Number(point.getAttribute('y') || 0) })) } : null;
    const record = { id: cell.getAttribute('id') || '', value: cell.getAttribute('value') || '', style: parseStyle(cell.getAttribute('style') || ''), bounds, source: cell.getAttribute('source'), target: cell.getAttribute('target') };
    if (cell.getAttribute('edge') === '1') edges.push(record); else if (cell.getAttribute('vertex') === '1') nodes.push(record);
  }
  return { width: Number(model.getAttribute('pageWidth') || 1200), height: Number(model.getAttribute('pageHeight') || 800), nodes, edges, byId: new Map(nodes.map((node) => [node.id, node])) };
}

function textLines(value) { return String(value || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').split(/\r?\n/); }

function svgText(value, x, y, width, height, style) {
  const lines = textLines(value);
  if (!lines.some((line) => line.trim())) return '';
  const fontSize = Number(style.fontSize || 14);
  const lineHeight = fontSize * 1.28;
  const totalHeight = lines.length * lineHeight;
  const align = style.align || 'center';
  const textX = align === 'left' ? x + 10 : align === 'right' ? x + width - 10 : x + width / 2;
  const anchor = align === 'left' ? 'start' : align === 'right' ? 'end' : 'middle';
  const startY = y + height / 2 - totalHeight / 2 + fontSize;
  const weight = Number(style.fontStyle || 0) & 1 ? 700 : 400;
  return `<text x="${textX}" y="${startY}" text-anchor="${anchor}" font-family="Arial, Noto Sans SC, Microsoft YaHei, sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${style.fontColor || '#1E293B'}">${lines.map((line, index) => `<tspan x="${textX}" dy="${index ? lineHeight : 0}">${escapeHtml(line)}</tspan>`).join('')}</text>`;
}

function nodeSvg(node) {
  if (!node.bounds) return '';
  const { x, y, width, height } = node.bounds;
  const style = node.style;
  const fill = style.fillColor && style.fillColor !== 'none' ? style.fillColor : 'none';
  const stroke = style.strokeColor && style.strokeColor !== 'none' ? style.strokeColor : 'none';
  const strokeWidth = Number(style.strokeWidth || (stroke === 'none' ? 0 : 1));
  let shape = '';
  if (style.shape === 'ellipse') shape = `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" rx="${width / 2}" ry="${height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
  else if (style.shape === 'rhombus') shape = `<polygon points="${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
  else if (style.shape !== 'text') shape = `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${style.rounded === '1' ? 12 : 0}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeWidth}" />`;
  return `${shape}${svgText(node.value, x, y, width, height, style)}`;
}

function edgeSvg(edge, parsed, markerId) {
  const source = parsed.byId.get(edge.source); const target = parsed.byId.get(edge.target);
  if (!source?.bounds || !target?.bounds) return '';
  const center = (node) => ({ x: node.bounds.x + node.bounds.width / 2, y: node.bounds.y + node.bounds.height / 2 });
  const from = center(source); const to = center(target); const points = edge.bounds?.points || [];
  const path = [from, ...points, to].map((point, index) => `${index ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ');
  const style = edge.style; const color = style.strokeColor || '#64748B'; const width = Number(style.strokeWidth || 1.5); const dash = style.dashed === '1' ? ' stroke-dasharray="7 6"' : ''; const arrow = style.endArrow && style.endArrow !== 'none' ? ` marker-end="url(#${markerId})"` : '';
  return `<path d="${path}" fill="none" stroke="${color}" stroke-width="${width}"${dash}${arrow} />`;
}

function renderDiagram(parsed) {
  const maxX = Math.max(parsed.width, ...parsed.nodes.map((node) => (node.bounds?.x || 0) + (node.bounds?.width || 0)));
  const maxY = Math.max(parsed.height, ...parsed.nodes.map((node) => (node.bounds?.y || 0) + (node.bounds?.height || 0)));
  const background = parsed.nodes.find((node) => node.bounds?.x === 0 && node.bounds?.y === 0 && node.bounds.width > maxX * .65);
  const backgroundColor = background?.style.fillColor && background.style.fillColor !== 'none' ? background.style.fillColor : '#FFFFFF';
  const markerId = `arrow-${Math.random().toString(36).slice(2)}`;
  const edges = parsed.edges.map((edge) => edgeSvg(edge, parsed, markerId)).join('');
  const nodes = parsed.nodes.filter((node) => node !== background).map(nodeSvg).join('');
  return `<svg class="diagram-svg" viewBox="0 0 ${maxX} ${maxY}" role="img" aria-label="可编辑图表预览" xmlns="http://www.w3.org/2000/svg"><defs><marker id="${markerId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#64748B" /></marker></defs><rect width="${maxX}" height="${maxY}" fill="${backgroundColor}" />${edges}${nodes}</svg>`;
}

function toMermaid(parsed) {
  const nodes = parsed.nodes.filter((node) => node.value && !(node.bounds?.x === 0 && node.bounds?.y === 0 && node.bounds.width > parsed.width * .65));
  const idMap = new Map(nodes.map((node) => [node.id, `n_${node.id.replace(/[^A-Za-z0-9_]/g, '_')}`]));
  const lines = ['flowchart TD'];
  nodes.forEach((node) => { const label = textLines(node.value).join('<br/>').replace(/[\[\](){}]/g, ''); const id = idMap.get(node.id); lines.push(`  ${id}${node.style.shape === 'ellipse' ? `(("${label}"))` : node.style.shape === 'rhombus' ? `{"${label}"}` : ` ["${label}"]`}`); });
  parsed.edges.forEach((edge) => { if (idMap.has(edge.source) && idMap.has(edge.target)) lines.push(`  ${idMap.get(edge.source)} --> ${idMap.get(edge.target)}`); });
  return `${lines.join('\n')}\n`;
}

async function convertItem(item) {
  item.status = 'processing';
  renderQueue();
  try {
    const size = await readImageSize(item.file);
    let diagram; let method;
    if (state.settings.endpoint && state.settings.model) {
      diagram = await requestVlm(item.file, size);
      method = diagram.partial ? `VLM 结构化识别 · ${state.settings.model} · 已恢复部分结果` : `VLM 结构化识别 · ${state.settings.model}`;
    } else {
      diagram = await localFallback(size);
      method = '本地几何 fallback · 未配置 OCR/VLM';
    }
    const xml = diagramToDrawio(diagram, item.file.name);
    const parsed = parseDiagram(xml);
    item.status = 'done';
    const result = { fileId: item.id, fileName: item.file.name, previewUrl: item.previewUrl, xml, parsed, diagram, method, confidence: diagram.confidence, mermaid: toMermaid(parsed), createdAt: new Date().toISOString() };
    state.results = [...state.results.filter((entry) => entry.fileId !== item.id), result];
    addHistory(result);
  } catch (error) {
    item.status = 'error';
    state.results = [...state.results.filter((entry) => entry.fileId !== item.id), { fileId: item.id, fileName: item.file.name, error: error.message || '转换失败' }];
  }
  state.completed += 1;
  setProgress(state.completed, state.files.length, item.status === 'done' ? `${item.file.name} 已完成` : `${item.file.name} 处理失败`);
  renderQueue();
  renderResults();
}

async function convertAll() {
  if (state.converting || !state.files.length) return;
  state.converting = true; state.completed = 0; state.results = [];
  $('#convert-button').disabled = true; $('#convert-button').innerHTML = '转换中… <span class="spinner"></span>';
  setProgress(0, state.files.length, '准备识别…'); renderResults();
  let cursor = 0;
  const worker = async () => { while (cursor < state.files.length) { const item = state.files[cursor++]; await convertItem(item); } };
  await Promise.all(Array.from({ length: Math.min(3, state.files.length) }, worker));
  state.converting = false; $('#convert-button').disabled = false; $('#convert-button').innerHTML = '重新转换 <span>→</span>';
  setProgress(state.files.length, state.files.length, `完成 ${state.files.length} 张`);
  const success = state.results.filter((result) => !result.error).length;
  showToast(`已完成 ${success}/${state.files.length} 张`, success === state.files.length ? 'success' : 'error');
}

function addHistory(result) {
  const record = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, fileName: result.fileName, xml: result.xml, mermaid: result.mermaid, parsed: result.parsed, method: result.method, confidence: result.confidence, createdAt: result.createdAt };
  state.history = [record, ...state.history.filter((entry) => entry.fileName !== result.fileName)].slice(0, 10);
  saveHistory(); renderHistory();
}

function renderHistory() {
  historySection.classList.toggle('hidden', !state.history.length);
  historyList.innerHTML = state.history.map((record) => `<div class="history-item"><div><strong>${escapeHtml(record.fileName)}</strong><span>${escapeHtml(record.method)} · ${record.confidence}%</span></div><button class="history-download" data-history-id="${record.id}" type="button">下载 draw.io</button></div>`).join('');
}

function renderResults() {
  resultsSection.classList.toggle('hidden', state.results.length === 0);
  if (!state.results.length) { resultsList.innerHTML = ''; return; }
  resultsList.innerHTML = state.results.map((result) => {
    if (result.error) return `<article class="result-card error-card"><div class="result-card-title"><strong>${escapeHtml(result.fileName)}</strong><span class="confidence low">转换失败</span></div><p>${escapeHtml(result.error)}</p></article>`;
    const nodeCount = result.parsed.nodes.filter((node) => node.value || node.bounds?.width > 0).length;
    return `<article class="result-card"><div class="result-card-title"><div><strong>${escapeHtml(result.fileName)}</strong><span class="method">${escapeHtml(result.method)}</span></div><span class="confidence ${result.confidence >= 70 ? 'high' : 'low'}">${result.confidence}% 结构置信度</span></div><div class="compare-grid"><div class="preview-panel"><div class="preview-label">原图</div><div class="image-preview"><img src="${result.previewUrl}" alt="${escapeHtml(result.fileName)}" /></div></div><div class="preview-panel"><div class="preview-label">可编辑结构预览 · ${nodeCount} 个元素 / ${result.parsed.edges.length} 条连线</div><div class="diagram-preview">${renderDiagram(result.parsed)}</div></div></div><div class="result-actions"><button class="primary-button compact download-drawio" data-file-id="${result.fileId}" type="button">下载 .drawio</button><button class="secondary-button compact download-pptx" data-file-id="${result.fileId}" type="button">下载 .pptx</button><button class="secondary-button compact download-mermaid" data-file-id="${result.fileId}" type="button">下载 Mermaid</button><button class="secondary-button compact download-all" data-file-id="${result.fileId}" type="button">下载全部格式</button><button class="text-action copy-xml" data-file-id="${result.fileId}" type="button">复制 XML</button></div></article>`;
  }).join('');
}

function downloadText(content, filename, type) {
  const blob = new Blob([content], { type }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 500);
}

function colorForPptx(value, fallback = 'FFFFFF') { return String(value || fallback).replace('#', '').slice(0, 6).toUpperCase(); }

async function downloadPptx(result) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; pptx.author = 'Image2Diagram'; pptx.subject = 'Image to editable diagram'; pptx.title = result.fileName;
  const slide = pptx.addSlide();
  const pageWidth = result.parsed.width || 1200; const pageHeight = result.parsed.height || 800; const scale = Math.min(12.6 / pageWidth, 6.8 / pageHeight); const offsetX = (13.333 - pageWidth * scale) / 2; const offsetY = (7.5 - pageHeight * scale) / 2;
  slide.background = { color: colorForPptx(result.diagram?.background, 'FFFFFF') };
  const shapeType = pptx.ShapeType || {};
  const diagramNodes = result.parsed.nodes.filter((node) => !(node.bounds?.x === 0 && node.bounds?.y === 0 && node.bounds.width > pageWidth * .65));
  const byId = new Map(diagramNodes.map((node) => [node.id, node]));
  const center = (node) => ({ x: offsetX + (node.bounds.x + node.bounds.width / 2) * scale, y: offsetY + (node.bounds.y + node.bounds.height / 2) * scale });
  result.parsed.edges.forEach((edge) => { const source = byId.get(edge.source); const target = byId.get(edge.target); if (!source || !target) return; const from = center(source); const to = center(target); slide.addShape(shapeType.line || 'line', { x: from.x, y: from.y, w: to.x - from.x, h: to.y - from.y, line: { color: colorForPptx(edge.style?.strokeColor, '64748B'), width: 1.2, dash: edge.style?.dashed === '1' ? 'dash' : 'solid', endArrowType: edge.style?.endArrow === 'none' ? 'none' : 'triangle' } }); });
  diagramNodes.forEach((node) => { const b = node.bounds; const opts = { x: offsetX + b.x * scale, y: offsetY + b.y * scale, w: Math.max(.15, b.width * scale), h: Math.max(.12, b.height * scale), fill: { color: colorForPptx(node.style.fillColor, 'FFFFFF') }, line: { color: colorForPptx(node.style.strokeColor, '64748B'), width: 1 }, radius: .08 }; const shape = node.style.shape === 'ellipse' ? shapeType.ellipse : node.style.shape === 'rhombus' ? shapeType.diamond : node.style.shape === 'parallelogram' ? shapeType.parallelogram : shapeType.roundRect || shapeType.rect || 'rect'; if (node.style.shape !== 'text') slide.addShape(shape, opts); slide.addText(textLines(node.value).join('\n'), { x: opts.x + .03, y: opts.y + .02, w: Math.max(.1, opts.w - .06), h: Math.max(.1, opts.h - .04), margin: 0.02, fontFace: 'Arial', fontSize: Math.max(6, Number(node.style.fontSize || 14) * .72), color: colorForPptx(node.style.fontColor, '1E293B'), bold: Boolean(Number(node.style.fontStyle || 0) & 1), align: 'center', valign: 'mid', fit: 'shrink' }); });
  await pptx.writeFile({ fileName: `${safeFilename(result.fileName)}.pptx` });
}

function resultById(id) { return state.results.find((result) => result.fileId === id); }

function historyById(id) { return state.history.find((record) => record.id === id); }

$('#choose-button').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (event) => addFiles(event.target.files));
$('#convert-button').addEventListener('click', convertAll);
$('#clear-button').addEventListener('click', clearAll);
$('#save-ai-settings').addEventListener('click', () => { state.settings = { endpoint: $('#ai-endpoint').value.trim(), model: $('#ai-model').value.trim(), apiKey: $('#ai-api-key').value.trim() }; localStorage.setItem(STORAGE.settings, JSON.stringify(state.settings)); updateEngineStatus(); showToast(state.settings.endpoint && state.settings.model ? 'VLM 配置已保存' : '已切换到本地 fallback', 'success'); });
$('#clear-history').addEventListener('click', () => { state.history = []; saveHistory(); renderHistory(); showToast('历史记录已清除', 'success'); });

dropZone.addEventListener('dragover', (event) => { event.preventDefault(); dropZone.classList.add('dragging'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragging'));
dropZone.addEventListener('drop', (event) => { event.preventDefault(); dropZone.classList.remove('dragging'); addFiles(event.dataTransfer.files); });

fileQueue.addEventListener('click', (event) => { const button = event.target.closest('.remove-file'); if (button) removeFile(button.dataset.id); });

resultsList.addEventListener('click', async (event) => {
  const button = event.target.closest('button'); if (!button) return; const result = resultById(button.dataset.fileId); if (!result) return; const base = safeFilename(result.fileName);
  if (button.classList.contains('download-drawio')) downloadText(result.xml, `${base}.drawio`, 'application/xml;charset=utf-8');
  if (button.classList.contains('download-mermaid')) downloadText(result.mermaid, `${base}.mmd`, 'text/plain;charset=utf-8');
  if (button.classList.contains('download-pptx')) await downloadPptx(result);
  if (button.classList.contains('download-all')) { downloadText(result.xml, `${base}.drawio`, 'application/xml;charset=utf-8'); downloadText(result.mermaid, `${base}.mmd`, 'text/plain;charset=utf-8'); await downloadPptx(result); }
  if (button.classList.contains('copy-xml')) { await navigator.clipboard.writeText(result.xml); showToast('draw.io XML 已复制', 'success'); }
});

historyList.addEventListener('click', async (event) => { const button = event.target.closest('.history-download'); if (!button) return; const record = historyById(button.dataset.historyId); if (!record) return; downloadText(record.xml, `${safeFilename(record.fileName)}.drawio`, 'application/xml;charset=utf-8'); });
