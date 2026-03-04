#!/bin/bash

echo "🚀 Starting OpenCC Development Environment..."

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    exit 1
fi

echo "✅ Node.js version: $(node --version)"
echo "✅ npm version: $(npm --version)"

# 安装依赖
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# 创建必要的目录
echo "📁 Creating necessary directories..."
mkdir -p ~/.opencc/data
mkdir -p ~/.opencc/logs

# 启动开发服务器
echo "🎉 Starting development server..."
npm run electron:dev
