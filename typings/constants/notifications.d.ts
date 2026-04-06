export const NOTIFICATION_MESSAGE = 'NOTIFICATION_MESSAGE';
export const NOTIFICATION_DISMISS = 'NOTIFICATION_DISMISS';
export const NOTIFICATION_REMOTE_URL = 'NOTIFICATION_REMOTE_URL';

export interface NotificationMessageAction {
  type: typeof NOTIFICATION_MESSAGE;
  text: string;
  url: string | null;
  dismissable: boolean;
}
export interface NotificationDismissAction {
  type: typeof NOTIFICATION_DISMISS;
  id: string;
}
export interface NotificationRemoteUrlAction {
  type: typeof NOTIFICATION_REMOTE_URL;
  url: string;
}

export type NotificationActions = NotificationMessageAction | NotificationDismissAction | NotificationRemoteUrlAction;
