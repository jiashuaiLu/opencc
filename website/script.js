// 平滑滚动到锚点
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        e.preventDefault();
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            target.scrollIntoView({
                behavior: 'smooth',
                block: 'start'
            });
        }
    });
});

// 导航栏滚动效果
let lastScroll = 0;
const navbar = document.querySelector('.navbar');

window.addEventListener('scroll', () => {
    const currentScroll = window.pageYOffset;
    
    if (currentScroll > 100) {
        navbar.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
    } else {
        navbar.style.boxShadow = 'none';
    }
    
    lastScroll = currentScroll;
});

// 下载按钮点击统计（可选）
document.querySelectorAll('a[href$=".dmg"]').forEach(link => {
    link.addEventListener('click', function() {
        const version = this.textContent.includes('v1.0.0') ? 'v1.0.0' : 'latest';
        console.log(`Download clicked: ${version}`);
        // 这里可以添加统计代码
    });
});

// 页面加载完成后的动画
document.addEventListener('DOMContentLoaded', () => {
    // 淡入动画
    document.body.style.opacity = '0';
    document.body.style.transition = 'opacity 0.5s';
    
    setTimeout(() => {
        document.body.style.opacity = '1';
    }, 100);
    
    // 功能卡片交错动画
    const featureCards = document.querySelectorAll('.feature-card');
    featureCards.forEach((card, index) => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(20px)';
        card.style.transition = 'all 0.5s';
        
        setTimeout(() => {
            card.style.opacity = '1';
            card.style.transform = 'translateY(0)';
        }, 100 + index * 100);
    });
});

// 版本历史数据（可以扩展为从 API 加载）
const versions = [
    {
        version: '1.0.0',
        date: '2026-03-05',
        changes: [
            '首次发布',
            '代理服务管理功能',
            '配置管理功能',
            '日志系统',
            '监控统计',
            '对话历史管理',
            '使用文档',
            '应用资讯页面'
        ],
        downloadUrl: 'https://joy-ai-test.s3-internal.cn-north-1.jdcloud-oss.com/DongCC-1.0.0-arm64.dmg',
        current: true
    }
];

// 可以添加更多版本...
