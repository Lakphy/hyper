import React from 'react';
import {createRoot} from 'react-dom/client';
import {PlatformProvider} from '../platform-context';
import {browserPlatform} from '../platform-browser';
import {RemoteProvider} from './store/remote-store';
import {App} from './components/App';
import './styles.css';

const params = new URLSearchParams(window.location.search);
const token = params.get('token') || '';

const root = createRoot(document.getElementById('root')!);
root.render(
  <PlatformProvider value={browserPlatform}>
    <RemoteProvider>
      <App token={token} />
    </RemoteProvider>
  </PlatformProvider>
);
