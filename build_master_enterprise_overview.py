import os

master_html = """<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CamAI — Enterprise Video Intelligence Platform</title>
    <meta name="description" content="CamAI is an enterprise video intelligence platform that transforms live camera streams into real-time computer vision analytics across Web, Desktop, Mobile, and Edge.">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&family=Fira+Code:wght@400;500;600&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg-body: #f8fafc;
            --bg-card: #ffffff;
            --bg-dark: #090d16;
            --bg-dark-card: #111827;
            --border-light: #e2e8f0;
            --border-dark: #1e293b;
            --border-highlight: #cbd5e1;
            --text-primary: #0f172a;
            --text-secondary: #475569;
            --text-muted: #64748b;
            --text-dark-primary: #f8fafc;
            --text-dark-secondary: #94a3b8;
            --accent-blue: #2563eb;
            --accent-cyan: #0284c7;
            --accent-emerald: #059669;
            --accent-indigo: #4f46e5;
            --accent-amber: #d97706;
            --accent-rose: #e11d48;
            --radius-md: 8px;
            --radius-lg: 12px;
            --radius-xl: 16px;
            --shadow-sm: 0 1px 3px rgba(0,0,0,0.05);
            --shadow-md: 0 4px 12px rgba(0,0,0,0.05);
            --shadow-lg: 0 10px 25px rgba(0,0,0,0.08);
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }
        html { scroll-behavior: smooth; }
        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            background-color: var(--bg-body);
            color: var(--text-primary);
            line-height: 1.6;
            padding-top: 72px;
            overflow-x: hidden;
        }

        /* Mono text helper */
        .font-mono { font-family: 'Fira Code', monospace; }

        /* Sticky Navigation Bar */
        .navbar {
            position: fixed;
            top: 0; left: 0; right: 0;
            height: 72px;
            background: rgba(255, 255, 255, 0.92);
            backdrop-filter: blur(16px);
            border-bottom: 1px solid var(--border-light);
            z-index: 1000;
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0 2rem;
            transition: all 0.3s ease;
        }

        .brand-logo {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 1.25rem;
            font-weight: 900;
            color: var(--text-primary);
            text-decoration: none;
            letter-spacing: -0.5px;
        }

        .brand-logo svg { width: 26px; height: 26px; color: var(--accent-blue); }

        .nav-menu {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .nav-link {
            padding: 8px 14px;
            border-radius: var(--radius-md);
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--text-secondary);
            text-decoration: none;
            transition: all 0.2s ease;
        }

        .nav-link:hover {
            color: var(--text-primary);
            background: #f1f5f9;
        }

        .nav-cta-group {
            display: flex;
            align-items: center;
            gap: 10px;
        }

        .btn-outline {
            padding: 8px 16px;
            border-radius: var(--radius-md);
            font-size: 0.85rem;
            font-weight: 600;
            color: var(--text-primary);
            background: #ffffff;
            border: 1px solid var(--border-highlight);
            text-decoration: none;
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
        }

        .btn-outline:hover {
            background: #f8fafc;
            border-color: var(--accent-blue);
            color: var(--accent-blue);
        }

        .btn-primary {
            padding: 8px 18px;
            border-radius: var(--radius-md);
            font-size: 0.85rem;
            font-weight: 700;
            color: #ffffff;
            background: var(--accent-blue);
            border: 1px solid var(--accent-blue);
            text-decoration: none;
            transition: all 0.2s ease;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            cursor: pointer;
            box-shadow: 0 2px 6px rgba(37, 99, 235, 0.25);
        }

        .btn-primary:hover {
            background: #1d4ed8;
        }

        .container {
            max-width: 1280px;
            margin: 0 auto;
            padding: 0 1.5rem;
        }

        /* Section Wrappers */
        .section-padding { padding: 4.5rem 0; }
        .section-dark {
            background: var(--bg-dark);
            color: var(--text-dark-primary);
            border-top: 1px solid var(--border-dark);
            border-bottom: 1px solid var(--border-dark);
        }

        .section-header {
            text-align: center;
            max-width: 780px;
            margin: 0 auto 3rem;
        }

        .section-badge {
            font-size: 0.75rem;
            font-weight: 800;
            letter-spacing: 1px;
            text-transform: uppercase;
            color: var(--accent-blue);
            background: #eff6ff;
            border: 1px solid #bfdbfe;
            padding: 4px 12px;
            border-radius: 20px;
            display: inline-block;
            margin-bottom: 1rem;
        }

        .section-dark .section-badge {
            background: rgba(38, 99, 235, 0.15);
            color: #60a5fa;
            border-color: rgba(96, 165, 250, 0.3);
        }

        .section-title {
            font-size: 2.25rem;
            font-weight: 900;
            letter-spacing: -0.8px;
            line-height: 1.25;
            margin-bottom: 1rem;
        }

        .section-desc {
            font-size: 1.05rem;
            color: var(--text-secondary);
        }

        .section-dark .section-desc {
            color: var(--text-dark-secondary);
        }

        /* 02 HERO SECTION */
        .hero-section {
            background: #090d16;
            color: #ffffff;
            padding: 4.5rem 0 5rem;
            border-bottom: 1px solid #1e293b;
            position: relative;
            overflow: hidden;
        }

        .hero-grid {
            display: grid;
            grid-template-columns: 1.1fr 0.9fr;
            gap: 3rem;
            align-items: center;
        }

        @media (max-width: 960px) {
            .hero-grid { grid-template-columns: 1fr; text-align: center; }
        }

        .hero-headline {
            font-size: 3.5rem;
            font-weight: 900;
            letter-spacing: -1.5px;
            line-height: 1.1;
            margin-bottom: 1.25rem;
            background: linear-gradient(135deg, #ffffff 0%, #cbd5e1 100%);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }

        .hero-badges {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            margin-bottom: 1.5rem;
        }

        .tag-pill {
            font-family: 'Fira Code', monospace;
            font-size: 0.725rem;
            padding: 3px 10px;
            border-radius: 4px;
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.15);
            color: #94a3b8;
            font-weight: 600;
        }

        .hero-sub {
            font-size: 1.15rem;
            color: #94a3b8;
            margin-bottom: 2rem;
            line-height: 1.6;
        }

        /* Hero SVG Visualizer */
        .hero-viz-card {
            background: #111827;
            border: 1px solid #1f2937;
            border-radius: var(--radius-xl);
            padding: 1.5rem;
            box-shadow: 0 20px 40px rgba(0,0,0,0.5);
            position: relative;
        }

        .viz-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding-bottom: 1rem;
            border-bottom: 1px solid #1f2937;
            margin-bottom: 1rem;
        }

        .status-dot {
            width: 8px; height: 8px; border-radius: 50%; background: #10b981;
            box-shadow: 0 0 10px #10b981;
            display: inline-block;
        }

        /* 03 PLATFORM STATEMENT */
        .statement-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 1.25rem;
            margin-top: 2rem;
        }

        @media (max-width: 900px) { .statement-grid { grid-template-columns: repeat(2, 1fr); } }
        @media (max-width: 500px) { .statement-grid { grid-template-columns: 1fr; } }

        .statement-card {
            background: #ffffff;
            border: 1px solid var(--border-light);
            border-radius: var(--radius-lg);
            padding: 1.5rem;
            box-shadow: var(--shadow-sm);
            transition: all 0.25s ease;
        }

        .statement-card:hover {
            transform: translateY(-4px);
            box-shadow: var(--shadow-md);
            border-color: var(--accent-blue);
        }

        .statement-icon {
            width: 40px; height: 40px;
            border-radius: 8px;
            background: #f1f5f9;
            color: var(--accent-blue);
            display: flex; align-items: center; justify-content: center;
            margin-bottom: 1rem;
        }

        .statement-icon svg { width: 22px; height: 22px; }

        /* 06 CORE AI ENGINE PIPELINE */
        .pipeline-flow {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            overflow-x: auto;
            padding: 1rem 0;
        }

        .pipeline-node {
            background: #ffffff;
            border: 1px solid var(--border-light);
            border-top: 3px solid var(--accent-blue);
            border-radius: var(--radius-md);
            padding: 1rem 1.25rem;
            text-align: center;
            min-width: 130px;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .pipeline-node:hover {
            transform: translateY(-3px);
            border-color: var(--accent-blue);
            box-shadow: var(--shadow-md);
        }

        .pipeline-arrow {
            color: var(--text-muted);
            font-weight: bold;
        }

        /* 07 SEVEN MODULES CARDS */
        .modules-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
            gap: 1.5rem;
        }

        .module-card {
            background: #ffffff;
            border: 1px solid var(--border-light);
            border-radius: var(--radius-xl);
            padding: 1.75rem;
            box-shadow: var(--shadow-sm);
            transition: all 0.25s ease;
            position: relative;
        }

        .module-card:hover {
            transform: translateY(-4px);
            box-shadow: var(--shadow-md);
            border-color: var(--border-highlight);
        }

        .module-num {
            font-family: 'Fira Code', monospace;
            font-size: 2rem;
            font-weight: 900;
            color: #cbd5e1;
            position: absolute;
            top: 1.25rem; right: 1.5rem;
        }

        .module-title {
            font-size: 1.2rem;
            font-weight: 800;
            margin-bottom: 0.5rem;
            color: var(--text-primary);
        }

        .module-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 1rem;
        }

        /* 08 LIVE VISION SIMULATION */
        .vision-viewport {
            background: #000000;
            border: 2px solid #1e293b;
            border-radius: var(--radius-xl);
            aspect-ratio: 16 / 9;
            width: 100%;
            position: relative;
            overflow: hidden;
            box-shadow: var(--shadow-lg);
        }

        .vision-overlay-box {
            position: absolute;
            border: 2px solid #10b981;
            background: rgba(16, 185, 129, 0.1);
            border-radius: 4px;
            padding: 4px 8px;
        }

        .vision-overlay-label {
            position: absolute;
            top: -24px; left: -2px;
            background: #10b981;
            color: #000000;
            font-family: 'Fira Code', monospace;
            font-size: 0.7rem;
            font-weight: 800;
            padding: 1px 6px;
            border-radius: 2px;
            white-space: nowrap;
        }

        /* UI SIMULATION BOARDS */
        .simulated-ui-card {
            background: #ffffff;
            border: 1px solid var(--border-light);
            border-radius: var(--radius-xl);
            box-shadow: var(--shadow-md);
            overflow: hidden;
        }

        .simulated-header {
            background: #f8fafc;
            border-bottom: 1px solid var(--border-light);
            padding: 12px 20px;
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .simulated-body { padding: 1.5rem; }

        /* Tables & Lists */
        .data-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 0.875rem;
        }

        .data-table th, .data-table td {
            padding: 10px 14px;
            border-bottom: 1px solid var(--border-light);
            text-align: left;
        }

        .data-table th {
            background: #f8fafc;
            font-weight: 700;
            color: var(--text-secondary);
            font-size: 0.75rem;
            text-transform: uppercase;
        }

        /* Accordion FAQ */
        .faq-item {
            background: #ffffff;
            border: 1px solid var(--border-light);
            border-radius: var(--radius-lg);
            margin-bottom: 1rem;
            overflow: hidden;
        }

        .faq-question {
            padding: 1.25rem 1.5rem;
            font-weight: 700;
            cursor: pointer;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        .faq-answer {
            padding: 0 1.5rem 1.25rem;
            color: var(--text-secondary);
            display: none;
        }

        .faq-item.active .faq-answer { display: block; }

        footer {
            background: #090d16;
            color: #64748b;
            padding: 4rem 0 2rem;
            border-top: 1px solid #1e293b;
            font-size: 0.85rem;
        }

        .footer-grid {
            display: grid;
            grid-template-columns: 2fr repeat(4, 1fr);
            gap: 2rem;
            margin-bottom: 3rem;
        }

        @media (max-width: 800px) { .footer-grid { grid-template-columns: 1fr; } }

        .footer-title {
            color: #ffffff;
            font-weight: 700;
            margin-bottom: 1rem;
            font-size: 0.9rem;
        }

        .footer-links { list-style: none; }
        .footer-links li { margin-bottom: 8px; }
        .footer-links a { color: #94a3b8; text-decoration: none; transition: color 0.2s; }
        .footer-links a:hover { color: #ffffff; }
    </style>
</head>
<body>

    <!-- 01. NAVIGATION -->
    <nav class="navbar" id="navbar">
        <a href="#" class="brand-logo">
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
            <span>CamAI</span>
        </a>
        <div class="nav-menu">
            <a href="#overview" class="nav-link">Overview</a>
            <a href="#ecosystem" class="nav-link">Platform</a>
            <a href="#ai-engine" class="nav-link">AI Engine</a>
            <a href="#modules" class="nav-link">Modules</a>
            <a href="#surfaces" class="nav-link">Deployments</a>
            <a href="#architecture" class="nav-link">Architecture</a>
            <a href="#performance" class="nav-link">Performance</a>
            <a href="#security" class="nav-link">Security</a>
        </div>
        <div class="nav-cta-group">
            <a href="#documentation" class="btn-outline">Technical Overview</a>
            <a href="#contact" class="btn-primary">Request Demo</a>
        </div>
    </nav>

    <!-- 02. HERO SECTION -->
    <section class="hero-section" id="overview">
        <div class="container hero-grid">
            <div>
                <div class="hero-badges">
                    <span class="tag-pill">ENTERPRISE VIDEO AI</span>
                    <span class="tag-pill">REAL-TIME ANALYTICS</span>
                    <span class="tag-pill">MULTI-PLATFORM</span>
                    <span class="tag-pill">EDGE-READY</span>
                </div>
                <h1 class="hero-headline">Turn Every Camera Into Intelligence.</h1>
                <p class="hero-sub">
                    CamAI is an enterprise video intelligence platform that transforms live camera streams into real-time AI analytics across Web, Desktop, Mobile, and Edge.
                </p>
                <div class="hero-actions" style="justify-content: flex-start;">
                    <a href="#ecosystem" class="btn-primary" style="padding: 12px 24px; font-size: 0.95rem;">Explore CamAI</a>
                    <a href="#documentation" class="btn-outline" style="background:transparent; color:#fff; border-color:#334155; padding: 12px 24px; font-size: 0.95rem;">Technical Overview</a>
                </div>
            </div>
            <div>
                <!-- Native SVG Live Architecture Diagram (No Images) -->
                <div class="hero-viz-card">
                    <div class="viz-header">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span class="status-dot"></span>
                            <span class="font-mono" style="font-size:0.75rem; color:#10b981; font-weight:700;">SYSTEM OPERATIONAL</span>
                        </div>
                        <span class="font-mono" style="font-size:0.7rem; color:#64748b;">DEMO INTERFACE</span>
                    </div>
                    <svg viewBox="0 0 500 320" style="width:100%; height:auto;" fill="none" stroke="currentColor">
                        <!-- Top Camera Node -->
                        <rect x="200" y="20" width="100" height="36" rx="6" fill="#1f2937" stroke="#374151" stroke-width="1.5"/>
                        <text x="250" y="42" fill="#f8fafc" font-size="11" font-weight="700" text-anchor="middle">CAMERAS (RTSP)</text>

                        <!-- Center Vision Engine -->
                        <rect x="160" y="120" width="180" height="50" rx="8" fill="#1e3a8a" stroke="#3b82f6" stroke-width="2"/>
                        <text x="250" y="150" fill="#ffffff" font-size="13" font-weight="900" text-anchor="middle">CAMAI VISION ENGINE</text>

                        <!-- Bottom Surface Nodes -->
                        <g transform="translate(20, 240)">
                            <rect x="0" y="0" width="95" height="40" rx="6" fill="#1f2937" stroke="#38bdf8"/>
                            <text x="47" y="24" fill="#38bdf8" font-size="11" font-weight="700" text-anchor="middle">WEB</text>
                        </g>
                        <g transform="translate(135, 240)">
                            <rect x="0" y="0" width="95" height="40" rx="6" fill="#1f2937" stroke="#818cf8"/>
                            <text x="47" y="24" fill="#818cf8" font-size="11" font-weight="700" text-anchor="middle">DESKTOP</text>
                        </g>
                        <g transform="translate(250, 240)">
                            <rect x="0" y="0" width="95" height="40" rx="6" fill="#1f2937" stroke="#34d399"/>
                            <text x="47" y="24" fill="#34d399" font-size="11" font-weight="700" text-anchor="middle">MOBILE</text>
                        </g>
                        <g transform="translate(365, 240)">
                            <rect x="0" y="0" width="95" height="40" rx="6" fill="#1f2937" stroke="#fbbf24"/>
                            <text x="47" y="24" fill="#fbbf24" font-size="11" font-weight="700" text-anchor="middle">EDGE / ACAP</text>
                        </g>

                        <!-- Animated Lines -->
                        <path d="M250 56 V120" stroke="#3b82f6" stroke-width="2" stroke-dasharray="4 4"/>
                        <path d="M250 170 V205 H67 V240" stroke="#38bdf8" stroke-width="1.5"/>
                        <path d="M250 170 V205 H182 V240" stroke="#818cf8" stroke-width="1.5"/>
                        <path d="M250 170 V205 H297 V240" stroke="#34d399" stroke-width="1.5"/>
                        <path d="M250 170 V205 H412 V240" stroke="#fbbf24" stroke-width="1.5"/>
                    </svg>
                </div>
            </div>
        </div>
    </section>

    <!-- 03. PLATFORM STATEMENT -->
    <section class="section-padding">
        <div class="container">
            <div class="section-header">
                <span class="section-badge">UNIFIED ARCHITECTURE</span>
                <h2 class="section-title">One Vision Engine. Four Ways to Operate.</h2>
                <p class="section-desc">
                    CamAI separates the intelligence layer from the interface and deployment environment, allowing the same computer-vision capabilities to power control rooms, web operations, mobile workflows, and edge deployments.
                </p>
            </div>
            <div class="statement-grid">
                <div class="statement-card">
                    <div class="statement-icon"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"/></svg></div>
                    <h3 style="font-weight:800; font-size:1.1rem; margin-bottom:4px;">WEB</h3>
                    <div class="font-mono" style="font-size:0.75rem; color:var(--accent-blue); font-weight:700; margin-bottom:8px;">Operate</div>
                    <p style="font-size:0.875rem; color:var(--text-secondary);">Distributed cloud administration, multi-tenant site management, live alerts, and user roles.</p>
                </div>
                <div class="statement-card">
                    <div class="statement-icon" style="color:var(--accent-indigo); background:#e0e7ff;"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/></svg></div>
                    <h3 style="font-weight:800; font-size:1.1rem; margin-bottom:4px;">DESKTOP</h3>
                    <div class="font-mono" style="font-size:0.75rem; color:var(--accent-indigo); font-weight:700; margin-bottom:8px;">Monitor</div>
                    <p style="font-size:0.875rem; color:var(--text-secondary);">Zero-latency multi-camera grid station supervising local engine and DPAPI machine keys.</p>
                </div>
                <div class="statement-card">
                    <div class="statement-icon" style="color:var(--accent-emerald); background:#d1fae5;"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg></div>
                    <h3 style="font-weight:800; font-size:1.1rem; margin-bottom:4px;">MOBILE</h3>
                    <div class="font-mono" style="font-size:0.75rem; color:var(--accent-emerald); font-weight:700; margin-bottom:8px;">Respond</div>
                    <p style="font-size:0.875rem; color:var(--text-secondary);">Instant push notifications, mobile touch ROI editing, and camera RTSP streaming.</p>
                </div>
                <div class="statement-card">
                    <div class="statement-icon" style="color:var(--accent-amber); background:#fef3c7;"><svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"/></svg></div>
                    <h3 style="font-weight:800; font-size:1.1rem; margin-bottom:4px;">EDGE / ACAP</h3>
                    <div class="font-mono" style="font-size:0.75rem; color:var(--accent-amber); font-weight:700; margin-bottom:8px;">Process</div>
                    <p style="font-size:0.875rem; color:var(--text-secondary);">Native C++ app running 100% on-device AI inference on camera hardware NPUs.</p>
                </div>
            </div>
        </div>
    </section>

    <!-- 04. CAMAI ECOSYSTEM (MASTER SVG DIAGRAM) -->
    <section class="section-padding section-dark" id="ecosystem">
        <div class="container">
            <div class="section-header">
                <span class="section-badge">ECOSYSTEM MAP</span>
                <h2 class="section-title">The Complete CamAI Platform Architecture</h2>
                <p class="section-desc">One centralized computer vision intelligence core distributing events, metadata, and analytics to every operational surface.</p>
            </div>
            <!-- Full SVG Ecosystem Diagram -->
            <div style="background:#111827; border:1px solid #1f2937; border-radius:var(--radius-xl); padding:2rem; overflow-x:auto;">
                <svg viewBox="0 0 1000 420" style="width:100%; min-width:800px; height:auto;" fill="none" stroke="currentColor">
                    <!-- Left: Sources -->
                    <rect x="20" y="160" width="140" height="100" rx="8" fill="#1f2937" stroke="#374151" stroke-width="2"/>
                    <text x="90" y="195" fill="#f8fafc" font-size="12" font-weight="800" text-anchor="middle">CAMERA STREAMS</text>
                    <text x="90" y="220" fill="#94a3b8" font-size="10" font-weight="600" text-anchor="middle">RTSP / ONVIF / H.264</text>

                    <!-- Center: Core Engine -->
                    <rect x="230" y="60" width="540" height="300" rx="12" fill="#1e3a8a" fill-opacity="0.2" stroke="#2563eb" stroke-width="2" stroke-dasharray="6 6"/>
                    <text x="500" y="90" fill="#60a5fa" font-size="14" font-weight="900" text-anchor="middle">CAMAI VISION ENGINE (CORE INTELLIGENCE)</text>

                    <!-- Sub Modules Inside Engine -->
                    <g transform="translate(260, 120)">
                        <rect x="0" y="0" width="130" height="60" rx="6" fill="#111827" stroke="#3b82f6"/>
                        <text x="65" y="30" fill="#ffffff" font-size="11" font-weight="800" text-anchor="middle">AI MODELS</text>
                        <text x="65" y="46" fill="#60a5fa" font-size="9" text-anchor="middle">YOLOX / OpenVINO</text>
                    </g>
                    <g transform="translate(435, 120)">
                        <rect x="0" y="0" width="130" height="60" rx="6" fill="#111827" stroke="#3b82f6"/>
                        <text x="65" y="30" fill="#ffffff" font-size="11" font-weight="800" text-anchor="middle">TRACKING</text>
                        <text x="65" y="46" fill="#60a5fa" font-size="9" text-anchor="middle">C++ ByteTrack Kalman</text>
                    </g>
                    <g transform="translate(610, 120)">
                        <rect x="0" y="0" width="130" height="60" rx="6" fill="#111827" stroke="#3b82f6"/>
                        <text x="65" y="30" fill="#ffffff" font-size="11" font-weight="800" text-anchor="middle">7 AI MODULES</text>
                        <text x="65" y="46" fill="#60a5fa" font-size="9" text-anchor="middle">Security, PPE, Traffic...</text>
                    </g>

                    <g transform="translate(345, 230)">
                        <rect x="0" y="0" width="150" height="60" rx="6" fill="#111827" stroke="#10b981"/>
                        <text x="75" y="30" fill="#ffffff" font-size="11" font-weight="800" text-anchor="middle">ANALYTICS & RULES</text>
                        <text x="75" y="46" fill="#34d399" font-size="9" text-anchor="middle">ROI / Lines / Dwell</text>
                    </g>

                    <g transform="translate(525, 230)">
                        <rect x="0" y="0" width="150" height="60" rx="6" fill="#111827" stroke="#10b981"/>
                        <text x="75" y="30" fill="#ffffff" font-size="11" font-weight="800" text-anchor="middle">EVENT ENGINE</text>
                        <text x="75" y="46" fill="#34d399" font-size="9" text-anchor="middle">Alerts & Metadata</text>
                    </g>

                    <!-- Right: 4 Surfaces -->
                    <g transform="translate(830, 60)">
                        <rect x="0" y="0" width="150" height="60" rx="6" fill="#1f2937" stroke="#38bdf8"/>
                        <text x="75" y="35" fill="#38bdf8" font-size="11" font-weight="800" text-anchor="middle">WEB PORTAL</text>
                    </g>
                    <g transform="translate(830, 140)">
                        <rect x="0" y="0" width="150" height="60" rx="6" fill="#1f2937" stroke="#818cf8"/>
                        <text x="75" y="35" fill="#818cf8" font-size="11" font-weight="800" text-anchor="middle">DESKTOP CLIENT</text>
                    </g>
                    <g transform="translate(830, 220)">
                        <rect x="0" y="0" width="150" height="60" rx="6" fill="#1f2937" stroke="#34d399"/>
                        <text x="75" y="35" fill="#34d399" font-size="11" font-weight="800" text-anchor="middle">MOBILE APP</text>
                    </g>
                    <g transform="translate(830, 300)">
                        <rect x="0" y="0" width="150" height="60" rx="6" fill="#1f2937" stroke="#fbbf24"/>
                        <text x="75" y="35" fill="#fbbf24" font-size="11" font-weight="800" text-anchor="middle">EDGE / ACAP</text>
                    </g>

                    <!-- Connections -->
                    <path d="M160 210 H230" stroke="#3b82f6" stroke-width="2"/>
                    <path d="M770 210 H830" stroke="#10b981" stroke-width="2"/>
                </svg>
            </div>
        </div>
    </section>

    <!-- 05. FOUR DEPLOYMENT SURFACES (NATIVE SIMULATIONS) -->
    <section class="section-padding" id="surfaces">
        <div class="container">
            <div class="section-header">
                <span class="section-badge">DEPLOYMENT SURFACES</span>
                <h2 class="section-title">Built for Every Operational Environment</h2>
                <p class="section-desc">Experience native interfaces engineered specifically for Web command centers, Desktop monitoring stations, Mobile responder teams, and Edge camera hardware.</p>
            </div>

            <!-- 13. WEB PLATFORM SIMULATION -->
            <div style="margin-bottom:3rem;">
                <div style="margin-bottom:1rem;">
                    <span class="font-mono" style="color:var(--accent-blue); font-weight:700; font-size:0.8rem;">01 / WEB PLATFORM</span>
                    <h3 style="font-size:1.5rem; font-weight:800;">Web Operations Command Center</h3>
                </div>
                <div class="simulated-ui-card">
                    <div class="simulated-header">
                        <div style="display:flex; gap:6px;">
                            <span style="width:10px; height:10px; border-radius:50%; background:#ef4444;"></span>
                            <span style="width:10px; height:10px; border-radius:50%; background:#f59e0b;"></span>
                            <span style="width:10px; height:10px; border-radius:50%; background:#10b981;"></span>
                        </div>
                        <span class="font-mono" style="font-size:0.75rem; color:var(--text-muted);">camai-web-portal.internal</span>
                        <span class="font-mono" style="font-size:0.7rem; color:var(--accent-blue);">LIVE DEMO</span>
                    </div>
                    <div class="simulated-body" style="display:grid; grid-template-columns: 200px 1fr 260px; gap:1rem; min-height:280px; background:#f8fafc;">
                        <!-- Sidebar -->
                        <div style="background:#ffffff; border:1px solid var(--border-light); border-radius:6px; padding:12px;">
                            <div style="font-weight:800; font-size:0.8rem; margin-bottom:12px; color:var(--accent-blue);">CAMAI PORTAL</div>
                            <div style="font-size:0.75rem; font-weight:700; padding:6px; background:#eff6ff; border-radius:4px; color:var(--accent-blue); margin-bottom:4px;">Dashboard</div>
                            <div style="font-size:0.75rem; padding:6px; color:var(--text-secondary);">Cameras Fleet</div>
                            <div style="font-size:0.75rem; padding:6px; color:var(--text-secondary);">Real-Time Alerts</div>
                            <div style="font-size:0.75rem; padding:6px; color:var(--text-secondary);">Zone Studio</div>
                            <div style="font-size:0.75rem; padding:6px; color:var(--text-secondary);">License Seats</div>
                        </div>
                        <!-- Main Content Grid -->
                        <div style="display:flex; flex-direction:column; gap:12px;">
                            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px;">
                                <div style="background:#fff; padding:10px; border:1px solid var(--border-light); border-radius:6px;">
                                    <div style="font-size:0.65rem; color:var(--text-muted); font-weight:700;">ACTIVE CAMERAS</div>
                                    <div style="font-size:1.2rem; font-weight:900;">24 / 24</div>
                                </div>
                                <div style="background:#fff; padding:10px; border:1px solid var(--border-light); border-radius:6px;">
                                    <div style="font-size:0.65rem; color:var(--text-muted); font-weight:700;">ALERTS (24H)</div>
                                    <div style="font-size:1.2rem; font-weight:900; color:var(--accent-rose);">14</div>
                                </div>
                                <div style="background:#fff; padding:10px; border:1px solid var(--border-light); border-radius:6px;">
                                    <div style="font-size:0.65rem; color:var(--text-muted); font-weight:700;">ENGINE LATENCY</div>
                                    <div style="font-size:1.2rem; font-weight:900; color:var(--accent-emerald);">12.4 ms</div>
                                </div>
                            </div>
                            <!-- Mini Video Preview Grid -->
                            <div style="background:#090d16; border-radius:6px; flex:1; padding:8px; display:grid; grid-template-columns:1fr 1fr; gap:6px;">
                                <div style="background:#111827; border:1px solid #1f2937; border-radius:4px; position:relative; overflow:hidden;">
                                    <span class="font-mono" style="position:absolute; top:4px; left:4px; font-size:0.6rem; color:#fff; background:rgba(0,0,0,0.6); padding:1px 4px;">CAM-01 [MAIN GATE]</span>
                                </div>
                                <div style="background:#111827; border:1px solid #1f2937; border-radius:4px; position:relative; overflow:hidden;">
                                    <span class="font-mono" style="position:absolute; top:4px; left:4px; font-size:0.6rem; color:#fff; background:rgba(0,0,0,0.6); padding:1px 4px;">CAM-02 [PERIMETER]</span>
                                </div>
                            </div>
                        </div>
                        <!-- Right Panel Feed -->
                        <div style="background:#ffffff; border:1px solid var(--border-light); border-radius:6px; padding:12px;">
                            <div style="font-weight:700; font-size:0.75rem; border-bottom:1px solid var(--border-light); padding-bottom:6px; margin-bottom:8px;">REAL-TIME EVENT FEED</div>
                            <div style="font-size:0.7rem; margin-bottom:8px;"><span class="font-mono" style="color:var(--accent-rose);">[10:48:12]</span> Intrusion - CAM-02</div>
                            <div style="font-size:0.7rem; margin-bottom:8px;"><span class="font-mono" style="color:var(--accent-amber);">[10:45:04]</span> Line Cross - CAM-01</div>
                            <div style="font-size:0.7rem; margin-bottom:8px;"><span class="font-mono" style="color:var(--accent-emerald);">[10:40:22]</span> Vehicle Count +1</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 14. DESKTOP PLATFORM SIMULATION -->
            <div style="margin-bottom:3rem;">
                <div style="margin-bottom:1rem;">
                    <span class="font-mono" style="color:var(--accent-indigo); font-weight:700; font-size:0.8rem;">02 / DESKTOP PLATFORM</span>
                    <h3 style="font-size:1.5rem; font-weight:800;">Windows Desktop Control Room (4×4 Multi-Grid)</h3>
                </div>
                <div class="simulated-ui-card" style="background:#090d16; color:#fff; border-color:#1e293b;">
                    <div class="simulated-header" style="background:#111827; border-color:#1f2937;">
                        <span style="font-weight:800; font-size:0.85rem; color:#818cf8;">CAMAI DESKTOP MONITORING STATION (DPAPI LOCKED)</span>
                        <span class="font-mono" style="font-size:0.7rem; color:#10b981;">38.4 FPS AVERAGE</span>
                    </div>
                    <div class="simulated-body" style="display:grid; grid-template-columns: 180px 1fr; gap:12px;">
                        <div style="background:#111827; border:1px solid #1f2937; border-radius:6px; padding:10px;">
                            <div class="font-mono" style="font-size:0.65rem; color:#94a3b8; margin-bottom:8px;">CAMERA TREE</div>
                            <div style="font-size:0.725rem; color:#38bdf8; margin-bottom:4px;">▼ Building A</div>
                            <div style="font-size:0.7rem; color:#cbd5e1; padding-left:10px; margin-bottom:2px;">• Cam 01 North Gate</div>
                            <div style="font-size:0.7rem; color:#cbd5e1; padding-left:10px; margin-bottom:2px;">• Cam 02 East Wall</div>
                            <div style="font-size:0.725rem; color:#38bdf8; margin-bottom:4px; margin-top:6px;">▼ Factory Floor</div>
                            <div style="font-size:0.7rem; color:#cbd5e1; padding-left:10px;">• Cam 03 Assembly Line</div>
                        </div>
                        <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; height:240px;">
                            <div style="background:#1f2937; border:1px solid #374151; border-radius:4px; position:relative;">
                                <span class="font-mono" style="position:absolute; top:4px; left:4px; font-size:0.6rem; color:#10b981;">CAM-01 [30 FPS]</span>
                            </div>
                            <div style="background:#1f2937; border:1px solid #374151; border-radius:4px; position:relative;">
                                <span class="font-mono" style="position:absolute; top:4px; left:4px; font-size:0.6rem; color:#10b981;">CAM-02 [30 FPS]</span>
                            </div>
                            <div style="background:#1f2937; border:1px solid #374151; border-radius:4px; position:relative;">
                                <span class="font-mono" style="position:absolute; top:4px; left:4px; font-size:0.6rem; color:#10b981;">CAM-03 [30 FPS]</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 15. MOBILE PLATFORM SIMULATION -->
            <div>
                <div style="margin-bottom:1rem;">
                    <span class="font-mono" style="color:var(--accent-emerald); font-weight:700; font-size:0.8rem;">03 / MOBILE PLATFORM</span>
                    <h3 style="font-size:1.5rem; font-weight:800;">Mobile Incident Response App & Push Alerts</h3>
                </div>
                <div style="display:flex; justify-content:center;">
                    <!-- Native CSS Phone Frame (No Images) -->
                    <div style="width:280px; background:#0f172a; border:4px solid #334155; border-radius:32px; padding:12px; box-shadow:var(--shadow-lg);">
                        <div style="width:80px; height:4px; background:#334155; border-radius:2px; margin:0 auto 12px;"></div>
                        <div style="background:#ffffff; border-radius:20px; padding:12px; height:420px; display:flex; flex-direction:column; justify-space-between;">
                            <div>
                                <div style="font-weight:900; font-size:0.9rem; color:var(--text-primary); margin-bottom:12px;">CamAI Mobile</div>
                                <div style="background:#fee2e2; border:1px solid #fca5a5; border-radius:8px; padding:8px; margin-bottom:10px;">
                                    <div style="font-size:0.65rem; font-weight:800; color:#dc2626;">CRITICAL INTRUSION ALERT</div>
                                    <div style="font-size:0.75rem; font-weight:700; color:#0f172a;">Zone A Violation - CAM-02</div>
                                    <div style="font-size:0.65rem; color:var(--text-secondary);">2 mins ago • Person Detected</div>
                                </div>
                                <div style="background:#f1f5f9; border-radius:8px; padding:8px; font-size:0.7rem;">
                                    <div style="font-weight:700; margin-bottom:4px;">Live Stream Connect</div>
                                    <div style="color:var(--text-secondary);">Phone RTSP Camera active at http://192.168.1.50:8080</div>
                                </div>
                            </div>
                            <div style="display:flex; justify-content:space-around; border-top:1px solid var(--border-light); padding-top:8px; font-size:0.65rem; font-weight:700; color:var(--text-muted);">
                                <span>Alerts</span>
                                <span style="color:var(--accent-blue);">Cameras</span>
                                <span>Events</span>
                                <span>Profile</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <!-- 07. SEVEN SPECIALIZED AI MODULES -->
    <section class="section-padding section-dark" id="modules">
        <div class="container">
            <div class="section-header">
                <span class="section-badge">INTELLIGENCE MODULES</span>
                <h2 class="section-title">Seven Specialized Computer Vision Modules</h2>
                <p class="section-desc">Modular, high-performance analytics engines tailored for specific domain requirements across perimeter security, industrial compliance, traffic, and micro-motion.</p>
            </div>
            <div class="modules-grid">
                <div class="module-card">
                    <div class="module-num">01</div>
                    <h3 class="module-title">Traffic & Vehicle Analytics</h3>
                    <p style="font-size:0.875rem; color:var(--text-secondary);">Vehicle counting, speed estimation, illegal parking detection, lane occupation, and bi-directional traffic flow vector analysis.</p>
                    <div class="module-tags"><span class="tag-pill">Vehicle Count</span><span class="tag-pill">Speed Estimation</span><span class="tag-pill">Line Cross</span></div>
                </div>
                <div class="module-card">
                    <div class="module-num">02</div>
                    <h3 class="module-title">Security & Perimeter Protection</h3>
                    <p style="font-size:0.875rem; color:var(--text-secondary);">Person & vehicle intrusion detection, tripwire crossing, polygonal ROI boundary monitoring, and loitering threshold alerts.</p>
                    <div class="module-tags"><span class="tag-pill">Intrusion</span><span class="tag-pill">Tripwire</span><span class="tag-pill">Loitering</span></div>
                </div>
                <div class="module-card">
                    <div class="module-num">03</div>
                    <h3 class="module-title">Factory PPE & Worker Safety</h3>
                    <p style="font-size:0.875rem; color:var(--text-secondary);">Mandatory hardhat detection, high-visibility vest compliance, safety glove validation, and hazardous machinery entry monitoring.</p>
                    <div class="module-tags"><span class="tag-pill">Hardhat</span><span class="tag-pill">Vest</span><span class="tag-pill">PPE Safety</span></div>
                </div>
                <div class="module-card">
                    <div class="module-num">04</div>
                    <h3 class="module-title">Retail Footfall & Dwell Intelligence</h3>
                    <p style="font-size:0.875rem; color:var(--text-secondary);">Customer footfall counting, aisle dwell time measurement, queue length alerts, and spatial density heatmap generation.</p>
                    <div class="module-tags"><span class="tag-pill">Footfall</span><span class="tag-pill">Dwell Time</span><span class="tag-pill">Heatmaps</span></div>
                </div>
                <div class="module-card">
                    <div class="module-num">05</div>
                    <h3 class="module-title">Smart City & Public Crowding</h3>
                    <p style="font-size:0.875rem; color:var(--text-secondary);">Public space crowd density estimation, stampede risk warning, unattended bag detection, and civic infrastructure safety.</p>
                    <div class="module-tags"><span class="tag-pill">Crowd Density</span><span class="tag-pill">Unattended Bag</span></div>
                </div>
                <div class="module-card">
                    <div class="module-num">06</div>
                    <h3 class="module-title">Micro-Motion & Anomaly Detection</h3>
                    <p style="font-size:0.875rem; color:var(--text-secondary);">Sub-pixel motion analysis for industrial machinery vibration monitoring, conveyor belt jamming, and subtle structural movement.</p>
                    <div class="module-tags"><span class="tag-pill">Optical Flow</span><span class="tag-pill">Vibration</span></div>
                </div>
                <div class="module-card" style="grid-column: span 1;">
                    <div class="module-num">07</div>
                    <h3 class="module-title">Custom AI & Trigger Engine</h3>
                    <p style="font-size:0.875rem; color:var(--text-secondary);">Customer-specific model weight integration, custom object classes, and multi-condition logical rule trigger engines.</p>
                    <div class="module-tags"><span class="tag-pill">Custom Weights</span><span class="tag-pill">IF-THEN Engine</span></div>
                </div>
            </div>
        </div>
    </section>

    <!-- 08. LIVE COMPUTER VISION INTERACTIVE VIEWPORT -->
    <section class="section-padding">
        <div class="container">
            <div class="section-header">
                <span class="section-badge">LIVE COMPUTER VISION</span>
                <h2 class="section-title">See Detection & Tracking in Real-Time</h2>
                <p class="section-desc">Simulated viewport showing real-time object bounding boxes, confidence scores, Kalman track vectors, and active ROI tripwires.</p>
            </div>
            <div class="vision-viewport">
                <!-- Top Status Bar -->
                <div style="position:absolute; top:0; left:0; right:0; padding:10px 16px; background:rgba(15,23,42,0.85); display:flex; justify-content:space-between; align-items:center; z-index:10; border-bottom:1px solid rgba(255,255,255,0.1);">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="status-dot"></span>
                        <span class="font-mono" style="font-size:0.75rem; color:#fff; font-weight:700;">LIVE CAM-04 [NORTH GATE]</span>
                    </div>
                    <div class="font-mono" style="font-size:0.75rem; color:#10b981;">1080P • 30.0 FPS • LATENCY: 11.2ms • SIMULATED INTERFACE</div>
                </div>

                <!-- Bounding Box 1: Person -->
                <div class="vision-overlay-box" style="top:25%; left:30%; width:120px; height:200px;">
                    <div class="vision-overlay-label">PERSON 98% #TRACK_042</div>
                </div>

                <!-- Bounding Box 2: Vehicle -->
                <div class="vision-overlay-box" style="top:40%; left:60%; width:220px; height:140px; border-color:#38bdf8; background:rgba(56,189,248,0.1);">
                    <div class="vision-overlay-label" style="background:#38bdf8;">VEHICLE 94% #TRACK_089</div>
                </div>

                <!-- ROI Polygon Line Overlay -->
                <svg style="position:absolute; top:0; left:0; width:100%; height:100%; pointer-events:none;">
                    <polyline points="100,300 400,280 700,320" fill="none" stroke="#ef4444" stroke-width="2" stroke-dasharray="6 4"/>
                    <text x="410" y="275" fill="#ef4444" font-size="10" font-family="Fira Code" font-weight="700">TRIPWIRE LINE A [RESTRICTED ENTRY]</text>
                </svg>
            </div>
        </div>
    </section>

    <!-- 16. EDGE / ACAP APPLICATION DETAILS -->
    <section class="section-padding section-dark" id="acap-edge">
        <div class="container">
            <div class="section-header">
                <span class="section-badge">EDGE RUNTIME</span>
                <h2 class="section-title">ACAP Native Edge Application Architecture</h2>
                <p class="section-desc">On-device C++ application running natively on camera edge hardware. Zero cloud latency, zero CPU frame copying, and full ONVIF event publishing.</p>
            </div>
            <div class="statement-grid">
                <div class="statement-card" style="background:#111827; border-color:#1f2937; color:#fff;">
                    <div class="font-mono" style="font-size:0.75rem; color:#fbbf24; font-weight:700; margin-bottom:6px;">VDO STREAM API</div>
                    <h4 style="font-weight:800; font-size:1rem; margin-bottom:6px;">Zero-Copy ISP Buffer</h4>
                    <p style="font-size:0.825rem; color:#94a3b8;">Direct NV12 frame buffer acquisition from camera ISP via `vdo-stream.h` without CPU memory copying.</p>
                </div>
                <div class="statement-card" style="background:#111827; border-color:#1f2937; color:#fff;">
                    <div class="font-mono" style="font-size:0.75rem; color:#fbbf24; font-weight:700; margin-bottom:6px;">LAROD NPU API</div>
                    <div class="font-mono" style="font-size:0.75rem; color:#fbbf24; font-weight:700; margin-bottom:6px;">Hardware NPU Acceleration</div>
                    <p style="font-size:0.825rem; color:#94a3b8;">Direct `larod.h` tensor execution of 8-bit quantized YOLOX-Tiny models on camera DLPU NPU chips.</p>
                </div>
                <div class="statement-card" style="background:#111827; border-color:#1f2937; color:#fff;">
                    <div class="font-mono" style="font-size:0.75rem; color:#fbbf24; font-weight:700; margin-bottom:6px;">AXEVENT & AXOVERLAY</div>
                    <h4 style="font-weight:800; font-size:1rem; margin-bottom:6px;">ONVIF Events & Overlays</h4>
                    <p style="font-size:0.825rem; color:#94a3b8;">Native XML ONVIF event producer for Milestone/Genetec VMS and hardware stream bounding box rendering.</p>
                </div>
                <div class="statement-card" style="background:#111827; border-color:#1f2937; color:#fff;">
                    <div class="font-mono" style="font-size:0.75rem; color:#fbbf24; font-weight:700; margin-bottom:6px;">EAP PACKAGE</div>
                    <h4 style="font-weight:800; font-size:1rem; margin-bottom:6px;">Standalone EAP Installer</h4>
                    <p style="font-size:0.825rem; color:#94a3b8;">Bundled manifest, C++ binary, and models into `camai_acap_1_0_0_aarch64.eap` package for single-click installation.</p>
                </div>
            </div>
        </div>
    </section>

    <!-- 25. ENTERPRISE OPERATIONS GRID -->
    <section class="section-padding">
        <div class="container">
            <div class="section-header">
                <span class="section-badge">ENTERPRISE READY</span>
                <h2 class="section-title">Built for Mission-Critical Operations</h2>
                <p class="section-desc">Designed to support multi-site enterprises, high-security infrastructure, and large camera fleets.</p>
            </div>
            <div class="statement-grid">
                <div class="statement-card">
                    <h4 style="font-weight:800; font-size:0.95rem; margin-bottom:4px;">Multi-Camera Fleet</h4>
                    <p style="font-size:0.825rem; color:var(--text-secondary);">Centralized discovery, status telemetry, and sync for hundreds of RTSP streams.</p>
                </div>
                <div class="statement-card">
                    <h4 style="font-weight:800; font-size:0.95rem; margin-bottom:4px;">Granular RBAC Roles</h4>
                    <p style="font-size:0.825rem; color:var(--text-secondary);">4-tier role hierarchy (Org Admin, Operator, Site Manager, Compliance Auditor).</p>
                </div>
                <div class="statement-card">
                    <h4 style="font-weight:800; font-size:0.95rem; margin-bottom:4px;">Encrypted DPAPI Locks</h4>
                    <p style="font-size:0.825rem; color:var(--text-secondary);">Windows machine token encryption bound to MachineGUID, CPU ID, and TPM serials.</p>
                </div>
                <div class="statement-card">
                    <h4 style="font-weight:800; font-size:0.95rem; margin-bottom:4px;">Tamper-Proof Audit Logs</h4>
                    <p style="font-size:0.825rem; color:var(--text-secondary);">Immutable action history tracking operator triage, zone edits, and login events.</p>
                </div>
            </div>
        </div>
    </section>

    <!-- 35. FAQ ACCORDION -->
    <section class="section-padding" style="background:#f1f5f9;">
        <div class="container" style="max-width:860px;">
            <div class="section-header">
                <span class="section-badge">FREQUENTLY ASKED QUESTIONS</span>
                <h2 class="section-title">Technical FAQ</h2>
            </div>

            <div class="faq-item active">
                <div class="faq-question" onclick="this.parentElement.classList.toggle('active')">
                    <span>What is CamAI and how does it process video?</span>
                    <span>+</span>
                </div>
                <div class="faq-answer">
                    CamAI is an enterprise video intelligence platform that ingests live camera streams (RTSP/ONVIF), decodes NV12 frame buffers, runs AI inference via YOLOX/Larod NPU engines, tracks motion using C++ ByteTrack Kalman filters, and emits real-time security events to Web, Desktop, Mobile, and Edge.
                </div>
            </div>

            <div class="faq-item">
                <div class="faq-question" onclick="this.parentElement.classList.toggle('active')">
                    <span>Are Web, Desktop, Mobile, and Edge separate products?</span>
                    <span>+</span>
                </div>
                <div class="faq-answer">
                    No. They are four deployment surfaces connected to ONE central CamAI computer vision intelligence ecosystem.
                </div>
            </div>

            <div class="faq-item">
                <div class="faq-question" onclick="this.parentElement.classList.toggle('active')">
                    <span>What AI modules are included in CamAI?</span>
                    <span>+</span>
                </div>
                <div class="faq-answer">
                    CamAI includes 7 specialized modules: Traffic Analytics, Security & Perimeter Protection, Factory PPE Compliance, Retail Footfall & Dwell, Smart City Crowding, Micro-Motion Vibration Anomaly, and Custom Rules Engine.
                </div>
            </div>
        </div>
    </section>

    <!-- 36. FINAL CTA -->
    <section class="section-padding section-dark" id="contact" style="text-align:center;">
        <div class="container" style="max-width:720px;">
            <h2 style="font-size:2.5rem; font-weight:900; letter-spacing:-1px; margin-bottom:1rem; line-height:1.2;">
                One Platform.<br>Every Camera.<br>Actionable Intelligence.
            </h2>
            <p style="font-size:1.1rem; color:#94a3b8; margin-bottom:2rem;">
                From real-time detection to enterprise operations, CamAI connects computer vision with the tools teams use every day.
            </p>
            <div style="display:flex; justify-content:center; gap:12px; flex-wrap:wrap;">
                <a href="#" class="btn-primary" style="padding:12px 28px; font-size:0.95rem;">Explore CamAI</a>
                <a href="#" class="btn-outline" style="background:transparent; color:#fff; border-color:#334155; padding:12px 28px; font-size:0.95rem;">Request Demo</a>
            </div>
            <div class="font-mono" style="font-size:0.8rem; color:#64748b; margin-top:2rem;">
                Web • Desktop • Mobile • Edge / ACAP
            </div>
        </div>
    </section>

    <!-- 37. FOOTER -->
    <footer>
        <div class="container">
            <div class="footer-grid">
                <div>
                    <div style="display:flex; align-items:center; gap:8px; font-weight:900; font-size:1.2rem; color:#fff; margin-bottom:1rem;">
                        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5" style="width:24px; height:24px; color:var(--accent-blue);"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>
                        CamAI
                    </div>
                    <p style="font-size:0.85rem; color:#94a3b8;">Enterprise Video Intelligence Platform transforming camera streams into real-time operational computer vision AI.</p>
                </div>
                <div>
                    <div class="footer-title">Platform</div>
                    <ul class="footer-links">
                        <li><a href="#overview">Overview</a></li>
                        <li><a href="#ecosystem">Ecosystem</a></li>
                        <li><a href="#ai-engine">AI Engine</a></li>
                    </ul>
                </div>
                <div>
                    <div class="footer-title">Deployments</div>
                    <ul class="footer-links">
                        <li><a href="#surfaces">Web Portal</a></li>
                        <li><a href="#surfaces">Desktop Client</a></li>
                        <li><a href="#surfaces">Mobile App</a></li>
                        <li><a href="#acap-edge">Edge / ACAP</a></li>
                    </ul>
                </div>
                <div>
                    <div class="footer-title">Modules</div>
                    <ul class="footer-links">
                        <li><a href="#modules">Security</a></li>
                        <li><a href="#modules">Traffic</a></li>
                        <li><a href="#modules">PPE Safety</a></li>
                        <li><a href="#modules">Retail</a></li>
                    </ul>
                </div>
                <div>
                    <div class="footer-title">Enterprise</div>
                    <ul class="footer-links">
                        <li><a href="#security">Security</a></li>
                        <li><a href="#performance">Performance</a></li>
                        <li><a href="#contact">Request Demo</a></li>
                    </ul>
                </div>
            </div>
            <div style="border-top:1px solid #1e293b; padding-top:1.5rem; text-align:center; font-size:0.8rem; color:#64748b;">
                © 2026 CamAI Enterprise. All rights reserved. Target Route: <code>camai.princesite.in/overview</code>
            </div>
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
        f.write(master_html)

print("Master enterprise product overview generated cleanly!")
