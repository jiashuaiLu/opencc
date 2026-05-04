import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import { ThemeProvider } from './context/ThemeContext';
import './styles/global.css';

// 生产环境禁用 StrictMode，避免双重渲染导致的性能问题
const isDev = process.env.NODE_ENV === 'development';

ReactDOM.createRoot(document.getElementById('root')!).render(
  isDev ? (
    <React.StrictMode>
      <HashRouter>
        <ThemeProvider>
          <App />
        </ThemeProvider>
      </HashRouter>
    </React.StrictMode>
  ) : (
    <HashRouter>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </HashRouter>
  )
);
