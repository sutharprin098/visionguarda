# CamAI Enterprise - Production Deployment Guide

---

## 1. Production Docker Compose Stack

```yaml
version: '3.8'

services:
  camai-engine:
    build:
      context: ./server
      dockerfile: Dockerfile
    restart: always
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://postgres:pass@db:5432/camai_db
      - CAMAI_FORCE_GPU=1
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    volumes:
      - ./server/app/clips:/app/app/clips
      - ./server/app/snapshots:/app/app/snapshots

  camai-portal:
    build:
      context: ./client
      dockerfile: Dockerfile
    restart: always
    ports:
      - "3000:80"

  db:
    image: postgres:15-alpine
    restart: always
    environment:
      POSTGRES_DB: camai_db
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: pass
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

---

## 2. Launching Docker Services

```bash
docker-compose up -d
```
