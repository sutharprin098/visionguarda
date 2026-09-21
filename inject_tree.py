import os

tree_css = """
    /* System Architecture Tree Styling */
    .tree-section {
        background: #ffffff;
        border: 2px solid #cbd5e1;
        border-radius: 8px;
        padding: 28px 24px;
        margin: 24px 0 36px;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.06);
    }
    .tree-header-title {
        font-size: 16px;
        font-weight: 800;
        color: #1e3a8a;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        margin-bottom: 22px;
        text-align: center;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
    }
    .tree-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        width: 100%;
    }
    .tree-root-node {
        background: #1e3a8a;
        color: #ffffff;
        padding: 12px 28px;
        border-radius: 6px;
        font-weight: 800;
        font-size: 14px;
        letter-spacing: 0.5px;
        text-transform: uppercase;
        box-shadow: 0 4px 12px rgba(30, 58, 138, 0.25);
        border: 2px solid #1d4ed8;
        text-align: center;
    }
    .tree-stem {
        width: 2px;
        height: 24px;
        background: #94a3b8;
    }
    .tree-branch-connector {
        width: 78%;
        height: 2px;
        background: #94a3b8;
        position: relative;
    }
    .tree-branches {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 16px;
        width: 100%;
        margin-top: 18px;
    }
    @media (max-width: 850px) {
        .tree-branches { grid-template-columns: repeat(2, 1fr); }
    }
    .tree-branch-card {
        background: #f8fafc;
        border: 1px solid #cbd5e1;
        border-top: 4px solid #0284c7;
        border-radius: 6px;
        padding: 16px 14px;
        transition: all 0.2s ease;
    }
    .tree-branch-card:hover {
        transform: translateY(-3px);
        box-shadow: 0 6px 16px rgba(0,0,0,0.08);
        border-color: #0284c7;
    }
    .tree-branch-card.portal { border-top-color: #0284c7; }
    .tree-branch-card.desktop { border-top-color: #4f46e5; }
    .tree-branch-card.mobile { border-top-color: #16a34a; }
    .tree-branch-card.acap { border-top-color: #d97706; }

    .tree-branch-title {
        font-size: 13px;
        font-weight: 800;
        color: #0f172a;
        text-transform: uppercase;
        margin-bottom: 6px;
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .tree-sub-tag {
        font-family: 'Fira Code', monospace;
        font-size: 10px;
        color: #475569;
        background: #e2e8f0;
        padding: 2px 6px;
        border-radius: 3px;
        display: inline-block;
        margin-bottom: 10px;
    }
    .tree-leaf-list {
        list-style: none;
        padding: 0;
        margin: 0;
    }
    .tree-leaf-item {
        font-size: 11px;
        color: #334155;
        padding: 3px 0;
        border-bottom: 1px dashed #e2e8f0;
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .tree-leaf-item:last-child { border-bottom: none; }
    .tree-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: #0284c7;
        flex-shrink: 0;
    }
"""

