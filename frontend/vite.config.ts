import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// 개발용 프록시. B(채팅)와 C(저장·알림) 서버를 따로 띄울 때 VITE_CHAT_PROXY_TARGET으로 채팅만 분리한다.
const backend = process.env.VITE_PROXY_TARGET ?? 'http://127.0.0.1:8000';
const chat = process.env.VITE_CHAT_PROXY_TARGET;
export default defineConfig({ plugins: [react()], server: { proxy: { ...(chat ? { '/api/chat': chat, '/api/proposals': chat } : {}), '/api': backend, '/health': backend } } });
