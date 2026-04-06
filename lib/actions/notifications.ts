import {NOTIFICATION_MESSAGE, NOTIFICATION_DISMISS, NOTIFICATION_REMOTE_URL} from '../../typings/constants/notifications';
import type {HyperActions} from '../../typings/hyper';

export function dismissNotification(id: string): HyperActions {
  return {
    type: NOTIFICATION_DISMISS,
    id
  };
}

export function addNotificationMessage(text: string, url: string | null = null, dismissable = true): HyperActions {
  return {
    type: NOTIFICATION_MESSAGE,
    text,
    url,
    dismissable
  };
}

export function setRemoteTerminalUrl(url: string): HyperActions {
  return {
    type: NOTIFICATION_REMOTE_URL,
    url
  };
}
