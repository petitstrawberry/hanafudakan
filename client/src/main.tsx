import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { CardSkinProvider } from "./lib/cardSkin";
import "./styles.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <CardSkinProvider>
      <App />
    </CardSkinProvider>
  </React.StrictMode>,
);
