/**
 * NotificationService - Event-Driven Push Notification Architecture
 * Dispatches genuine notifications from real in-game occurrences (transfers, low vitals, shifts).
 * Zero fabricated dummy notifications.
 */

export interface SystemNotification {
  id: string;
  title: string;
  body: string;
  timestamp: number;
  type: 'system' | 'finance' | 'vital' | 'work' | 'social';
  read: boolean;
}

export class NotificationService {
  private static instance: NotificationService;
  private notifications: SystemNotification[] = [];
  private postListeners = new Set<(n: SystemNotification) => void>();
  private changeListeners = new Set<() => void>();

  /** Fires for every newly posted notification (HUD toasts). Returns an unsubscribe function. */
  public onPost(cb: (n: SystemNotification) => void): () => void {
    this.postListeners.add(cb);
    return () => {
      this.postListeners.delete(cb);
    };
  }

  /** Fires whenever the list or unread count changes (HUD badge). Returns an unsubscribe function. */
  public subscribe(cb: () => void): () => void {
    this.changeListeners.add(cb);
    return () => {
      this.changeListeners.delete(cb);
    };
  }

  public static getInstance(): NotificationService {
    if (!NotificationService.instance) {
      NotificationService.instance = new NotificationService();
    }
    return NotificationService.instance;
  }

  public getNotifications(): SystemNotification[] {
    return [...this.notifications];
  }

  public getUnreadCount(): number {
    return this.notifications.filter((n) => !n.read).length;
  }

  public post(notification: Omit<SystemNotification, 'id' | 'timestamp' | 'read'>): SystemNotification {
    const item: SystemNotification = {
      ...notification,
      id: `notif_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: Date.now(),
      read: false,
    };
    this.notifications.unshift(item);
    this.postListeners.forEach((cb) => cb(item));
    this.changeListeners.forEach((cb) => cb());
    return item;
  }

  public markAllAsRead(): void {
    this.notifications.forEach((n) => (n.read = true));
    this.changeListeners.forEach((cb) => cb());
  }

  public clearAll(): void {
    this.notifications = [];
    this.changeListeners.forEach((cb) => cb());
  }
}

export const notificationService = NotificationService.getInstance();
