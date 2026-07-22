import { BrowserRouter, Routes, Route } from "react-router-dom";
import Landing from "./Landing";
import Dashboard from "./Dashboard";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<Dashboard />} />
        {/* Chat-only entry point (sidebar collapsed, no inbox preview), used by the
            "Essayer l'assistant IA gratuitement" links on the landing page */}
        <Route path="/assistant" element={<Dashboard startWithSidebarOpen={false} hideInboxPreview={true} />} />
      </Routes>
    </BrowserRouter>
  );
}