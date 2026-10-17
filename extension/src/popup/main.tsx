import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "../../../shared/tailadmin/tailwind.css";
import { ThemeProvider } from "@tailadmin";
import { Popup } from "./Popup";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <Popup />
    </ThemeProvider>
  </StrictMode>,
);
