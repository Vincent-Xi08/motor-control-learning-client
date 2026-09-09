import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 发布裁剪：删除 dist/assets/generated/*.png。
 * AssetHero 用 <picture> 优先加载同目录 webp（0.68 MB），png（13.7 MB）
 * 只是老浏览器回退——2026 年 Chromium/Firefox/Safari 全支持 webp，
 * 没必要让它们进安装包和 Pages。源文件 public/ 保留（资产生成管线用）。
 */
function trimPngFallbacks(): Plugin {
  return {
    name: 'trim-png-fallbacks',
    closeBundle() {
      const dir = join(process.cwd(), 'dist', 'assets', 'generated');
      try {
        for (const f of readdirSync(dir)) {
          if (f.endsWith('.png')) rmSync(join(dir, f));
        }
      } catch { /* 目录不存在时忽略 */ }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [react(), trimPngFallbacks()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // manualChunks 策略（performance audit R2）：
        // - recharts 不再拆 sub chunk：内部 CategoricalChartWrapper / Tooltip / CartesianGrid 等
        //   被几乎所有 chart 子组件共享，拆细只会让 N 个模块各请求 4-6 个 chunk，
        //   反而劣化加载并行度。整体 lazy + 单 chunk 是最优解（已通过 React.lazy 边界保证）。
        // - three：保留一个 chunk，只有 motor-basics / foc-flow 才真正加载 (~302KB gzip)。
        //   drei 当前用到 OrbitControls，tree-shake 已经做到极限；进一步切分意义不大。
        // - lucide-react 单独立 chunk：44 个文件用到，独立后跨模块复用、单次 fetch。
        // - react-vendor：稳定大件，长期缓存友好。
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          charts: ['recharts'],
          three: ['three', '@react-three/fiber', '@react-three/drei'],
          motion: ['framer-motion'],
          'lucide-icons': ['lucide-react'],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',  // 只绑定本地回环，避免暴露到局域网
    port: 5173,
  },
});
