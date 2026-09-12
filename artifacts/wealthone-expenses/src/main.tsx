import { createRoot, type Root } from 'react-dom/client';
import { useEffect, useState } from 'react';
import { WifiOff, X } from 'lucide-react';

import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';
import { trackEvent } from '@/lib/analytics';

import './index.css';

const OFFLINE_STORAGE_AVAILABILITY_EVENT = 'ezyretire:offline-storage-availability';
const OFFLINE_STORAGE_WARNING_DISMISSED_KEY = 'ezyretire:offline-storage-warning-dismissed';

function getOfflineStorageRecoveryGuidance(userAgent: string) {
  if (/Firefox|FxiOS/i.test(userAgent)) {
    return 'In Firefox, open Settings → Privacy & Security → Cookies and Site Data, then allow site data for ezyRetire.';
  }

  if (/Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/i.test(userAgent)) {
    return 'In Safari, open Settings → Privacy, then allow website data for ezyRetire.';
  }

  if (/Chrome|Chromium|CriOS|Edg|OPR/i.test(userAgent)) {
    return 'In your browser settings, open Privacy and security → Site settings, then allow site data for ezyRetire.';
  }

  return 'Review your browser’s privacy or site-data settings and allow ezyRetire to store site data.';
}
const OFFLINE_STORAGE_UNAVAILABLE_KEY = 'ezyretire:offline-storage-unavailable';
const OFFLINE_STORAGE_RESULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
type OfflineStorageAvailabilityEvent = CustomEvent<{ available: boolean }>;
type PersistedOfflineStorageUnavailable = {
  confirmedAt: number;
  unavailable: true;
};

function wasOfflineStorageWarningDismissed() {
  try {
    return window.localStorage.getItem(OFFLINE_STORAGE_WARNING_DISMISSED_KEY) === 'true';
  } catch {
    return false;
  }
}

function hasConfirmedOfflineStorageUnavailable() {
  let persisted: string | null;
  try {
    persisted = window.localStorage.getItem(OFFLINE_STORAGE_UNAVAILABLE_KEY);
  } catch {
    return false;
  }
  if (!persisted) return false;

  try {
    const result = JSON.parse(persisted) as Partial<PersistedOfflineStorageUnavailable>;
    const isCurrent = result.unavailable === true
      && typeof result.confirmedAt === 'number'
      && Number.isFinite(result.confirmedAt)
      && result.confirmedAt <= Date.now()
      && Date.now() - result.confirmedAt <= OFFLINE_STORAGE_RESULT_MAX_AGE_MS;
    if (isCurrent) return true;

    window.localStorage.removeItem(OFFLINE_STORAGE_UNAVAILABLE_KEY);
    return false;
  } catch {
    try {
      window.localStorage.removeItem(OFFLINE_STORAGE_UNAVAILABLE_KEY);
    } catch {
      // Storage policy can also block cleanup; the malformed result is still ignored.
    }
    return false;
  }
}

function persistOfflineStorageAvailability(available: boolean) {
  try {
    if (available) {
      const recovered = hasConfirmedOfflineStorageUnavailable();
      window.localStorage.removeItem(OFFLINE_STORAGE_UNAVAILABLE_KEY);
      if (recovered) trackEvent('offline_storage_recovered');
      return;
    }

    const result: PersistedOfflineStorageUnavailable = {
      confirmedAt: Date.now(),
      unavailable: true,
    };
    window.localStorage.setItem(OFFLINE_STORAGE_UNAVAILABLE_KEY, JSON.stringify(result));
  } catch {
    // The confirmed result still applies for the lifetime of this page.
  }
}

