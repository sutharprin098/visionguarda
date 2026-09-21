import os

html_content = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CamAI Enterprise — System Architecture & Pillar Overview</title>
    <meta name="description" content="Comprehensive Light Theme Architecture Overview for CamAI Enterprise CCTV AI Platform covering Web SaaS Portal, Desktop Client, Mobile App, and ACAP Native Edge Application with full UI screenshots.">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Fira+Code:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-body: #f8fafc;
            --bg-card: #ffffff;
            --bg-card-hover: #f1f5f9;
            --border-color: #e2e8f0;
            --border-highlight: #cbd5e1;
            --text-primary: #0f172a;
            --text-secondary: #475569;
            --text-muted: #64748b;
            --accent-blue: #2563eb;
            --accent-cyan: #0284c7;
            --accent-emerald: #059669;
            --accent-indigo: #4f46e5;
            --accent-amber: #d97706;
            --accent-rose: #e11d48;
            --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.05);
            --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.05);
            --shadow-lg: 0 10px 25px rgba(0, 0, 0, 0.08);
            --radius-lg: 12px;
            --radius-xl: 16px;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: var(--bg-body);
            color: var(--text-primary);
            line-height: 1.6;
            padding-top: 80px;
            padding-bottom: 60px;
        }

        /* Top Navigation Bar */
        .navbar {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            height: 72px;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(12px);
            border-bottom: 1px solid var(--border-color);
            box-shadow: var(--shadow-sm);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 2rem;
        }

        .brand-logo {
            display: flex;
            align-items: center;
            gap: 12px;
            font-size: 1.2rem;
            font-weight: 800;
            color: var(--text-primary);
            text-decoration: none;
            letter-spacing: -0.5px;
        }

        .brand-logo svg {
            width: 28px;
            height: 28px;
            color: var(--accent-blue);
        }

        .badge-tag {
            font-size: 0.75rem;
            background: #eff6ff;
            color: var(--accent-blue);
            padding: 3px 10px;
            border-radius: 20px;
            border: 1px solid #bfdbfe;
            font-weight: 700;
        }

        .nav-pillars {
            display: flex;
            gap: 6px;
        }

        .pillar-tab {
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 0.875rem;
            font-weight: 600;
            color: var(--text-secondary);
            background: transparent;
            border: 1px solid transparent;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .pillar-tab svg {
            width: 18px;
            height: 18px;
        }

        .pillar-tab:hover {
            color: var(--text-primary);
            background: var(--bg-card-hover);
            border-color: var(--border-color);
        }

        .pillar-tab.active {
            color: #ffffff;
            background: var(--accent-blue);
            border-color: var(--accent-blue);
            box-shadow: 0 2px 8px rgba(37, 99, 235, 0.3);
        }

        .container {
            max-width: 1240px;
            margin: 0 auto;
            padding: 0 1.5rem;
        }

        /* Hero Header */
        .hero {
            text-align: center;
            padding: 2.5rem 1rem 2rem;
            background: #ffffff;
            border: 1px solid var(--border-color);
            border-radius: var(--radius-xl);
            margin-bottom: 2rem;
            box-shadow: var(--shadow-sm);
        }

        .hero-domain {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            background: #f1f5f9;
            border: 1px solid var(--border-color);
            padding: 6px 16px;
            border-radius: 30px;
            font-family: 'Fira Code', monospace;
            font-size: 0.85rem;
            color: var(--accent-indigo);
            font-weight: 600;
            margin-bottom: 1rem;
        }

        .hero-title {
            font-size: 2.5rem;
            font-weight: 900;
            letter-spacing: -0.8px;
            color: var(--text-primary);
            margin-bottom: 0.75rem;
        }

        .hero-desc {
            max-width: 820px;
            margin: 0 auto;
            font-size: 1.05rem;
            color: var(--text-secondary);
        }

        /* Branch Grid */
        .branch-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
            gap: 1.25rem;
            margin-bottom: 2.5rem;
        }

        .branch-card {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-lg);
            padding: 1.5rem;
            transition: all 0.25s ease;
            cursor: pointer;
            position: relative;
            box-shadow: var(--shadow-sm);
        }

        .branch-card:hover {
            transform: translateY(-4px);
            border-color: var(--border-highlight);
            box-shadow: var(--shadow-md);
        }

        .branch-card-header {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 1rem;
        }

        .icon-box {
            width: 44px;
            height: 44px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f1f5f9;
            color: var(--text-primary);
        }

        .branch-card.portal .icon-box { background: #e0f2fe; color: var(--accent-cyan); }
        .branch-card.desktop .icon-box { background: #e0e7ff; color: var(--accent-indigo); }
        .branch-card.mobile .icon-box { background: #d1fae5; color: var(--accent-emerald); }
        .branch-card.acap .icon-box { background: #fef3c7; color: var(--accent-amber); }

        .icon-box svg {
            width: 24px;
            height: 24px;
        }

        .branch-title {
            font-size: 1.15rem;
            font-weight: 700;
            color: var(--text-primary);
        }

        .branch-subtitle {
            font-size: 0.8rem;
            color: var(--text-muted);
            font-family: 'Fira Code', monospace;
        }

        .branch-desc {
            font-size: 0.875rem;
            color: var(--text-secondary);
            margin-bottom: 1rem;
            line-height: 1.5;
        }

        .branch-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }

        .tag {
            font-size: 0.75rem;
            background: #f1f5f9;
            padding: 2px 8px;
            border-radius: 4px;
            border: 1px solid var(--border-color);
            color: var(--text-secondary);
            font-weight: 500;
        }

        /* Detail Panels */
        .panel {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-xl);
            padding: 2rem;
            margin-bottom: 2.5rem;
            box-shadow: var(--shadow-sm);
            display: none;
        }

        .panel.active {
            display: block;
            animation: fadeIn 0.3s ease;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .panel-title-bar {
            display: flex;
            align-items: center;
            gap: 12px;
            margin-bottom: 1.5rem;
            padding-bottom: 1rem;
            border-bottom: 1px solid var(--border-color);
        }

        .panel-title-bar svg {
            width: 28px;
            height: 28px;
            color: var(--accent-blue);
        }

        .panel-title {
            font-size: 1.5rem;
            font-weight: 800;
            letter-spacing: -0.4px;
        }

        .panel-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 2rem;
            margin-bottom: 2rem;
        }

        @media (max-width: 900px) {
            .panel-grid { grid-template-columns: 1fr; }
        }

        .feature-list {
            list-style: none;
        }

        .feature-item {
            padding: 0.75rem 0;
            border-bottom: 1px solid var(--border-color);
            display: flex;
            align-items: flex-start;
            gap: 12px;
        }

        .feature-item:last-child { border-bottom: none; }

        .check-icon {
            width: 20px;
            height: 20px;
            color: var(--accent-emerald);
            flex-shrink: 0;
            margin-top: 2px;
        }

        .code-box {
            background: #0f172a;
            border: 1px solid #1e293b;
            border-radius: 10px;
            padding: 1.25rem;
            font-family: 'Fira Code', monospace;
            font-size: 0.85rem;
            color: #38bdf8;
            overflow-x: auto;
            white-space: pre;
            box-shadow: inset 0 2px 4px rgba(0,0,0,0.3);
        }

        /* Screenshot Showcase Grid */
        .showcase-header {
            font-size: 1.15rem;
            font-weight: 800;
            color: var(--text-primary);
            margin: 2rem 0 1rem;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .showcase-header svg {
            width: 20px;
            height: 20px;
            color: var(--accent-blue);
        }

        .screenshot-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 1.5rem;
        }

        .screenshot-card {
            background: #ffffff;
            border: 1px solid var(--border-color);
            border-radius: var(--radius-lg);
            overflow: hidden;
            box-shadow: var(--shadow-sm);
            transition: all 0.25s ease;
        }

        .screenshot-card:hover {
            transform: translateY(-3px);
            box-shadow: var(--shadow-md);
            border-color: var(--border-highlight);
        }

        .screenshot-img-wrapper {
            width: 100%;
            height: 220px;
            background: #f1f5f9;
            overflow: hidden;
            position: relative;
            border-bottom: 1px solid var(--border-color);
        }

        .screenshot-img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            object-position: top center;
            transition: transform 0.3s ease;
        }

        .screenshot-card:hover .screenshot-img {
            transform: scale(1.03);
        }

        .screenshot-caption {
            padding: 1rem;
        }

        .screenshot-title {
            font-size: 0.95rem;
            font-weight: 700;
            color: var(--text-primary);
            margin-bottom: 4px;
        }

        .screenshot-desc {
            font-size: 0.825rem;
            color: var(--text-secondary);
        }

        /* Feature Matrix Table */
        .matrix-table-container {
            overflow-x: auto;
            border: 1px solid var(--border-color);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-sm);
        }

        .matrix-table {
            width: 100%;
            border-collapse: collapse;
            background: #ffffff;
        }

        .matrix-table th, .matrix-table td {
            padding: 1rem 1.25rem;
            text-align: left;
            border-bottom: 1px solid var(--border-color);
            font-size: 0.875rem;
        }

        .matrix-table th {
            background: #f8fafc;
            font-weight: 700;
            color: var(--text-primary);
            text-transform: uppercase;
            font-size: 0.75rem;
            letter-spacing: 0.5px;
        }

        .matrix-table tr:hover {
            background: #f1f5f9;
        }

        .search-bar-wrapper {
            position: relative;
            width: 100%;
            max-width: 380px;
        }

        .search-bar {
            width: 100%;
            padding: 8px 14px 8px 38px;
            background: #ffffff;
            border: 1px solid var(--border-highlight);
            border-radius: 8px;
            color: var(--text-primary);
            font-size: 0.875rem;
            outline: none;
        }

        .search-bar:focus {
            border-color: var(--accent-blue);
            box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
        }

        .search-icon {
            position: absolute;
            left: 12px;
            top: 50%;
            transform: translateY(-50%);
            width: 16px;
            height: 16px;
            color: var(--text-muted);
        }

        footer {
            text-align: center;
            padding: 2rem 0;
            color: var(--text-muted);
            font-size: 0.85rem;
            border-top: 1px solid var(--border-color);
            margin-top: 3rem;
        }
    </style>
