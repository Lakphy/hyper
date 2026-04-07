// eslint-disable-next-line import/order
import {cfgPath} from './config/paths';

// Print diagnostic information for a few arguments instead of running Hyper.
if (['--help', '-v', '--version'].includes(process.argv[1])) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {version} = require('./package');
  console.log(`Hyper version ${version}`);
  console.log('Hyper does not accept any command line arguments. Please modify the config file instead.');
  console.log(`Hyper configuration file located at: ${cfgPath}`);
  process.exit();
}

// Set process.mainModule for @electron/remote's require resolution (removed in Electron >= 28)
process.mainModule = module;

// Enable remote module
// eslint-disable-next-line import/order
import {initialize as remoteInitialize} from '@electron/remote/main';
remoteInitialize();

// set up config
// eslint-disable-next-line import/order
import * as config from './config';
config.setup();

// Native

// Packages

import {networkInterfaces} from 'os';
import {resolve} from 'path';

import {app, BrowserWindow, Menu, screen} from 'electron';

import {gitDescribe} from 'git-describe';

const isDev = 'ELECTRON_IS_DEV' in process.env
  ? Number.parseInt(process.env.ELECTRON_IS_DEV!, 10) === 1
  : !app.isPackaged;
import parseUrl from 'parse-url';

import * as AppMenu from './menus/menu';
import * as plugins from './plugins';
import {RemoteTerminalServer} from './remote/websocket-server';
import {newWindow} from './ui/window';
import {installCLI} from './utils/cli-install';
import * as windowUtils from './utils/window-utils';

const windowSet = new Set<BrowserWindow>([]);

// Remote terminal server
let remoteServer: RemoteTerminalServer | null = null;

