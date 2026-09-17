# CamAI Documentation

| # | Document | Covers |
|---|---|---|
| 1 | [Accuracy Specification](ACCURACY.md) | Formal AI accuracy metrics, ANPR OCR, ByteTrack tracking, helmet, speed, and PR curves |
| 2 | [Architecture](ARCHITECTURE.md) | Workspace topology, data flow, multi-tenancy, decoupled video/AI design |
| 3 | [AI Engine](AI_ENGINE.md) | Detection/tracking/analytics pipeline, models, hardware backends |
| 4 | [API Reference](API.md) | REST endpoints and WebSocket telemetry protocol |
| 5 | [Database](DATABASE.md) | Supabase schema, RLS, licensing and device-binding model |
| 6 | [Installation](INSTALLATION.md) | Development environment setup per workspace |
| 7 | [Deployment](DEPLOYMENT.md) | Building the engine, the desktop installer, and releasing |
| 8 | [Security](SECURITY.md) | Auth, RBAC, encryption, DNS-rebinding guard, and security audit status |
| 9 | [Performance](PERFORMANCE.md) | Measured throughput, latency percentiles, multi-camera scaling, and sizing |
| 10 | [Licensing](LICENSING.md) | Ownership and third-party (model + dependency) license inventory |
| 11 | [Testing](TESTING.md) | Test suite layout, benchmark runner, and verification instructions |
| 12 | [User Guide](USER_GUIDE.md) | Operator-facing walkthrough of the desktop app |
| 13 | [Handover](HANDOVER.md) | What a buyer/new engineer receives, and verification status |

Start with [Accuracy Specification](ACCURACY.md) or [Architecture](ARCHITECTURE.md) if you're new to the codebase, or [Installation](INSTALLATION.md) if you just want it running.

Root-level [`../README.md`](../README.md) has the project summary and quick start; [`../LICENSE`](../LICENSE) has the legal terms.
