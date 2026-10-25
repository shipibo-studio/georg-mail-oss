import "@fontsource-variable/stack-sans-notch";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiError, SessionExpiredError } from "./api/client";
import { App } from "./components/App";
import { ToastProvider } from "./components/Toasts";
import { TooltipProvider } from "./components/Tooltip";
import { I18nProvider } from "./i18n/I18nProvider";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      refetchOnWindowFocus: true,
      // A refused or missing resource stays so: only network errors and server failures are retried.
      retry: (failures, error) =>
        !(error instanceof SessionExpiredError) && !(error instanceof ApiError && error.status < 500) && failures < 2,
    },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

createRoot(root).render(
  <StrictMode>
    {/* Motion follows the operating system's reduced-motion setting, like georg.css does. */}
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <I18nProvider>
          <ToastProvider>
            <TooltipProvider>
              <App />
            </TooltipProvider>
          </ToastProvider>
        </I18nProvider>
      </QueryClientProvider>
    </MotionConfig>
  </StrictMode>,
);
