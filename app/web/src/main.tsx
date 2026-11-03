import { createRoot } from 'react-dom/client';
import '@xterm/xterm/css/xterm.css';
import './styles.css';
import './three.css';
import { App } from './App.tsx';

// Sem StrictMode: ele monta os terminais duas vezes e descartaria a saida
// que chega entre as montagens.
createRoot(document.getElementById('root')!).render(<App />);
