import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { GameApp } from './app';
import { Root } from './ui/Root';
import './ui/ui.css';

const stage = document.getElementById('stage')!;
const uiRoot = document.getElementById('ui-root')!;
const app = new GameApp(stage, uiRoot);
createRoot(uiRoot).render(createElement(Root, { app }));

if (import.meta.env.VITE_TEST_HOOKS === '1') {
  void import('./test-hooks').then(m => m.installTestHooks(app));
}
