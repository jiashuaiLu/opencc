import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    // 优化生产构建
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
      },
    },
    // 代码分割，减少主包大小
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          antd: ['antd', '@ant-design/icons'],
          charts: ['recharts', 'chart.js', 'react-chartjs-2'],
        },
      },
    },
    // 减少 chunk 大小警告阈值
    chunkSizeWarningLimit: 1000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@core': path.resolve(__dirname, './src/core'),
      '@internal': path.resolve(__dirname, './src/internal'),
      '@renderer': path.resolve(__dirname, './src/core/renderer'),
      '@shared': path.resolve(__dirname, './src/core/shared'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
