import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { ConfirmProvider } from './components/confirm';
import { ToastProvider } from './components/toast';
import { AuthProvider, cachedUser } from './lib/auth';
import { loadOutbox, restoreCache, startPersist } from './lib/offline';
import { I18nProvider } from './lib/i18n';
import { setupPwa } from './lib/pwa';
import { TourProvider } from './lib/tour';
import './index.css';

const queryClient = new QueryClient({
  // Data stays a day so the offline copy loaded on start is not dropped.
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 10_000, gcTime: 86_400_000 } },
});

setupPwa();

// Load the outbox and the offline copy of the data before the first screen, so the app works without signal.
async function start() {
  await Promise.all([loadOutbox(), restoreCache(queryClient, cachedUser()?.id)]);
  startPersist(queryClient, () => cachedUser()?.id);
  render();
}

const render = () => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <I18nProvider>
        <ToastProvider>
          <ConfirmProvider>
          <BrowserRouter>
            <AuthProvider>
              <TourProvider>
                <App />
              </TourProvider>
            </AuthProvider>
          </BrowserRouter>
          </ConfirmProvider>
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  </StrictMode>,
);

void start();