function OfflineStorageWarning() {
  const [isVisible, setIsVisible] = useState(
    () => hasConfirmedOfflineStorageUnavailable() && !wasOfflineStorageWarningDismissed(),
  );
  const [isDismissed, setIsDismissed] = useState(wasOfflineStorageWarningDismissed);
  const recoveryGuidance = getOfflineStorageRecoveryGuidance(navigator.userAgent);

  useEffect(() => {
    if (isVisible) trackEvent('offline_storage_warning_shown');
    // Only the visibility restored at mount is an impression here; later transitions track below.
  }, []);

  useEffect(() => {
    const updateWarning = (event: Event) => {
      const { available } = (event as OfflineStorageAvailabilityEvent).detail;
      persistOfflineStorageAvailability(available);
      if (available || isDismissed) {
        setIsVisible(false);
        return;
      }

      setIsVisible((wasVisible) => {
        if (!wasVisible) trackEvent('offline_storage_warning_shown');
        return true;
      });
    };
    window.addEventListener(OFFLINE_STORAGE_AVAILABILITY_EVENT, updateWarning);
    return () => window.removeEventListener(OFFLINE_STORAGE_AVAILABILITY_EVENT, updateWarning);
  }, [isDismissed]);

  if (!isVisible) return null;

  const dismiss = () => {
    setIsDismissed(true);
    setIsVisible(false);
    trackEvent('offline_storage_warning_dismissed');
    try {
      window.localStorage.setItem(OFFLINE_STORAGE_WARNING_DISMISSED_KEY, 'true');
    } catch {
      // The notice still stays dismissed for the lifetime of this page.
    }
  };

  return (
    <aside
      aria-label="Offline access unavailable"
      className="fixed bottom-4 right-4 z-[110] flex max-w-sm items-start gap-3 rounded-lg border border-warning/30 bg-warning p-4 pr-10 text-warning shadow-lg"
      data-testid="notice-offline-storage-unavailable"
      role="status"
    >
      <WifiOff aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />
      <div>
        <p className="text-sm font-semibold">Offline access is unavailable</p>
        <p className="mt-1 text-sm">
          Your browser privacy settings prevent ezyRetire from saving its offline page. You can
          continue using ezyRetire while online.
        </p>
        <p className="mt-2 text-sm">{recoveryGuidance}</p>
      </div>
      <button
        aria-label="Dismiss offline access notice"
        className="absolute right-2 top-2 rounded p-1 text-warning hover:bg-warning focus:outline-none focus:ring-2 focus:ring-warning"
        data-testid="button-dismiss-offline-storage-warning"
        onClick={dismiss}
        type="button"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </aside>
  );
}
export function MainApplication() {
  return (
    <ErrorBoundary>
      <App />
      <OfflineStorageWarning />
    </ErrorBoundary>
  );
}

type RootWindow = Window & {
  __ezyRetireRoot?: Root;
};

const rootWindow = window as RootWindow;
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Application root element is missing');
}

const root = rootWindow.__ezyRetireRoot ?? createRoot(rootElement, {
  // Keeps caught errors off reportError(), which would raise the dev overlay.
  onCaughtError: (error, errorInfo) => {
    console.error(error, errorInfo.componentStack);
  },
});
rootWindow.__ezyRetireRoot = root;

root.render(<MainApplication />);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const basePath = import.meta.env.BASE_URL;
    navigator.serviceWorker
      .register(`${basePath}sw.js`, { scope: basePath })
      .then(async (registration) => {
        const worker = registration.active ?? await navigator.serviceWorker.ready.then(
          (readyRegistration) => readyRegistration.active,
        );
        if (!worker) return;

        let activeCheck: Promise<void> | null = null;

        const checkOfflineStorage = () => {
          if (activeCheck) return activeCheck;

          activeCheck = new Promise<boolean | null>((resolve) => {
            const channel = new MessageChannel();
            const timeout = window.setTimeout(() => {
              channel.port1.close();
              resolve(null);
            }, 2000);
            channel.port1.onmessage = (
              event: MessageEvent<{ offlineStorageAvailable?: boolean }>,
            ) => {
              window.clearTimeout(timeout);
              channel.port1.close();
              resolve(event.data.offlineStorageAvailable !== false);
            };
            worker.postMessage({ type: 'CHECK_OFFLINE_STORAGE' }, [channel.port2]);
          }).then((available) => {
            if (available === null) return;
            window.dispatchEvent(new CustomEvent(OFFLINE_STORAGE_AVAILABILITY_EVENT, {
              detail: { available },
            }));
          }).finally(() => {
            activeCheck = null;
          });

          return activeCheck;
        };

        const recheckWhenVisible = () => {
          if (document.visibilityState === 'visible') void checkOfflineStorage();
        };

        document.addEventListener('visibilitychange', recheckWhenVisible);
        await checkOfflineStorage();
      })
      .catch((error: unknown) => {
        console.warn('Service worker registration failed', error);
      });
  });
}
