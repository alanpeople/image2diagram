import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages 项目站点使用相对资源路径，兼容 /仓库名/ 子路径部署。
  base: './',
});
