import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./ErrorBoundary";
import { createRootErrorHandlers } from "./error-reporting";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

const router = createBrowserRouter([
  {
    path: "*",
    element: (
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    ),
  },
]);

createRoot(document.getElementById("root")!, createRootErrorHandlers()).render(
  <StrictMode>
    <ErrorBoundary>
      <RouterProvider router={router} />
    </ErrorBoundary>
  </StrictMode>,
);
