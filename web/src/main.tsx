import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { loadLibrary } from './lib/library';
import './styles.css';

registerSW({ immediate: true });
loadLibrary();

createRoot(document.getElementById('root')!).render(<App />);
