import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource-variable/golos-text';
import '@fontsource-variable/literata';
import './style.css';
import App from './App';
import { initAnalytics } from './analytics';
if (import.meta.env.PROD) initAnalytics();
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
if (import.meta.env.PROD && 'serviceWorker' in navigator)
  navigator.serviceWorker.register('/sw.js').catch(() => {});