tree_html = """
    <!-- Interactive Architecture Tree Section -->
    <div class="tree-section">
        <div class="tree-header-title">
            <span>🌳 CamAI Enterprise System Architecture Hierarchy Tree</span>
        </div>
        <div class="tree-container">
            <div class="tree-root-node">
                📹 CamAI Enterprise AI Video Analytics Platform
            </div>
            <div class="tree-stem"></div>
            <div class="tree-branch-connector"></div>
            
            <div class="tree-branches">
                <!-- Branch 1: Web SaaS -->
                <div class="tree-branch-card portal">
                    <div class="tree-branch-title">🌐 Web SaaS Portal</div>
                    <div class="tree-sub-tag">portal/ & supabase/</div>
                    <ul class="tree-leaf-list">
                        <li class="tree-leaf-item"><span class="tree-dot"></span> PostgreSQL Row Level Security</li>
                        <li class="tree-leaf-item"><span class="tree-dot"></span> Interactive Zone Studio</li>
                        <li class="tree-leaf-item"><span class="tree-dot"></span> Multi-Tenant Organization Desk</li>
                        <li class="tree-leaf-item"><span class="tree-dot"></span> Supabase Edge Dispatched Alerts</li>
                    </ul>
                </div>

                <!-- Branch 2: Desktop Client -->
                <div class="tree-branch-card desktop">
                    <div class="tree-branch-title">🖥️ Desktop Client</div>
                    <div class="tree-sub-tag">desktop/</div>
                    <ul class="tree-leaf-list">
                        <li class="tree-leaf-item"><span class="tree-dot" style="background:#4f46e5;"></span> Encrypted DPAPI Hardware Lock</li>
                        <li class="tree-leaf-item"><span class="tree-dot" style="background:#4f46e5;"></span> Zero-Latency 30-40 FPS Grid</li>
                        <li class="tree-leaf-item"><span class="tree-dot" style="background:#4f46e5;"></span> Local FastAPI Engine Sync</li>
                        <li class="tree-leaf-item"><span class="tree-dot" style="background:#4f46e5;"></span> ONVIF & RTSP Camera Discovery</li>
                    </ul>
                </div>

                <!-- Branch 3: Mobile App -->
                <div class="tree-branch-card mobile">
                    <div class="tree-branch-title">📱 Mobile Application</div>
                    <div class="tree-sub-tag">mobile/</div>
                    <ul class="tree-leaf-list">
                        <li class="tree-leaf-item"><span class="tree-dot" style="background:#16a34a;"></span> Mobile Push Snapshot Alerts</li>
                        <li class="tree-leaf-item"><span class="tree-dot" style="background:#16a34a;"></span> Mobile Phone Camera IP Streamer</li>
                        <li class="tree-leaf-item"><span class="tree-dot" style="background:#16a34a;"></span> Touch Screen ROI Polygon Editor</li>
                        <li class="tree-leaf-item"><span class="tree-dot" style="background:#16a34a;"></span> Telegram Bot Integration</li>
                    </ul>
                </div>

                <!-- Branch 4: ACAP Native Edge -->
                <div class="tree-branch-card acap">
                    <div class="tree-branch-title">📹 ACAP Native Edge</div>
                    <div class="tree-sub-tag">ACAP/</div>
                    <ul class="tree-leaf-list">
                        <li class="tree-leaf-item"><span class="tree-dot" style="background:#d97706;"></span> Hardware VDO Zero-Copy API</li>
                        <li class="tree-leaf-item"><span class="tree-dot" style="background:#d97706;"></span> Larod NPU Model Acceleration</li>
                        <li class="tree-leaf-item"><span class="tree-dot" style="background:#d97706;"></span> Native C++ ByteTrack Kalman</li>
                        <li class="tree-leaf-item"><span class="tree-dot" style="background:#d97706;"></span> axevent & axoverlay ONVIF</li>
                    </ul>
                </div>
            </div>
        </div>
    </div>
"""

paths = [
    r"d:\camAI\overview_site\index.html",
    r"d:\camAI\portal\public\overview\index.html",
    r"d:\camAI\portal\public\overview.html"
]

for p in paths:
    with open(p, "r", encoding="utf-8") as f:
        html = f.read()

    if "</style>" in html:
        html_updated = html.replace("</style>", tree_css + "\n</style>", 1)
    else:
        html_updated = html

    if '<div class="header">' in html_updated:
        html_updated = html_updated.replace('<div class="header">', tree_html + '\n<div class="header">', 1)
    elif "</header>" in html_updated:
        html_updated = html_updated.replace("</header>", "</header>\n" + tree_html, 1)
    elif '<div class="doc-container">' in html_updated:
        html_updated = html_updated.replace('<div class="doc-container">', '<div class="doc-container">\n' + tree_html, 1)
    else:
        html_updated = tree_html + html_updated

    with open(p, "w", encoding="utf-8") as f:
        f.write(html_updated)

print("Architecture Tree injected successfully into all overview files!")
