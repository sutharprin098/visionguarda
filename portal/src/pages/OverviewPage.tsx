import React from 'react';

export default function OverviewPage() {
  return (
    <iframe
      src="/overview/index.html"
      title="CamAI Enterprise Overview"
      style={{ width: '100vw', height: '100vh', border: 'none', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }}
    />
  );
}
