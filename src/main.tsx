import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { T } from "./config/tokens";
import "./index.css";

/* The only place the document chrome is painted. Values come from the tokens. */
document.documentElement.style.background = T.bg;
document.documentElement.style.colorScheme = "dark";
document.body.style.background = T.bg;
document.body.style.color = T.tPri;
document.body.style.fontFamily = T.font;

const root = document.getElementById("root");
if (!root) throw new Error("Mount point #root is missing from index.html");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
