import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// 平台检测：给 html 根元素加 class 用于 CSS 条件样式
if (navigator.platform.includes('Mac') || navigator.userAgent.includes('Mac')) {
  document.documentElement.classList.add('is-macos');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