</head>
<body>

    <!-- Top Navigation Bar -->
    <nav class="navbar">
        <a href="#" class="brand-logo">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
            </svg>
            <span>CamAI Enterprise</span>
            <span class="badge-tag">Light Architecture v2.4</span>
        </a>
        <div class="nav-pillars">
            <button class="pillar-tab active" onclick="switchTab('portal')">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>
                Web SaaS Portal
            </button>
            <button class="pillar-tab" onclick="switchTab('desktop')">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                Desktop Client
            </button>
            <button class="pillar-tab" onclick="switchTab('mobile')">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
                Mobile App
            </button>
            <button class="pillar-tab" onclick="switchTab('acap')">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"/></svg>
                ACAP Native Edge
            </button>
            <button class="pillar-tab" onclick="switchTab('matrix')">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                Feature Matrix
            </button>
        </div>
    </nav>

    <main class="container">

        <!-- Hero Header -->
        <header class="hero">
            <div class="hero-domain">camai.princesite.in/overview</div>
            <h1 class="hero-title">CamAI Platform Overview & Architecture</h1>
            <p class="hero-desc">
                An end-to-end breakdown of CamAI across all four enterprise branches: Web SaaS Portal, Desktop Client, Mobile Push App, and ACAP Native Edge Analytics with full UI screenshots.
            </p>
        </header>

        <!-- Branch Grid -->
        <div class="branch-grid">
            <div class="branch-card portal" onclick="switchTab('portal')">
                <div class="branch-card-header">
                    <div class="icon-box">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>
                    </div>
                    <div>
                        <div class="branch-title">Web SaaS Portal</div>
                        <div class="branch-subtitle">portal/ & supabase/</div>
                    </div>
                </div>
                <div class="branch-desc">Cloud SaaS dashboard, multi-tenant organization management, RLS database security, camera registry & license control.</div>
                <div class="branch-tags">
                    <span class="tag">React</span>
                    <span class="tag">Tailwind</span>
                    <span class="tag">Supabase RLS</span>
                    <span class="tag">Edge Functions</span>
                </div>
            </div>

            <div class="branch-card desktop" onclick="switchTab('desktop')">
                <div class="branch-card-header">
                    <div class="icon-box">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                    </div>
                    <div>
                        <div class="branch-title">Desktop Client</div>
                        <div class="branch-subtitle">desktop/</div>
                    </div>
                </div>
                <div class="branch-desc">Windows monitoring app supervising local engine, DPAPI machine binding, zero-latency 30-40 FPS MJPEG grid view.</div>
                <div class="branch-tags">
                    <span class="tag">Electron</span>
                    <span class="tag">TypeScript</span>
                    <span class="tag">FastAPI Sync</span>
                    <span class="tag">DPAPI</span>
                </div>
            </div>

            <div class="branch-card mobile" onclick="switchTab('mobile')">
                <div class="branch-card-header">
                    <div class="icon-box">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
                    </div>
                    <div>
                        <div class="branch-title">Mobile Application</div>
                        <div class="branch-subtitle">mobile/</div>
                    </div>
                </div>
                <div class="branch-desc">Real-time mobile alerts, ROI editor, live RTSP mobile streaming & Telegram push bot integration.</div>
                <div class="branch-tags">
                    <span class="tag">Android / iOS</span>
                    <span class="tag">Capacitor</span>
                    <span class="tag">Telegram Webhook</span>
                    <span class="tag">Mobile RTSP</span>
                </div>
            </div>

            <div class="branch-card acap" onclick="switchTab('acap')">
                <div class="branch-card-header">
                    <div class="icon-box">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"/></svg>
                    </div>
                    <div>
                        <div class="branch-title">ACAP Native Edge</div>
                        <div class="branch-subtitle">ACAP/</div>
                    </div>
                </div>
                <div class="branch-desc">Hardware native edge C++ application for IP camera hardware with NPU DLPU acceleration & VDO zero-copy.</div>
                <div class="branch-tags">
                    <span class="tag">C/C++20</span>
                    <span class="tag">VDO API</span>
                    <span class="tag">Larod NPU</span>
                    <span class="tag">axevent / axoverlay</span>
                </div>
            </div>
        </div>

        <!-- Detail Panel 1: Web SaaS Portal -->
        <div id="panel-portal" class="panel active">
            <div class="panel-title-bar">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>
                <h2 class="panel-title">Web SaaS Portal & Cloud Management (`portal/` & `supabase/`)</h2>
            </div>
            <div class="panel-grid">
                <div>
                    <p class="branch-desc">
                        The central cloud administrative portal empowers organizations to manage camera fleets, configure line-crossing and ROI intrusion zones, assign license seats, and review security audit logs.
                    </p>
                    <ul class="feature-list">
                        <li class="feature-item">
                            <svg class="check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                            <div><strong>Multi-Tenant Data Isolation:</strong> Strict PostgreSQL Row-Level Security (RLS) ensures total privacy across organizations.</div>
                        </li>
                        <li class="feature-item">
                            <svg class="check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                            <div><strong>Interactive Zone Studio:</strong> Visual web editor for defining custom polygonal ROI boundaries and crossing vectors.</div>
                        </li>
                        <li class="feature-item">
                            <svg class="check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                            <div><strong>Realtime Alerts & Telegram Integration:</strong> Instant event webhooks dispatched automatically by Supabase Edge Functions.</div>
                        </li>
                    </ul>
                </div>
                <div>
                    <div class="code-box">// portal/src/lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Realtime Camera & ROI Configuration Sync
