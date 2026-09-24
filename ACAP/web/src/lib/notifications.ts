// Desktop Native System Push & Scheduled Notification Engine for CamAI Desktop
export interface DesktopNotificationSettings {
  enabled: boolean;
  soundEnabled: boolean;
  scheduleEnabled: boolean;
  startTime: string; // "HH:MM" e.g. "22:00"
  endTime: string;   // "HH:MM" e.g. "06:00"
  events: {
    person: boolean;
    vehicle: boolean;
    intrusion: boolean;
    rodent: boolean;
  };
}

const DEFAULT_DESKTOP_SETTINGS: DesktopNotificationSettings = {
  enabled: true,
  soundEnabled: true,
  scheduleEnabled: false,
  startTime: '22:00',
  endTime: '06:00',
  events: {
    person: false, // Only alert if user explicitly enables general presence
    vehicle: false, // Normal traffic detections are displayed in HUD, not spammed to alerts
    intrusion: true, // Violations, wrong-way, speeding, and perimeter breaches stay enabled
    rodent: true,
  },
};

const STORAGE_KEY = 'camai_desktop_notification_settings';

export const getDesktopNotificationSettings = (): DesktopNotificationSettings => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return DEFAULT_DESKTOP_SETTINGS;
  try {
    return { ...DEFAULT_DESKTOP_SETTINGS, ...JSON.parse(saved) };
  } catch (e) {
    return DEFAULT_DESKTOP_SETTINGS;
  }
};

export const saveDesktopNotificationSettings = (settings: DesktopNotificationSettings): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
};

export const isTimeInScheduleWindow = (startTimeStr: string, endTimeStr: string): boolean => {
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = startTimeStr.split(':').map(Number);
  const [endH, endM] = endTimeStr.split(':').map(Number);

  const startMinutes = (startH || 0) * 60 + (startM || 0);
  const endMinutes = (endH || 0) * 60 + (endM || 0);

  if (startMinutes <= endMinutes) {
    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
  }
  return currentMinutes >= startMinutes || currentMinutes <= endMinutes;
};

export const isDesktopNotificationAllowed = (eventType: 'person' | 'vehicle' | 'intrusion' | 'rodent' | string): boolean => {
  const settings = getDesktopNotificationSettings();
  if (!settings.enabled) return false;

  const key = eventType.toLowerCase();
  let matchedCategory: keyof DesktopNotificationSettings['events'] = 'intrusion';

  if (key.includes('person') || key.includes('human')) matchedCategory = 'person';
  else if (key.includes('vehicle') || key.includes('car') || key.includes('anpr')) matchedCategory = 'vehicle';
  else if (key.includes('rodent') || key.includes('motion') || key.includes('dce')) matchedCategory = 'rodent';

  if (!settings.events[matchedCategory]) return false;

  if (settings.scheduleEnabled) {
    if (!isTimeInScheduleWindow(settings.startTime, settings.endTime)) {
      return false;
    }
  }

  return true;
};

export const sendDesktopSystemNotification = async (
  title: string,
  body: string,
  eventType: string = 'intrusion'
): Promise<boolean> => {
  if (!isDesktopNotificationAllowed(eventType)) {
    console.log(`[Desktop Notification] Suppressed for type: ${eventType}`);
    return false;
  }

  if ('Notification' in window) {
    if (Notification.permission === 'granted') {
      try {
        const n = new Notification(title, {
          body,
          icon: '/favicon.svg',
          tag: `camai-desktop-${Date.now()}`,
        });
        n.onclick = () => {
          window.focus();
          n.close();
        };
        const settings = getDesktopNotificationSettings();
        if (settings.soundEnabled) {
          try {
            const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
            audio.volume = 0.5;
            audio.play().catch(() => {});
          } catch (e) {}
        }
        return true;
      } catch (e) {
        console.warn('Desktop notification spawn error:', e);
      }
    } else if (Notification.permission !== 'denied') {
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        return sendDesktopSystemNotification(title, body, eventType);
      }
    }
  }

  return false;
};
