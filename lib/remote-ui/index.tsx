import React from 'react';

import {createRoot} from 'react-dom/client';

import {browserPlatform} from '../platform-browser';
import {PlatformProvider} from '../platform-context';

import {App} from './components/App';
import {RemoteProvider} from './store/remote-store';
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