supabase
  .channel('camera-changes')
  .on('postgres_changes', { event: '*', schema: 'public', table: 'cameras' }, payload => {
    console.log('Realtime Camera Config Updated:', payload.new);
  })
  .subscribe();</div>
                </div>
            </div>

            <!-- Web SaaS Portal Screenshots -->
            <div class="showcase-header">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                Web SaaS Portal Screenshots
            </div>
            <div class="screenshot-grid">
                <div class="screenshot-card">
                    <div class="screenshot-img-wrapper">
                        <img src="assets/welcome_dashboard.png" alt="Welcome Dashboard" class="screenshot-img">
                    </div>
                    <div class="screenshot-caption">
                        <div class="screenshot-title">Welcome Dashboard & Analytics</div>
                        <div class="screenshot-desc">High-level metrics overview, active camera count, system status, and alert summary.</div>
                    </div>
                </div>

                <div class="screenshot-card">
                    <div class="screenshot-img-wrapper">
                        <img src="assets/zone_studio_editor.png" alt="Zone Studio Editor" class="screenshot-img">
                    </div>
                    <div class="screenshot-caption">
                        <div class="screenshot-title">Interactive Zone Studio Editor</div>
                        <div class="screenshot-desc">Visual ROI polygon editor for defining perimeter security lines and detection zones.</div>
                    </div>
                </div>

                <div class="screenshot-card">
                    <div class="screenshot-img-wrapper">
                        <img src="assets/camera_workspace_live.png" alt="Camera Workspace Live" class="screenshot-img">
                    </div>
                    <div class="screenshot-caption">
                        <div class="screenshot-title">Live Camera Workspace</div>
                        <div class="screenshot-desc">Multi-stream CCTV grid view with real-time AI bounding boxes and detection overlays.</div>
                    </div>
                </div>

                <div class="screenshot-card">
                    <div class="screenshot-img-wrapper">
                        <img src="assets/licenses_table.png" alt="License Management" class="screenshot-img">
                    </div>
                    <div class="screenshot-caption">
                        <div class="screenshot-title">License Seat Management</div>
                        <div class="screenshot-desc">Enterprise software license allocation, hardware machine key binding, and status tracking.</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Detail Panel 2: Desktop Client -->
        <div id="panel-desktop" class="panel">
            <div class="panel-title-bar">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                <h2 class="panel-title">Windows Desktop Client (`desktop/`)</h2>
            </div>
            <div class="panel-grid">
                <div>
                    <p class="branch-desc">
                        Supervises the local AI engine, manages encrypted DPAPI hardware binding, auto-discovers network cameras, and delivers zero-latency 30-40 FPS MJPEG monitoring grids.
                    </p>
                    <ul class="feature-list">
                        <li class="feature-item">
                            <svg class="check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                            <div><strong>DPAPI Machine Binding:</strong> Encrypts hardware session tokens using Windows MachineGUID, CPU ID, and TPM serials.</div>
                        </li>
                        <li class="feature-item">
                            <svg class="check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                            <div><strong>High-FPS Monitoring Grid:</strong> 30-40 FPS local preview stream with decoupled background AI inference thread.</div>
                        </li>
                        <li class="feature-item">
                            <svg class="check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                            <div><strong>Local RTSP & ONVIF Discovery:</strong> Auto-detects local IP cameras and handles connection failovers.</div>
                        </li>
                    </ul>
                </div>
                <div>
                    <div class="code-box">// desktop/src/lib/localEngine.ts
