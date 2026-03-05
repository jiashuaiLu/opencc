// API 配置
const API_BASE_URL = 'https://joy-ai-test.jd.com/cache';
const DOWNLOAD_COUNT_KEY = 'dongcc_download_count';

// 轮播图配置
let currentSlide = 0;
const totalSlides = 5;
let autoPlayInterval;

// 轮播图控制
function changeSlide(direction) {
    const slides = document.querySelectorAll('.carousel-slide');
    const indicators = document.querySelectorAll('.carousel-indicator');
    
    slides[currentSlide].classList.remove('active');
    indicators[currentSlide].classList.remove('active');
    
    currentSlide += direction;
    if (currentSlide >= totalSlides) currentSlide = 0;
    if (currentSlide < 0) currentSlide = totalSlides - 1;
    
    slides[currentSlide].classList.add('active');
    indicators[currentSlide].classList.add('active');
    
    resetAutoPlay();
}

function goToSlide(index) {
    const slides = document.querySelectorAll('.carousel-slide');
    const indicators = document.querySelectorAll('.carousel-indicator');
    
    slides[currentSlide].classList.remove('active');
    indicators[currentSlide].classList.remove('active');
    
    currentSlide = index;
    
    slides[currentSlide].classList.add('active');
    indicators[currentSlide].classList.add('active');
    
    resetAutoPlay();
}

function startAutoPlay() {
    autoPlayInterval = setInterval(() => {
        changeSlide(1);
    }, 5000);
}

function resetAutoPlay() {
    clearInterval(autoPlayInterval);
    startAutoPlay();
}

// 获取下载计数
async function fetchDownloadCount() {
    try {
        const response = await fetch(`${API_BASE_URL}/get?key=${DOWNLOAD_COUNT_KEY}`);
        const data = await response.json();
        console.log('API Response:', data);
        console.log('data.data:', data.data, 'type:', typeof data.data);
        const count = Number(data.data) || 0;
        console.log('Converted count:', count, 'type:', typeof count);
        updateDownloadCount(count);
    } catch (error) {
        console.error('Failed to fetch download count:', error);
    }
}

// 更新下载计数显示
let lastCount = 0;
let countUpInstance = null;

function updateDownloadCount(count) {
    const countElement = document.getElementById('downloadCount');
    console.log('updateDownloadCount called with count:', count);
    console.log('countElement:', countElement);
    
    if (countElement) {
        const numCount = Number(count);
        console.log('numCount:', numCount);
        
        // 如果是第一次加载，直接显示当前值，不使用动画
        if (!countUpInstance) {
            console.log('First load, setting text directly');
            countElement.textContent = numCount.toLocaleString();
            lastCount = numCount;
            
            // 创建 CountUp 实例，用于后续更新
            // 使用 startVal 参数设置初始值，避免重置为 0
            countUpInstance = new countUp.CountUp(countElement, numCount, {
                startVal: numCount,  // 设置初始值为当前值
                duration: 0.8,
                useEasing: true,
                useGrouping: true,
                separator: ',',
                decimal: '.'
            });
            console.log('CountUp instance created:', countUpInstance);
        } else {
            // 如果数量发生变化，使用动画更新
            if (numCount !== lastCount) {
                console.log('Updating count from', lastCount, 'to', numCount);
                
                // 创建一个新的 CountUp 实例，从 lastCount 到 numCount
                countUpInstance = new countUp.CountUp(countElement, numCount, {
                    startVal: lastCount,  // 从上一个值开始
                    duration: 0.8,
                    useEasing: true,
                    useGrouping: true,
                    separator: ',',
                    decimal: '.'
                });
                
                // 启动动画
                if (!countUpInstance.error) {
                    countUpInstance.start();
                }
                
                lastCount = numCount;
            }
        }
    } else {
        console.error('countElement not found!');
    }
}

// 递增下载计数
async function incrementDownloadCount() {
    try {
        // 先获取当前计数
        const currentCount = lastCount || 0;
        const newCount = Number(currentCount) + 1;
        console.log('Incrementing count from', currentCount, 'to', newCount);
        
        // 使用 POST 方法调用 /set 接口，确保传递 number 类型
        const response = await fetch(`${API_BASE_URL}/set?key=${DOWNLOAD_COUNT_KEY}&value=${newCount}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        });
        const data = await response.json();
        console.log('Set API response:', data);
        const count = Number(data.data) || newCount;
        console.log('Updating display with count:', count);
        updateDownloadCount(count);
    } catch (error) {
        console.error('Failed to increment download count:', error);
    }
}

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
        
        // 递增下载计数
        incrementDownloadCount();
    });
});

// 页面加载完成后的动画
document.addEventListener('DOMContentLoaded', () => {
    // 初始获取下载计数
    fetchDownloadCount();
    
    // 每秒获取下载计数
    setInterval(fetchDownloadCount, 3000);
    
    // 启动轮播图自动播放
    startAutoPlay();
    
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
