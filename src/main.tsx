import React from 'react';
import ReactDOM from 'react-dom/client';
import { LazyMotion, domAnimation } from 'framer-motion';
import App from './App';
import './index.css';

// LazyMotion(strict) + m 组件：按需加载动画特性集（domAnimation 覆盖项目
// 全部用法——variants/exit/transition；无 layout/drag），motion chunk 从
// 123 kB 降到 ~1/4。strict 模式下任何残留的 motion.* 直接抛错，防回退。
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <LazyMotion features={domAnimation} strict>
      <App />
    </LazyMotion>
  </React.StrictMode>,
);