export async function syncCamerasToLocalEngine(cameras: any[]) {
  const status = await getEngineAppStatus();
  if (!status) return;

  for (const cam of cameras) {
    await fetch(`${ENGINE_BASE}/api/cameras/${cam.id}/config`, {
      method: 'POST',
      headers: await controlHeaders(),
      body: JSON.stringify({
        zones: cam.zones,
        lines: cam.lines,
        zone_profile: cam.zone_profile
      })
    });
  }
}</div>
                </div>
            </div>

            <!-- Desktop Client Screenshots -->
            <div class="showcase-header">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                Desktop Monitoring Client Screenshots
            </div>
            <div class="screenshot-grid">
                <div class="screenshot-card">
                    <div class="screenshot-img-wrapper">
                        <img src="assets/camera_workspace_live.png" alt="Desktop Camera Grid" class="screenshot-img">
                    </div>
                    <div class="screenshot-caption">
                        <div class="screenshot-title">High-FPS Desktop CCTV Grid</div>
                        <div class="screenshot-desc">Zero-latency local MJPEG stream viewer with AI bounding box overlays.</div>
                    </div>
                </div>

                <div class="screenshot-card">
                    <div class="screenshot-img-wrapper">
                        <img src="assets/downloads_screen.png" alt="Desktop App Downloads" class="screenshot-img">
                    </div>
                    <div class="screenshot-caption">
                        <div class="screenshot-title">Downloads & Installer Desk</div>
                        <div class="screenshot-desc">Windows Desktop installer download management with local version sync.</div>
                    </div>
                </div>

                <div class="screenshot-card">
                    <div class="screenshot-img-wrapper">
                        <img src="assets/add_camera_rtsp_modal.png" alt="Add Camera RTSP Modal" class="screenshot-img">
                    </div>
                    <div class="screenshot-caption">
                        <div class="screenshot-title">ONVIF / RTSP Camera Add Modal</div>
                        <div class="screenshot-desc">Quick setup wizard for adding RTSP streams and IP cameras to the local monitoring engine.</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Detail Panel 3: Mobile App -->
        <div id="panel-mobile" class="panel">
            <div class="panel-title-bar">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
                <h2 class="panel-title">Mobile Application (`mobile/`)</h2>
            </div>
            <div class="panel-grid">
                <div>
                    <p class="branch-desc">
                        Provides real-time mobile push notifications, live RTSP stream playback with bounding box overlays, mobile camera RTSP streaming, and Telegram bot alert routing.
                    </p>
                    <ul class="feature-list">
                        <li class="feature-item">
                            <svg class="check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                            <div><strong>Instant Alert Notifications:</strong> Snapshot preview push notifications dispatched to mobile devices via Telegram webhook.</div>
                        </li>
                        <li class="feature-item">
                            <svg class="check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                            <div><strong>Mobile Camera IP Emulation:</strong> Transforms Android/iOS phone camera into an active RTSP source for CamAI detection.</div>
                        </li>
                        <li class="feature-item">
                            <svg class="check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                            <div><strong>Mobile Touch ROI Editor:</strong> Intuitive touch interface for drawing security detection boundaries on mobile screens.</div>
                        </li>
                    </ul>
                </div>
                <div>
                    <div class="code-box">// ACAP/phone_camera_connector.py
