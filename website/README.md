# OpenCC 官网

这是 OpenCC 产品的官方网站，提供产品介绍、功能特性、下载链接和版本历史。

## 📁 文件结构

```
website/
├── index.html      # 主页面
├── blog.html       # 博客页面
├── styles.css      # 样式文件
├── script.js       # JavaScript 脚本
└── README.md       # 说明文档
```

## 🚀 快速开始

### 本地预览

1. 直接在浏览器中打开 `index.html` 文件
2. 或者使用本地服务器：

```bash
# 使用 Python
python -m http.server 8000

# 使用 Node.js
npx serve .

# 使用 PHP
php -S localhost:8000
```

然后访问 `http://localhost:8000`

### 部署到服务器

将整个 `website` 目录上传到您的 Web 服务器即可。

## 📝 内容更新

### 更新下载链接

在 `index.html` 中找到以下部分并修改：

```html
<a href="https://joy-ai-test.s3-internal.cn-north-1.jdcloud-oss.com/dongcc/DongCC-1.3.0.dmg" class="btn btn-primary btn-large">
    下载最新版本
</a>
```

### 添加新版本

在 `index.html` 的版本历史部分添加新的 `timeline-item`：

```html
<div class="timeline-item">
    <div class="timeline-badge">新</div>
    <div class="timeline-content">
        <h3>v1.3.0</h3>
        <p class="timeline-date">2026-04-25</p>
        <ul class="timeline-changes">
            <li>✨ 新功能描述</li>
            <li>🐛 修复问题</li>
        </ul>
        <a href="下载链接" class="btn btn-small">下载此版本</a>
    </div>
</div>
```

### 更新版本号

在多个地方更新版本号：
1. 导航栏的 `version-badge`
2. Hero 区域的版本信息
3. 下载卡片的版本号
4. 版本历史部分

## 🎨 自定义样式

### 修改主题颜色

在 `styles.css` 的 `:root` 部分修改：

```css
:root {
    --primary-color: #1890ff;      /* 主色调 */
    --primary-dark: #096dd9;       /* 主色调深色 */
    --secondary-color: #52c41a;    /* 次要颜色 */
    /* ... */
}
```

### 修改字体

在 `body` 样式中修改字体：

```css
body {
    font-family: '您的字体', -apple-system, BlinkMacSystemFont, ...;
}
```

## 📊 添加统计代码

在 `script.js` 中可以添加统计代码：

```javascript
// 下载按钮点击统计
document.querySelectorAll('a[href$=".dmg"]').forEach(link => {
    link.addEventListener('click', function() {
        // 添加您的统计代码
        // 例如：Google Analytics, 百度统计等
        gtag('event', 'download', {
            'event_category': 'OpenCC',
            'event_label': this.textContent
        });
    });
});
```

## 🔧 功能特性

- ✅ 响应式设计，支持移动端
- ✅ 平滑滚动效果
- ✅ 动画过渡效果
- ✅ 版本历史展示
- ✅ 下载链接管理
- ✅ 现代化 UI 设计

## 📱 响应式支持

网站支持以下设备：
- 桌面端（> 768px）
- 平板端（768px）
- 移动端（< 768px）

## 🌐 浏览器支持

- Chrome (推荐)
- Firefox
- Safari
- Edge
- 其他现代浏览器

## 📧 联系方式

如有问题或建议，欢迎通过 GitHub Issues 反馈：
- GitHub: [jiashuaiLu](https://github.com/jiashuaiLu)
- 项目仓库: [https://github.com/jiashuaiLu/opencc](https://github.com/jiashuaiLu/opencc)

## 📄 许可证

© 2026 OpenCC Team. All rights reserved.