function getInternalIP(): string {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function getRemoteTerminalUrls(): {local: string; lan: string} | null {
  if (!remoteServer) return null;
  const cfg = config.getConfig();
  const port = cfg.remoteTerminal?.port || 3030;
  const lanIp = getInternalIP();
  const token = remoteServer.getAuthToken();
  const qs = token ? `?token=${token}` : '';
  return {
    local: `http://localhost:${port}${qs}`,
    lan: `http://${lanIp}:${port}${qs}`
  };
}

function sendRemoteUrlToWindow(win: BrowserWindow) {
  const urls = getRemoteTerminalUrls();
  if (urls && win.rpc) {
    win.rpc.emit('remote terminal url', urls);
  }
}

// expose to plugins
app.config = config;
app.plugins = plugins;
app.getWindows = () => new Set([...windowSet]); // return a clone

// function to retrieve the last focused window in windowSet;
// added to app object in order to expose it to plugins.
app.getLastFocusedWindow = () => {
  if (!windowSet.size) {
    return null;
  }
  return Array.from(windowSet).reduce((lastWindow, win) => {
    return win.focusTime > lastWindow.focusTime ? win : lastWindow;
  });
};

console.log('Disabling Chromium GPU blacklist');
app.commandLine.appendSwitch('ignore-gpu-blacklist');

if (isDev) {
  console.log('running in dev mode');

  // Override default appVersion which is set from package.json
  gitDescribe({customArguments: ['--tags']}, (error: any, gitInfo: {raw: string}) => {
    if (!error) {
      app.setVersion(gitInfo.raw);
    }
  });
} else {
  console.log('running in prod mode');
}

const url = `file://${resolve(isDev ? __dirname : app.getAppPath(), 'index.html')}`;
console.log('electron will open', url);

const recoverableDevtoolsErrors = [
  /Invalid header: Does not start with Cr24/i,
  /response code \d{3}/i,
  /net::ERR_/i,
  /failed to fetch/i,
  /extension is invalid/i,
  /manifest/i
];

const getDevtoolsErrorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

const isRecoverableDevtoolsError = (error: unknown) => {
  const message = getDevtoolsErrorMessage(error);
  return recoverableDevtoolsErrors.some((pattern) => pattern.test(message));
};

async function installDevExtensions(isDev_: boolean) {
  if (!isDev_) {
    return [];
  }
  const {default: installer, REACT_DEVELOPER_TOOLS, REDUX_DEVTOOLS} = await import('electron-devtools-installer');

  const extensions = [
    {id: REACT_DEVELOPER_TOOLS, name: 'React Developer Tools'},
    {id: REDUX_DEVTOOLS, name: 'Redux DevTools'}
  ];
  const forceDownload = Boolean(process.env.UPGRADE_EXTENSIONS);
  const installedExtensions: string[] = [];

  await Promise.all(
    extensions.map(async ({id, name}) => {
      try {
        installedExtensions.push(
          String(await installer(id, {
            forceDownload,
            loadExtensionOptions: {allowFileAccess: true}
          }))
        );
      } catch (error) {
        const message = getDevtoolsErrorMessage(error);

        if (isRecoverableDevtoolsError(error)) {
          console.warn(`[devtools] Skipping ${name}: ${message}`);
          return;
        }

        console.error(`[devtools] Failed to load ${name}`, error);
      }
    })
  );

  return installedExtensions;
}

// eslint-disable-next-line @typescript-eslint/no-misused-promises
app.on('ready', async () => {
  try {
    const installedExtensions = await installDevExtensions(isDev);
    if (installedExtensions.length > 0) {
      console.log('[devtools] Loaded extensions:', installedExtensions.join(', '));
    }
  } catch (err) {
    console.error('[devtools] Unexpected failure while preparing extensions', err);
  }

  // Start remote terminal server
  const cfg = config.getConfig();
  if (cfg.remoteTerminal?.enabled !== false) {
    try {
      const port = cfg.remoteTerminal?.port || 3030;
      const host = cfg.remoteTerminal?.host || '0.0.0.0';
      remoteServer = new RemoteTerminalServer(port, {
        ...cfg.remoteTerminal,
        port,
        host
      });
    } catch (err) {
      console.error('Failed to start remote terminal server:', err);
    }
  }

  function createWindow(
    fn?: (win: BrowserWindow) => void,
    options: {size?: [number, number]; position?: [number, number]} = {},
    profileName: string = config.getDefaultProfile()
  ) {
    const profileCfg = plugins.getDecoratedConfig(profileName);

    const winSet = config.getWin();
    let [startX, startY] = winSet.position;

    const [width, height] = options.size ? options.size : profileCfg.windowSize || winSet.size;

    const winPos = options.position;

    // Open the new window roughly the height of the header away from the
    // previous window. This also ensures in multi monitor setups that the
    // new terminal is on the correct screen.
    const focusedWindow = BrowserWindow.getFocusedWindow() || app.getLastFocusedWindow();
    // In case of options defaults position and size, we should ignore the focusedWindow.
    if (winPos !== undefined) {
      [startX, startY] = winPos;
    } else if (focusedWindow) {
      const points = focusedWindow.getPosition();
      const currentScreen = screen.getDisplayNearestPoint({
        x: points[0],
        y: points[1]
      });

      const biggestX = points[0] + 100 + width - currentScreen.bounds.x;
      const biggestY = points[1] + 100 + height - currentScreen.bounds.y;

      if (biggestX > currentScreen.size.width) {
        startX = 50;
      } else {
        startX = points[0] + 34;
      }
      if (biggestY > currentScreen.size.height) {
        startY = 50;
      } else {
        startY = points[1] + 34;
      }
    }

    if (!windowUtils.positionIsValid([startX, startY])) {
      [startX, startY] = config.windowDefaults.windowPosition;
    }

    const hwin = newWindow({width, height, x: startX, y: startY}, profileCfg, fn, profileName);
    windowSet.add(hwin);

    // Pass remote server state manager to window
    if (remoteServer) {
      hwin.remoteStateManager = remoteServer.getStateManager();
    }

    // Send remote terminal URL to window after it initializes
    hwin.webContents.on('did-finish-load', () => {
      // Small delay to ensure RPC is ready
      setTimeout(() => sendRemoteUrlToWindow(hwin), 500);
    });

    void hwin.loadURL(url);

    // the window can be closed by the browser process itself
    hwin.on('close', () => {
      hwin.clean();
      windowSet.delete(hwin);
    });

    return hwin;
  }

  // Listen for remote_create_window so WebUI can spawn a new Electron window
  if (remoteServer) {
    remoteServer.getStateManager().on('remote_create_window', () => {
      createWindow();
    });
  }

  // when opening create a new window
  createWindow();

  // expose to plugins
  app.createWindow = createWindow;

  // mac only. when the dock icon is clicked
  // and we don't have any active windows open,
  // we open one
  app.on('activate', () => {
    if (!windowSet.size) {
      createWindow();
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('will-quit', () => {
    remoteServer?.close();
  });

  const makeMenu = () => {
    const menu = plugins.decorateMenu(AppMenu.createMenu(createWindow, plugins.getLoadedPluginVersions));

    // If we're on Mac make a Dock Menu
    if (process.platform === 'darwin') {
      const dockMenu = Menu.buildFromTemplate([
        {
          label: 'New Window',
          click() {
            createWindow();
          }
        }
      ]);
      app.dock?.setMenu(dockMenu);
    }

    Menu.setApplicationMenu(AppMenu.buildMenu(menu));
  };

  plugins.onApp(app);
  makeMenu();
  plugins.subscribe(plugins.onApp.bind(undefined, app));
  config.subscribe(makeMenu);
  if (!isDev) {
    // check if should be set/removed as default ssh protocol client
    if (config.getConfig().defaultSSHApp && !app.isDefaultProtocolClient('ssh')) {
      console.log('Setting Hyper as default client for ssh:// protocol');
      app.setAsDefaultProtocolClient('ssh');
    } else if (!config.getConfig().defaultSSHApp && app.isDefaultProtocolClient('ssh')) {
      console.log('Removing Hyper from default client for ssh:// protocol');
      app.removeAsDefaultProtocolClient('ssh');
    }
    void installCLI(false);
  }
});

/**
 * Get last focused BrowserWindow or create new if none and callback
 * @param callback Function to call with the BrowserWindow
 */
function GetWindow(callback: (win: BrowserWindow) => void) {
  const lastWindow = app.getLastFocusedWindow();
  if (lastWindow) {
    callback(lastWindow);
  } else if (!lastWindow && {}.hasOwnProperty.call(app, 'createWindow')) {
    app.createWindow(callback);
  } else {
    // If createWindow doesn't exist yet ('ready' event was not fired),
    // sets his callback to an app.windowCallback property.
    app.windowCallback = callback;
  }
}

app.on('open-file', (_event, path) => {
  GetWindow((win: BrowserWindow) => {
    win.rpc.emit('open file', {path});
  });
});

app.on('open-url', (_event, sshUrl) => {
  GetWindow((win: BrowserWindow) => {
    win.rpc.emit('open ssh', parseUrl(sshUrl));
  });
});