import requests

def connect_mobile_phone_stream(phone_ip="192.168.29.24", port=8080):
    stream_url = f"http://{phone_ip}:{port}/video"
    print(f"[*] Connecting Mobile Camera: {stream_url}")
    # Streams raw video to CamAI Engine for real-time detection
    return stream_url</div>
                </div>
            </div>

            <!-- Mobile App Screenshots -->
            <div class="showcase-header">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                Mobile Application Screenshots
            </div>
            <div class="screenshot-grid">
                <div class="screenshot-card">
                    <div class="screenshot-img-wrapper">
                        <img src="assets/mobile_camera_live.png" alt="Mobile Camera Live" class="screenshot-img">
                    </div>
                    <div class="screenshot-caption">
                        <div class="screenshot-title">Live Mobile Camera Stream</div>
                        <div class="screenshot-desc">Mobile live camera view with real-time bounding box AI overlay detection.</div>
                    </div>
                </div>

                <div class="screenshot-card">
                    <div class="screenshot-img-wrapper">
                        <img src="assets/mobile_roi_editor.png" alt="Mobile ROI Editor" class="screenshot-img">
                    </div>
                    <div class="screenshot-caption">
                        <div class="screenshot-title">Touch ROI Polygon Editor</div>
                        <div class="screenshot-desc">Mobile touch controls for setting up line crossing vectors and security zones.</div>
                    </div>
                </div>

                <div class="screenshot-card">
                    <div class="screenshot-img-wrapper">
                        <img src="assets/mobile_alerts_timeline.png" alt="Mobile Alerts Timeline" class="screenshot-img">
                    </div>
                    <div class="screenshot-caption">
                        <div class="screenshot-title">Mobile Alert Incident History</div>
                        <div class="screenshot-desc">Scrollable security alert event timeline with snapshot playback on mobile.</div>
                    </div>
                </div>

                <div class="screenshot-card">
                    <div class="screenshot-img-wrapper">
                        <img src="assets/telegram_bot_mobile.png" alt="Telegram Bot Mobile" class="screenshot-img">
                    </div>
                    <div class="screenshot-caption">
                        <div class="screenshot-title">Telegram Security Bot Alerts</div>
                        <div class="screenshot-desc">Instant Telegram push messages with annotated intrusion images and video links.</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Detail Panel 4: ACAP Native Edge Application -->
        <div id="panel-acap" class="panel">
            <div class="panel-title-bar">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"/></svg>
                <h2 class="panel-title">ACAP Native Edge Application (`ACAP/`)</h2>
            </div>
            <div class="panel-grid">
                <div>
                    <p class="branch-desc">
                        A C/C++ native application compiled for IP camera edge hardware (ARTPEC-8 / ARTPEC-7). Runs 100% on-device AI analytics with zero cloud latency and full ONVIF compliance.
                    </p>
                    <ul class="feature-list">
                        <li class="feature-item">
                            <svg class="check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                            <div><strong>VDO Stream API (`vdo-stream.h`):</strong> Zero-copy NV12 frame buffer acquisition directly from camera hardware ISP.</div>
                        </li>
                        <li class="feature-item">
                            <svg class="check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                            <div><strong>Larod NPU API (`larod.h`):</strong> NPU hardware acceleration for YOLOX-Tiny ONNX models with 8-bit quantization.</div>
                        </li>
                        <li class="feature-item">
                            <svg class="check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                            <div><strong>Native axevent & axoverlay:</strong> ONVIF XML event publishing and hardware stream bounding box rendering.</div>
                        </li>
                        <li class="feature-item">
                            <svg class="check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                            <div><strong>C++ ByteTrack Tracker:</strong> Kalman Filter state vector + Hungarian matching algorithm for 0 ID switches.</div>
                        </li>
                    </ul>
                </div>
                <div>
                    <div class="code-box">// ACAP/app/camai_engine.cpp
