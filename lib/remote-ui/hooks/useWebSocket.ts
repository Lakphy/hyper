import {useEffect, useRef, useCallback} from 'react';
import type {WSClientMessage, WSServerMessage} from '../types';
import {decodeBinaryMessages, isBinarySessionData} from '../utils/binary-protocol-browser';
import {useRemoteStore} from '../store/remote-store';

// Session data events are dispatched via this EventTarget so terminal
// components can subscribe without going through React re-renders.
export const sessionDataBus = new EventTarget();

export class SessionDataEvent extends Event {
  constructor(
    public readonly uid: string,
    public readonly data: string
  ) {
    super('session_data');
  }
}

export function useWebSocket(token: string) {
  const {state, dispatch} = useRemoteStore();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const backoffRef = useRef(1000);
  const mountedRef = useRef(true);

  const send = useCallback((message: WSClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;

    function connect() {
      if (!mountedRef.current) return;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${protocol}//${window.location.host}?token=${encodeURIComponent(token)}`;

      dispatch({type: 'SET_CONNECTION_STATUS', payload: 'connecting'});
      const ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mountedRef.current) return;
        dispatch({type: 'SET_CONNECTION_STATUS', payload: 'connected'});
        dispatch({type: 'SET_ERROR', payload: null});
        backoffRef.current = 1000;
      };

      ws.onmessage = (event: MessageEvent) => {
        if (!mountedRef.current) return;

        if (event.data instanceof ArrayBuffer) {
          if (isBinarySessionData(event.data)) {
            const messages = decodeBinaryMessages(event.data);
            for (const msg of messages) {
              sessionDataBus.dispatchEvent(new SessionDataEvent(msg.uid, msg.data));
            }
          }
          return;
        }

        try {
          const message = JSON.parse(event.data as string) as WSServerMessage;
          switch (message.type) {
            case 'snapshot':
              dispatch({type: 'SET_SNAPSHOT', payload: message.payload});
              break;
            case 'session_added':
              dispatch({type: 'ADD_SESSION', payload: message.payload});
              break;
            case 'session_removed':
              dispatch({type: 'REMOVE_SESSION', payload: message.payload});
              break;
            case 'session_history':
              sessionDataBus.dispatchEvent(
                new SessionDataEvent(message.payload.uid, message.payload.data)
              );
              dispatch({
                type: 'HISTORY_CHUNK_RECEIVED',
                payload: {uid: message.payload.uid, chunk: message.payload.chunk, total: message.payload.total}
              });
              if (message.payload.chunk >= message.payload.total - 1) {
                dispatch({type: 'HISTORY_COMPLETE', payload: {uid: message.payload.uid}});
              }
              break;
            case 'error':
              dispatch({type: 'SET_ERROR', payload: message.payload.message});
              break;
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!mountedRef.current) return;
        dispatch({type: 'SET_CONNECTION_STATUS', payload: 'disconnected'});
        scheduleReconnect();
      };

      ws.onerror = () => {
        if (!mountedRef.current) return;
        dispatch({type: 'SET_CONNECTION_STATUS', payload: 'error'});
      };
    }

    function scheduleReconnect() {
      if (!mountedRef.current) return;
      reconnectTimer.current = setTimeout(() => {
        backoffRef.current = Math.min(backoffRef.current * 2, 30000);
        connect();
      }, backoffRef.current);
    }

    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
      }
    };
  }, [token, dispatch]);

  return {status: state.connectionStatus, send, lastError: state.lastError};
}
