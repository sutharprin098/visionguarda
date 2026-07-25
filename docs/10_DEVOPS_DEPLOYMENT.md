# CamAI Enterprise - DevOps & Enterprise Deployment Guide

---

> **Classification**: Enterprise Infrastructure & DevOps Manual  
> **Document Reference**: `DOC-DEVOPS-10`

---

## 1. Enterprise Deployment Topologies

```mermaid
graph TD
    UserClient[Web & Desktop Clients] --> Cloudflare[Cloudflare WAF / DDoS Protection]
    Cloudflare --> NGINX[NGINX Reverse Proxy & SSL Termination]
    
    subgraph Enterprise Infrastructure Node
        NGINX -->|HTTP / API| AppNode1[CamAI FastAPI App Instance 1]
        NGINX -->|HTTP / API| AppNode2[CamAI FastAPI App Instance 2]
        NGINX -->|WebSocket Telemetry| WSServer[FastAPI WebSocket Cluster]
        
        AppNode1 & AppNode2 --> GPUCluster[NVIDIA GPU Cluster CUDA/TensorRT]
        AppNode1 & AppNode2 --> DB[(PostgreSQL Database Cluster)]
        AppNode1 & AppNode2 --> SharedStorage[S3 / NAS Incident Storage]
    end
```

---

## 2. Production NGINX Configuration (`nginx.conf`)

```nginx
server {
    listen 80;
    server_name camai.enterprise.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name camai.enterprise.com;

    ssl_certificate /etc/letsencrypt/live/camai.enterprise.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/camai.enterprise.com/privkey.pem;

    # Web SaaS Portal Frontend
    location / {
        root /var/www/camai-client;
        try_files $uri /index.html;
    }

    # FastAPI REST Engine
    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # WebSocket Telemetry Channel
    location /ws/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400s;
    }
}
```