void CamAIEngine::process_loop() {
    while (is_running_) {
        VideoFrame frame;
        video_pipeline_.capture_frame(frame);
        
        // 1. Larod NPU AI Inference
        std::vector<BoundingBox> detections;
        inference_engine_.run_inference(frame, detections, latency_ms);
        
        // 2. C++ ByteTrack Multi-Object Tracking
        std::vector<BoundingBox> tracked;
        tracker_.update(detections, tracked);
        
        // 3. Security ROI Intrusion Math & Event Emission
        security_module_->process_frame(meta, alerts);
        for (auto& alert : alerts) event_producer_.send_event(alert);
        
        // 4. axoverlay Stream Bounding Box Overlay
        overlay_manager_.render(tracked, alerts);
    }
}</div>
                </div>
            </div>
        </div>

        <!-- Detail Panel 5: Feature Matrix Table -->
        <div id="panel-matrix" class="panel">
            <div class="panel-title-bar" style="justify-content: space-between;">
                <div style="display: flex; align-items: center; gap: 12px;">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                    <h2 class="panel-title">A-to-Z Complete Feature Matrix</h2>
                </div>
                <div class="search-bar-wrapper">
                    <svg class="search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                    <input type="text" class="search-bar" id="matrixSearch" placeholder="Filter features..." onkeyup="filterMatrix()">
                </div>
            </div>
            <div class="matrix-table-container">
                <table class="matrix-table" id="matrixTable">
                    <thead>
                        <tr>
                            <th>Feature Capability</th>
                            <th>Web SaaS (`portal/`)</th>
                            <th>Desktop Client (`desktop/`)</th>
                            <th>Mobile App (`mobile/`)</th>
                            <th>ACAP Native Edge (`ACAP/`)</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td><strong>AI Model Inference</strong></td>
                            <td>Cloud Node Optional</td>
                            <td>Local GPU / OpenVINO</td>
                            <td>Cloud Streamed</td>
                            <td><span style="color: var(--accent-emerald); font-weight: 700;">✓ ARTPEC-8 DLPU (Larod)</span></td>
                        </tr>
                        <tr>
                            <td><strong>Video Pipeline</strong></td>
                            <td>WebRTC / HLS</td>
                            <td>MJPEG Grid (30-40 FPS)</td>
                            <td>RTSP / MJPEG Mobile</td>
                            <td><span style="color: var(--accent-emerald); font-weight: 700;">✓ Edge VDO Zero-Copy</span></td>
                        </tr>
                        <tr>
                            <td><strong>Multi-Object Tracking</strong></td>
                            <td>Cloud Engine</td>
                            <td>Python ByteTrack</td>
                            <td>Cloud Streamed</td>
                            <td><span style="color: var(--accent-emerald); font-weight: 700;">✓ C++ ByteTrack (Kalman)</span></td>
                        </tr>
                        <tr>
                            <td><strong>Event Publishing</strong></td>
                            <td>Supabase Realtime</td>
                            <td>Local Telemetry / WS</td>
                            <td>Telegram / Push Alert</td>
                            <td><span style="color: var(--accent-emerald); font-weight: 700;">✓ axevent (ONVIF)</span></td>
                        </tr>
                        <tr>
                            <td><strong>Stream Overlays</strong></td>
                            <td>Canvas SVG Overlay</td>
                            <td>Client Canvas Overlay</td>
                            <td>Mobile Browser Overlay</td>
                            <td><span style="color: var(--accent-emerald); font-weight: 700;">✓ axoverlay (Hardware)</span></td>
                        </tr>
                        <tr>
                            <td><strong>Configuration UI</strong></td>
                            <td>Cloud Admin Studio</td>
                            <td>Local Desktop Config</td>
                            <td>Mobile App Settings</td>
                            <td><span style="color: var(--accent-emerald); font-weight: 700;">✓ axparameter (VAPIX)</span></td>
                        </tr>
                        <tr>
                            <td><strong>Resource Watchdog</strong></td>
                            <td>Cloud Health Monitor</td>
                            <td>Supervisor Task</td>
                            <td>Background Daemon</td>
                            <td><span style="color: var(--accent-emerald); font-weight: 700;">✓ ResourceGovernor (DROP_OLDEST)</span></td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

    </main>

    <footer>
        <div class="container">
            <p>CamAI Enterprise CCTV AI Platform © 2026. Target Route: <code>camai.princesite.in/overview</code></p>
        </div>
    </footer>

    <script>
        function switchTab(tabId) {
            document.querySelectorAll('.pillar-tab').forEach(tab => tab.classList.remove('active'));
            document.querySelectorAll('.panel').forEach(panel => panel.classList.remove('active'));

            const selectedPanel = document.getElementById('panel-' + tabId);
            if (selectedPanel) {
                selectedPanel.classList.add('active');
            }

            const tabs = document.querySelectorAll('.pillar-tab');
            tabs.forEach(tab => {
                if (tab.getAttribute('onclick').includes(tabId)) {
                    tab.classList.add('active');
                }
            });
        }

        function filterMatrix() {
            const query = document.getElementById('matrixSearch').value.toLowerCase();
            const rows = document.querySelectorAll('#matrixTable tbody tr');
            rows.forEach(row => {
                const text = row.innerText.toLowerCase();
                row.style.display = text.includes(query) ? '' : 'none';
            });
        }
    </script>
</body>
</html>
"""

paths = [
    r"d:\camAI\overview_site\index.html",
    r"d:\camAI\portal\public\overview\index.html",
    r"d:\camAI\portal\public\overview.html"
]

for p in paths:
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8") as f:
        f.write(html_content)

print("Overview pages generated without AXIS references!")
