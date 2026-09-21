import os

html_code = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CamAI Enterprise — System Architecture, AI Models, 7 Modules & Team Management</title>
    <meta name="description" content="Comprehensive Web Application Architecture Overview for CamAI Enterprise CCTV AI Platform covering AI Models, 7 Security Analytics Modules, Team Management RBAC, Web SaaS Portal, Desktop Client, Mobile App, and ACAP Native Edge Application.">
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

        html { scroll-behavior: smooth; }

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

        .nav-links {
            display: flex;
            align-items: center;
            gap: 6px;
        }

        .nav-btn {
            padding: 7px 12px;
            border-radius: 8px;
            font-size: 0.825rem;
            font-weight: 600;
            color: var(--text-secondary);
            background: transparent;
            border: 1px solid transparent;
            cursor: pointer;
            transition: all 0.2s ease;
            text-decoration: none;
            display: flex;
            align-items: center;
            gap: 5px;
        }

        .nav-btn svg {
            width: 15px;
            height: 15px;
        }

        .nav-btn:hover {
            color: var(--text-primary);
            background: var(--bg-card-hover);
            border-color: var(--border-color);
        }

        .nav-btn.primary {
            background: var(--accent-blue);
            color: #ffffff;
            border-color: var(--accent-blue);
        }

        .nav-btn.primary:hover {
            background: #1d4ed8;
        }

        .container {
            max-width: 1240px;
            margin: 0 auto;
            padding: 0 1.5rem;
        }

        /* Hero Header */
        .hero {
            text-align: center;
            padding: 3rem 1.5rem 2.5rem;
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
            margin-bottom: 1.25rem;
        }

        .hero-title {
            font-size: 2.75rem;
            font-weight: 900;
            letter-spacing: -1px;
            color: var(--text-primary);
            margin-bottom: 1rem;
            line-height: 1.2;
        }

        .hero-desc {
            max-width: 860px;
            margin: 0 auto 2rem;
            font-size: 1.05rem;
            color: var(--text-secondary);
        }

        .hero-actions {
            display: flex;
            justify-content: center;
            gap: 12px;
            flex-wrap: wrap;
        }

        /* System Architecture Tree Styling */
        .tree-section {
            background: #ffffff;
            border: 1px solid var(--border-color);
            border-radius: var(--radius-xl);
            padding: 2.25rem 1.75rem;
            margin-bottom: 2.5rem;
            box-shadow: var(--shadow-sm);
        }

        .section-header-title {
            font-size: 1.35rem;
            font-weight: 800;
            color: var(--text-primary);
            letter-spacing: -0.4px;
            margin-bottom: 1.5rem;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .section-header-title svg {
            width: 24px;
            height: 24px;
            color: var(--accent-blue);
        }

        .tree-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            width: 100%;
        }

        .tree-root-node {
            background: #0f172a;
            color: #ffffff;
            padding: 14px 32px;
            border-radius: 10px;
            font-weight: 800;
            font-size: 0.95rem;
            letter-spacing: 0.5px;
            text-transform: uppercase;
            box-shadow: var(--shadow-md);
            border: 1px solid #1e293b;
            text-align: center;
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .tree-root-node svg {
            width: 22px;
            height: 22px;
            color: var(--accent-cyan);
        }

        .tree-stem {
            width: 2px;
            height: 24px;
            background: #cbd5e1;
        }

        .tree-branch-connector {
            width: 80%;
            height: 2px;
            background: #cbd5e1;
            position: relative;
        }

        .tree-branches {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 1.25rem;
            width: 100%;
            margin-top: 18px;
        }

        @media (max-width: 900px) {
            .tree-branches { grid-template-columns: repeat(2, 1fr); }
        }
        @media (max-width: 550px) {
            .tree-branches { grid-template-columns: 1fr; }
        }

        .tree-branch-card {
            background: #f8fafc;
            border: 1px solid var(--border-color);
            border-top: 4px solid var(--accent-blue);
            border-radius: var(--radius-lg);
            padding: 1.25rem;
            transition: all 0.25s ease;
            cursor: pointer;
        }

        .tree-branch-card:hover {
            transform: translateY(-4px);
            box-shadow: var(--shadow-md);
            border-color: var(--border-highlight);
        }

        .tree-branch-card.portal { border-top-color: var(--accent-cyan); }
        .tree-branch-card.desktop { border-top-color: var(--accent-indigo); }
        .tree-branch-card.mobile { border-top-color: var(--accent-emerald); }
        .tree-branch-card.acap { border-top-color: var(--accent-amber); }

        .tree-branch-title {
            font-size: 1.05rem;
            font-weight: 800;
            color: var(--text-primary);
            margin-bottom: 4px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .tree-branch-title svg {
            width: 20px;
            height: 20px;
        }

        .tree-sub-tag {
            font-family: 'Fira Code', monospace;
            font-size: 0.75rem;
            color: var(--text-secondary);
            background: #e2e8f0;
            padding: 2px 8px;
            border-radius: 4px;
            display: inline-block;
            margin-bottom: 12px;
        }

        .tree-leaf-list {
            list-style: none;
        }

        .tree-leaf-item {
            font-size: 0.825rem;
            color: var(--text-secondary);
            padding: 4px 0;
            border-bottom: 1px dashed var(--border-color);
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .tree-leaf-item:last-child { border-bottom: none; }

        .tree-dot {
            width: 6px;
            height: 6px;
            border-radius: 50%;
            background: var(--accent-blue);
            flex-shrink: 0;
        }

        /* Dedicated Section Cards */
        .section-block {
            background: var(--bg-card);
            border: 1px solid var(--border-color);
            border-radius: var(--radius-xl);
            padding: 2.25rem 2rem;
            margin-bottom: 2.5rem;
            box-shadow: var(--shadow-sm);
        }

        .pillar-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 1.5rem;
            padding-bottom: 1rem;
            border-bottom: 1px solid var(--border-color);
        }

        .pillar-title-group {
            display: flex;
            align-items: center;
            gap: 12px;
        }

        .pillar-icon-wrapper {
            width: 44px;
            height: 44px;
            border-radius: 10px;
            display: flex;
            align-items: center;
            justify-content: center;
            background: #f1f5f9;
        }

        .pillar-icon-wrapper svg {
            width: 24px;
            height: 24px;
        }

        .portal .pillar-icon-wrapper { background: #e0f2fe; color: var(--accent-cyan); }
        .desktop .pillar-icon-wrapper { background: #e0e7ff; color: var(--accent-indigo); }
        .mobile .pillar-icon-wrapper { background: #d1fae5; color: var(--accent-emerald); }
        .acap .pillar-icon-wrapper { background: #fef3c7; color: var(--accent-amber); }
        .models .pillar-icon-wrapper { background: #fee2e2; color: var(--accent-rose); }
        .modules .pillar-icon-wrapper { background: #f3e8ff; color: #9333ea; }
        .rbac .pillar-icon-wrapper { background: #ccfbf1; color: #0d9488; }

        .pillar-title {
            font-size: 1.6rem;
            font-weight: 800;
            letter-spacing: -0.5px;
            color: var(--text-primary);
        }

        .pillar-path {
            font-family: 'Fira Code', monospace;
            font-size: 0.85rem;
            color: var(--text-muted);
        }

        .section-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 2rem;
            margin-bottom: 2rem;
        }

        @media (max-width: 900px) {
            .section-grid { grid-template-columns: 1fr; }
        }

        .grid-3 {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 1.25rem;
        }

        .grid-card {
            background: #f8fafc;
            border: 1px solid var(--border-color);
            border-radius: var(--radius-lg);
            padding: 1.25rem;
            transition: all 0.25s ease;
        }

        .grid-card:hover {
            transform: translateY(-3px);
            box-shadow: var(--shadow-md);
            border-color: var(--border-highlight);
        }

        .card-badge {
            font-size: 0.725rem;
            font-family: 'Fira Code', monospace;
            padding: 2px 8px;
            border-radius: 4px;
            font-weight: 700;
            display: inline-block;
            margin-bottom: 8px;
        }

        .card-title {
            font-size: 1.1rem;
            font-weight: 800;
            color: var(--text-primary);
            margin-bottom: 6px;
        }

        .card-desc {
            font-size: 0.85rem;
            color: var(--text-secondary);
            line-height: 1.5;
        }

        .feature-list {
            list-style: none;
        }

        .feature-item {
            padding: 0.85rem 0;
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

        /* Screenshot Gallery */
        .gallery-header {
            font-size: 1.1rem;
            font-weight: 800;
            color: var(--text-primary);
            margin: 2rem 0 1rem;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .gallery-header svg {
            width: 20px;
            height: 20px;
            color: var(--accent-blue);
        }

        .screenshot-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1.25rem;
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
            height: 210px;
            background: #f1f5f9;
            overflow: hidden;
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
            font-size: 0.925rem;
            font-weight: 700;
            color: var(--text-primary);
            margin-bottom: 4px;
        }

        .screenshot-desc {
            font-size: 0.825rem;
            color: var(--text-secondary);
        }

        footer {
            text-align: center;
            padding: 2.5rem 0;
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
            <span class="badge-tag">Platform Overview</span>
        </a>
        <div class="nav-links">
            <a href="#tree" class="nav-btn">Architecture Tree</a>
            <a href="#ai-models" class="nav-btn">AI Models</a>
            <a href="#modules-7" class="nav-btn">7 Analytics Modules</a>
            <a href="#team-rbac" class="nav-btn">Team & RBAC</a>
            <a href="#web-saas" class="nav-btn">Web SaaS</a>
            <a href="#desktop-client" class="nav-btn">Desktop</a>
            <a href="#mobile-app" class="nav-btn">Mobile</a>
            <a href="#acap-edge" class="nav-btn primary">ACAP Native Edge</a>
        </div>
    </nav>

    <main class="container">

        <!-- Hero Header -->
        <header class="hero">
            <div class="hero-domain">camai.princesite.in/overview</div>
            <h1 class="hero-title">CamAI Enterprise Platform Architecture</h1>
            <p class="hero-desc">
                Complete A-to-Z breakdown of CamAI AI Models, 7 Specialized Analytics Modules, Team RBAC Management, Web SaaS Portal, Desktop Client, Mobile App, and ACAP Native Edge.
            </p>
            <div class="hero-actions">
                <a href="#tree" class="nav-btn primary">Explore Architecture Tree</a>
                <a href="#ai-models" class="nav-btn">AI Model Zoo</a>
                <a href="#modules-7" class="nav-btn">7 Core Modules</a>
                <a href="#team-rbac" class="nav-btn">Team Management</a>
            </div>
        </header>

        <!-- System Architecture Hierarchy Tree -->
        <section id="tree" class="tree-section">
            <div class="section-header-title">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
                <span>CamAI System Architecture Hierarchy Tree</span>
            </div>
            <div class="tree-container">
                <div class="tree-root-node">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                    CamAI Enterprise AI Video Analytics Platform
                </div>
                <div class="tree-stem"></div>
                <div class="tree-branch-connector"></div>
                
                <div class="tree-branches">
                    <!-- Branch 1: Web SaaS -->
                    <div class="tree-branch-card portal" onclick="document.getElementById('web-saas').scrollIntoView({behavior:'smooth'});">
                        <div class="tree-branch-title">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" style="color:var(--accent-cyan);"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>
                            Web SaaS Portal
                        </div>
                        <div class="tree-sub-tag">portal/ & supabase/</div>
                        <ul class="tree-leaf-list">
                            <li class="tree-leaf-item"><span class="tree-dot" style="background:var(--accent-cyan);"></span> PostgreSQL Row Level Security</li>
                            <li class="tree-leaf-item"><span class="tree-dot" style="background:var(--accent-cyan);"></span> Interactive Zone Studio</li>
                            <li class="tree-leaf-item"><span class="tree-dot" style="background:var(--accent-cyan);"></span> Multi-Tenant Org Desk</li>
                            <li class="tree-leaf-item"><span class="tree-dot" style="background:var(--accent-cyan);"></span> Supabase Dispatched Alerts</li>
                        </ul>
                    </div>

                    <!-- Branch 2: Desktop Client -->
                    <div class="tree-branch-card desktop" onclick="document.getElementById('desktop-client').scrollIntoView({behavior:'smooth'});">
                        <div class="tree-branch-title">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" style="color:var(--accent-indigo);"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                            Desktop Client
                        </div>
                        <div class="tree-sub-tag">desktop/</div>
                        <ul class="tree-leaf-list">
                            <li class="tree-leaf-item"><span class="tree-dot" style="background:var(--accent-indigo);"></span> Encrypted DPAPI Lock</li>
                            <li class="tree-leaf-item"><span class="tree-dot" style="background:var(--accent-indigo);"></span> Zero-Latency 30-40 FPS Grid</li>
                            <li class="tree-leaf-item"><span class="tree-dot" style="background:var(--accent-indigo);"></span> Local FastAPI Engine Sync</li>
                            <li class="tree-leaf-item"><span class="tree-dot" style="background:var(--accent-indigo);"></span> ONVIF & RTSP Discovery</li>
                        </ul>
                    </div>

                    <!-- Branch 3: Mobile App -->
                    <div class="tree-branch-card mobile" onclick="document.getElementById('mobile-app').scrollIntoView({behavior:'smooth'});">
                        <div class="tree-branch-title">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" style="color:var(--accent-emerald);"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
                            Mobile Application
                        </div>
                        <div class="tree-sub-tag">mobile/</div>
                        <ul class="tree-leaf-list">
                            <li class="tree-leaf-item"><span class="tree-dot" style="background:var(--accent-emerald);"></span> Mobile Push Snapshot Alerts</li>
                            <li class="tree-leaf-item"><span class="tree-dot" style="background:var(--accent-emerald);"></span> Phone Camera IP Streamer</li>
                            <li class="tree-leaf-item"><span class="tree-dot" style="background:var(--accent-emerald);"></span> Touch Screen ROI Editor</li>
                            <li class="tree-leaf-item"><span class="tree-dot" style="background:var(--accent-emerald);"></span> Telegram Bot Integration</li>
                        </ul>
                    </div>

                    <!-- Branch 4: ACAP Native Edge -->
                    <div class="tree-branch-card acap" onclick="document.getElementById('acap-edge').scrollIntoView({behavior:'smooth'});">
                        <div class="tree-branch-title">
                            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" style="color:var(--accent-amber);"><path stroke-linecap="round" stroke-linejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"/></svg>
                            ACAP Native Edge
                        </div>
                        <div class="tree-sub-tag">ACAP/</div>
                        <ul class="tree-leaf-list">
                            <li class="tree-leaf-item"><span class="tree-dot" style="background:var(--accent-amber);"></span> Hardware VDO Zero-Copy</li>
                            <li class="tree-leaf-item"><span class="tree-dot" style="background:var(--accent-amber);"></span> Larod NPU Acceleration</li>
                            <li class="tree-leaf-item"><span class="tree-dot" style="background:var(--accent-amber);"></span> Native C++ ByteTrack</li>
                            <li class="tree-leaf-item"><span class="tree-dot" style="background:var(--accent-amber);"></span> axevent & axoverlay ONVIF</li>
                        </ul>
                    </div>
                </div>
            </div>
        </section>

        <!-- SECTION: AI Model Zoo & Detection Engines -->
        <section id="ai-models" class="section-block models">
            <div class="pillar-header">
                <div class="pillar-title-group">
                    <div class="pillar-icon-wrapper">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 01-2 2h-4a2 2 0 01-2-2v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"/></svg>
                    </div>
                    <div>
                        <h2 class="pillar-title">CamAI AI Model Zoo & Detection Engines</h2>
                        <div class="pillar-path">Models, NPU Accelerators & ByteTrack Kalman Engine</div>
                    </div>
                </div>
            </div>
            <div class="grid-3">
                <div class="grid-card">
                    <span class="card-badge" style="background:#fee2e2; color:#ef4444;">YOLOX-Tiny ONNX</span>
                    <div class="card-title">YOLOX-Tiny 8-Bit Quantized</div>
                    <div class="card-desc">Apache 2.0 licensed real-time object detector optimized for ONNX Runtime and Larod NPU accelerators. Detects persons, vehicles, bags, and equipment with sub-15ms latency.</div>
                </div>

                <div class="grid-card">
                    <span class="card-badge" style="background:#e0e7ff; color:#6366f1;">OpenVINO FP16/INT8</span>
                    <div class="card-title">Intel OpenVINO Neural Engine</div>
                    <div class="card-desc">Local CPU/GPU accelerated inference backend for Windows Desktop Client and Local Server Engine. Achieves 30-40 FPS multi-stream processing.</div>
                </div>

                <div class="grid-card">
                    <span class="card-badge" style="background:#d1fae5; color:#10b981;">C++ ByteTrack</span>
                    <div class="card-title">Kalman Filter Multi-Object Tracker</div>
                    <div class="card-desc">State-vector motion tracking engine with Hungarian data association algorithm. Maintains zero ID switches across occlusions, crowds, and complex camera scenes.</div>
                </div>

                <div class="grid-card">
                    <span class="card-badge" style="background:#fef3c7; color:#f59e0b;">Larod NPU Runtime</span>
                    <div class="card-title">Hardware NPU Acceleration</div>
                    <div class="card-desc">Direct interface to camera hardware DLPU / NPU chips via `larod.h` API for zero-CPU AI model execution directly on edge camera hardware.</div>
                </div>

                <div class="grid-card">
                    <span class="card-badge" style="background:#e0f2fe; color:#0284c7;">PPE & Safety Weights</span>
                    <div class="card-title">Hardhat & High-Vis Vest Weights</div>
                    <div class="card-desc">Custom-trained weights for industrial personal protective equipment (PPE) compliance, helmet detection, and worker safety monitoring.</div>
                </div>

                <div class="grid-card">
                    <span class="card-badge" style="background:#f3e8ff; color:#a855f7;">Micro-Motion Filter</span>
                    <div class="card-title">Sub-Pixel Optical Anomaly Filter</div>
                    <div class="card-desc">Frequency-domain optical flow analyzer detecting subtle micro-vibrations, machine anomalies, and thermal structural shifts in video streams.</div>
                </div>
            </div>
        </section>

        <!-- SECTION: All 7 Core Analytics Modules -->
        <section id="modules-7" class="section-block modules">
            <div class="pillar-header">
                <div class="pillar-title-group">
                    <div class="pillar-icon-wrapper">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
                    </div>
                    <div>
                        <h2 class="pillar-title">All 7 Specialized Security & Analytics Modules</h2>
                        <div class="pillar-path">ACAP/modules/ & server/app/ai/modules/</div>
                    </div>
                </div>
            </div>
            <div class="grid-3">
                <div class="grid-card">
                    <span class="card-badge" style="background:#e0f2fe; color:#0284c7;">Module 1</span>
                    <div class="card-title">🛡️ Perimeter Security & Intrusion</div>
                    <div class="card-desc">Perimeter boundary protection, line-crossing vector math, polygonal ROI intrusion detection, and loitering time threshold alerts.</div>
                </div>

                <div class="grid-card">
                    <span class="card-badge" style="background:#e0e7ff; color:#4f46e5;">Module 2</span>
                    <div class="card-title">🚘 Traffic & Vehicle Counting</div>
                    <div class="card-desc">Bi-directional vehicle counter, speed estimation, illegal parking detection, and lane occupation analytics for traffic management.</div>
                </div>

                <div class="grid-card">
                    <span class="card-badge" style="background:#d1fae5; color:#16a34a;">Module 3</span>
                    <div class="card-title">🦺 PPE & Safety Compliance</div>
                    <div class="card-desc">Construction site and factory worker safety monitoring: mandatory hardhats, high-visibility vests, safety gloves, and hazardous area entry.</div>
                </div>

                <div class="grid-card">
                    <span class="card-badge" style="background:#fef3c7; color:#d97706;">Module 4</span>
                    <div class="card-title">🛍️ Retail Analytics & Heatmaps</div>
                    <div class="card-desc">Customer footfall counting, aisle dwell time measurement, queue length detection, and spatial density heatmap generation for retail stores.</div>
                </div>

                <div class="grid-card">
                    <span class="card-badge" style="background:#fee2e2; color:#e11d48;">Module 5</span>
                    <div class="card-title">🏙️ Smart City & Crowding</div>
                    <div class="card-desc">Public square crowd density estimation, stampede warning alerts, unattended luggage detection, and civic safety compliance.</div>
                </div>

                <div class="grid-card">
                    <span class="card-badge" style="background:#f3e8ff; color:#9333ea;">Module 6</span>
                    <div class="card-title">🔬 Micro-Motion & Anomaly</div>
                    <div class="card-desc">Sub-pixel motion analysis for industrial machinery vibration monitoring, conveyor belt jamming, and subtle structural movement detection.</div>
                </div>

                <div class="grid-card" style="grid-column: span 1;">
                    <span class="card-badge" style="background:#ccfbf1; color:#0d9488;">Module 7</span>
                    <div class="card-title">⚡ Custom Rules & Trigger Engine</div>
                    <div class="card-desc">User-defined logic engine for combining multi-condition triggers (e.g., Person AND Vehicle AND Night Hours = High Severity Alert).</div>
                </div>
            </div>
        </section>

        <!-- SECTION: Team Management & Role-Based Access Control (RBAC) -->
        <section id="team-rbac" class="section-block rbac">
            <div class="pillar-header">
                <div class="pillar-title-group">
                    <div class="pillar-icon-wrapper">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
                    </div>
                    <div>
                        <h2 class="pillar-title">Team Management & Role-Based Access Control (RBAC)</h2>
                        <div class="pillar-path">portal/src/pages/app/Users.tsx & Roles.tsx</div>
                    </div>
                </div>
            </div>
            <div class="section-grid">
                <div>
                    <p class="branch-desc">
                        CamAI Enterprise includes a multi-tier team management system enabling organization administrators to invite team members, assign granular permissions, restrict site-level access, and audit operator actions.
                    </p>
                    <ul class="feature-list">
                        <li class="feature-item">
                            <svg class="check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                            <div><strong>Organization Admin:</strong> Full administrative control over organization settings, subscription billing, camera fleets, and team member invitations.</div>
                        </li>
                        <li class="feature-item">
                            <svg class="check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                            <div><strong>Security Operator:</strong> Real-time CCTV grid monitoring, alert triage, incident desk management, and instant snapshot review.</div>
                        </li>
                        <li class="feature-item">
                            <svg class="check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                            <div><strong>Site Manager:</strong> Location-based scope restricting access to assigned physical sites, camera groups, and local ROI drawing tools.</div>
                        </li>
                        <li class="feature-item">
                            <svg class="check-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
                            <div><strong>Compliance Auditor:</strong> Read-only access to tamper-proof audit logs, event telemetry exports, and historical system reports.</div>
                        </li>
                    </ul>
                </div>
                <div>
                    <div class="code-box">// Granular RBAC Permission Matrix
export const RBAC_PERMISSIONS = {
  'org.manage': 'Manage Organization & Billing',
  'users.manage': 'Invite & Assign Roles',
  'roles.manage': 'Custom Role Creation',
  'cameras.manage': 'Add/Edit Cameras & Zones',
  'ai.configure': 'AI Model Zoo Tuning',
  'alerts.view': 'Alert Desk & Triage',
  'reports.view': 'Export Analytics Reports',
  'audit.view': 'Security Audit Trail'
};</div>
                </div>
            </div>
        </section>

        <!-- Pillar 1: Web SaaS Portal -->
        <section id="web-saas" class="section-block portal">
            <div class="pillar-header">
                <div class="pillar-title-group">
                    <div class="pillar-icon-wrapper">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg>
                    </div>
                    <div>
                        <h2 class="pillar-title">Web SaaS Portal & Cloud Management</h2>
                        <div class="pillar-path">portal/ & supabase/</div>
                    </div>
                </div>
            </div>
            <div class="section-grid">
                <div>
                    <p class="branch-desc">
                        The central cloud administrative portal empowers enterprise organizations to manage camera fleets, configure line-crossing and ROI intrusion zones, assign license seats, and review security audit logs.
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

            <!-- Web SaaS Screenshots -->
            <div class="gallery-header">
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
        </section>

        <!-- Pillar 2: Desktop Client -->
        <section id="desktop-client" class="section-block desktop">
            <div class="pillar-header">
                <div class="pillar-title-group">
                    <div class="pillar-icon-wrapper">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg>
                    </div>
                    <div>
                        <h2 class="pillar-title">Windows Desktop Monitoring Client</h2>
                        <div class="pillar-path">desktop/</div>
                    </div>
                </div>
            </div>
            <div class="section-grid">
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

            <!-- Desktop Screenshots -->
            <div class="gallery-header">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                Desktop Client Screenshots
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
        </section>

        <!-- Pillar 3: Mobile Application -->
        <section id="mobile-app" class="section-block mobile">
            <div class="pillar-header">
                <div class="pillar-title-group">
                    <div class="pillar-icon-wrapper">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>
                    </div>
                    <div>
                        <h2 class="pillar-title">Mobile Application & RTSP Streamer</h2>
                        <div class="pillar-path">mobile/</div>
                    </div>
                </div>
            </div>
            <div class="section-grid">
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

            <!-- Mobile Screenshots -->
            <div class="gallery-header">
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
        </section>

        <!-- Pillar 4: ACAP Native Edge -->
        <section id="acap-edge" class="section-block acap">
            <div class="pillar-header">
                <div class="pillar-title-group">
                    <div class="pillar-icon-wrapper">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"/></svg>
                    </div>
                    <div>
                        <h2 class="pillar-title">ACAP Native Edge Application</h2>
                        <div class="pillar-path">ACAP/</div>
                    </div>
                </div>
            </div>
            <div class="section-grid">
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
        </section>

    </main>

    <footer>
        <div class="container">
            <p>CamAI Enterprise CCTV AI Platform © 2026. Target Route: <code>camai.princesite.in/overview</code></p>
        </div>
    </footer>
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
        f.write(html_code)

print("Overview regenerated with AI Models, 7 Analytics Modules, and Team RBAC!")
