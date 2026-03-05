# DongCC 官网部署指南

## 📦 部署方案

### 方案一：GitLab Pages 自动部署（推荐）✅

**已完成配置！** 已添加 `.gitlab-ci.yml` 文件，每次推送到 main 分支会自动部署。

#### 访问地址
部署完成后，网站将自动发布到：
```
https://atop-qa.pages.jd.com/dongcc
```

#### 查看部署状态
1. 访问 GitLab 项目：https://gitlab.jd.com/atop-qa/dongcc
2. 点击左侧菜单 "CI/CD" → "Pipelines"
3. 查看最新的 Pipeline 状态

---

### 方案二：部署到京东云 OSS

#### 1. 安装 AWS CLI（兼容京东云）
```bash
# macOS
brew install awscli

# 或使用 pip
pip install awscli
```

#### 2. 配置京东云凭证
```bash
aws configure --profile jdcloud
# 输入您的 Access Key 和 Secret Key
# Region: cn-north-1
# Output format: json
```

#### 3. 上传文件到 OSS
```bash
cd /Users/lujiashuai.1/temp/dongcc

# 同步 website 目录到 OSS
aws s3 sync website/ s3://joy-ai-test/dongcc \
  --endpoint-url=https://s3-internal.cn-north-1.jdcloud-oss.com \
  --profile jdcloud \
  --acl public-read
```

#### 4. 访问地址
```
https://joy-ai-test.s3-internal.cn-north-1.jdcloud-oss.com/dongcc/index.html
```

---

### 方案三：部署到 Nginx 服务器

#### 1. 打包文件
```bash
cd /Users/lujiashuai.1/temp/dongcc
tar -czf website.tar.gz website/
```

#### 2. 上传到服务器
```bash
scp website.tar.gz user@your-server:/tmp/
```

#### 3. 在服务器上配置 Nginx
```bash
# SSH 登录服务器
ssh user@your-server

# 解压文件
sudo mkdir -p /var/www/dongcc
sudo tar -xzf /tmp/website.tar.gz -C /var/www/dongcc --strip-components=1

# 配置 Nginx
sudo tee /etc/nginx/sites-available/dongcc <<EOF
server {
    listen 80;
    server_name dongcc.your-domain.com;
    
    root /var/www/dongcc;
    index index.html;
    
    location / {
        try_files \$uri \$uri/ =404;
    }
}
EOF

# 启用站点
sudo ln -s /etc/nginx/sites-available/dongcc /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

#### 4. 访问地址
```
http://dongcc.your-domain.com
```

---

### 方案四：本地预览

#### 使用 Python
```bash
cd /Users/lujiashuai.1/temp/dongcc/website
python3 -m http.server 8000
# 访问 http://localhost:8000
```

#### 使用 Node.js
```bash
cd /Users/lujiashuai.1/temp/dongcc/website
npx serve .
# 访问 http://localhost:3000
```

#### 使用 PHP
```bash
cd /Users/lujiashuai.1/temp/dongcc/website
php -S localhost:8000
# 访问 http://localhost:8000
```

---

## 🚀 快速部署脚本

创建一个部署脚本 `deploy.sh`：

```bash
#!/bin/bash

echo "🚀 开始部署 DongCC 官网..."

# 方案选择
echo "请选择部署方案："
echo "1) GitLab Pages（自动部署）"
echo "2) 京东云 OSS"
echo "3) 打包文件（手动部署）"
read -p "请输入选项 (1-3): " choice

case $choice in
    1)
        echo "✅ GitLab Pages 已配置自动部署"
        echo "推送代码后将自动部署到："
        echo "https://atop-qa.pages.jd.com/dongcc"
        ;;
    2)
        echo "📦 上传到京东云 OSS..."
        aws s3 sync website/ s3://joy-ai-test/dongcc \
          --endpoint-url=https://s3-internal.cn-north-1.jdcloud-oss.com \
          --profile jdcloud \
          --acl public-read
        echo "✅ 部署完成！"
        ;;
    3)
        echo "📦 打包文件..."
        tar -czf website.tar.gz website/
        echo "✅ 打包完成：website.tar.gz"
        echo "请手动上传到您的服务器"
        ;;
    *)
        echo "❌ 无效选项"
        exit 1
        ;;
esac
```

---

## 📋 部署检查清单

- [x] ✅ 创建 `.gitlab-ci.yml` 配置文件
- [ ] 🔄 等待 GitLab CI/CD 自动部署
- [ ] 🌐 访问网站验证功能
- [ ] 📊 检查下载计数功能
- [ ] 🎨 检查轮播图显示
- [ ] 📱 测试移动端响应式

---

## 🔧 常见问题

### 1. GitLab Pages 部署失败
- 检查 `.gitlab-ci.yml` 文件格式
- 查看 CI/CD Pipeline 日志
- 确认项目有 Pages 权限

### 2. OSS 上传失败
- 检查 AWS CLI 配置
- 确认 Access Key 权限
- 检查网络连接

### 3. 网站无法访问
- 检查文件路径是否正确
- 确认 index.html 存在
- 检查服务器配置

---

## 📞 技术支持

如有问题，请联系：
- ERP: lujiashuai.1
- 邮箱: lujiashuai.1@jd.com
