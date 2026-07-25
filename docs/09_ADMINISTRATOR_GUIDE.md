# CamAI Enterprise - Administrator Guide

---

> **Classification**: Enterprise Operations & System Administration Manual  
> **Document Reference**: `DOC-ADM-09`

---

## 1. System Administration Overview

The **Admin Studio** provides centralized management over system health, license activation, user access control, GPU resource tuning, database backup/restore, and logging configuration.

---

## 2. Managing Users & Access Control (RBAC)

1. Log into the web portal or desktop application using an Administrator account.
2. Navigate to **Admin Studio** -> **User Management**.
3. Click **Add User**:
   - Assign **Email**, **Full Name**, and **Initial Password**.
   - Select Role: `Admin`, `Operator`, or `Viewer`.
4. Password enforcement requires a minimum 12-character length, uppercase/lowercase letters, digits, and special characters.

---

## 3. Monitoring System Health & GPU Tuning

The Admin Dashboard provides real-time system metrics:
- **GPU Usage & VRAM**: Continuously sampled via `gpu_monitor.py`.
- **Resource Governor Mode**:
  - `Auto Mode`: Dynamic closed-loop headroom scaling (Recommended).
  - `Latency Mode`: Equal latency budget allocation across active camera streams.
  - `Off`: Maximum unconstrained GPU execution.

---

## 4. Backup & Disaster Recovery Procedures

### 4.1 Database Backup
Execute PostgreSQL backup script:
```bash
pg_dump -U postgres -h localhost -d camai_db > /backups/camai_db_$(date +%Y%m%d_%H%M%S).sql
```

### 4.2 Restoring Database
```bash
psql -U postgres -h localhost -d camai_db < /backups/camai_db_20260723_120000.sql
```

### 4.3 Incident Clips Backup
Video evidence clips are stored in `server/app/clips/`. Set up a daily cron job to sync evidence clips to S3/Azure Blob or network-attached storage (NAS):
```bash
aws s3 sync server/app/clips/ s3://enterprise-camai-evidence-backup/clips/
```
