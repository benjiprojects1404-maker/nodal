import React from "react";
import ReactDOM from "react-dom/client";
import NodalLanding from "./App.jsx";
import { Analytics } from '@vercel/analytics/react';

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <NodalLanding />
    <Analytics />
  </React.StrictMode>
);
