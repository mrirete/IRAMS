# IRAMS — Intelligent Reliability & Asset Management System

> AI-Powered Enterprise Asset Management (EAM) platform — the single source of truth for assets, maintenance, inventory, people, and performance.

Built on **ISO 55000**, **ISO 14224**, and **ISO 31000** standards. Optimized for oil & gas, flexible across industries. Comparable to SAP PM / IBM Maximo / Limble CMMS — with integrated AI reliability intelligence.

---

## 🏗️ Architecture

```
Enterprise → Site → Unit → System → Equipment → Subunit → Component
```

| Layer | Purpose | Stack |
|-------|---------|-------|
| **Layer 1 — Data Fabric** | Connectors, Knowledge Graph, P&ID Parser, Data Quality | Python · Neo4j |
| **Layer 2 — Modules** | EAM core (16 modules), AI Engine, Reliability Analysis | Python · FastAPI |
| **Layer 3 — Agents** | Autonomous AI agents for predictive intelligence | Python · Gemini |
| **Layer 4 — Integration** | External system connectors, APIs | Python |
| **Frontend** | Single-page application, mobile-first | React · TypeScript · Vite |
| **Infrastructure** | Docker, Helm, Terraform, Air-gapped deployment | YAML · HCL |

---

## 📦 Core Modules

| # | Module | Description |
|---|--------|-------------|
| 1 | **Asset Registry** | ISO 14224 taxonomy, criticality ranking, asset lifecycle |
| 2 | **Work Management** | Work Requests → Work Orders, TECO gating, failure coding |
| 3 | **Preventive Maintenance** | PM scheduling, compliance tracking, calendar optimization |
| 4 | **Inventory & Procurement** | Spare parts, BOM integration, reorder automation |
| 5 | **Reliability Analysis** | FMEA/FMECA, RCA, Weibull, Bad Actor identification |
| 6 | **Compliance & Safety** | Audit management, JSA, regulatory tracking |
| 7 | **Document Management** | Technical drawings, procedures, revision control |
| 8 | **People & Permissions** | RBAC, MFA/SSO, per-username scoped access |
| 9 | **Cost Management** | Immutable cost snapshots, budget tracking |
| 10 | **KPI & Dashboards** | OEE, MTBF/MTTR, Pareto analysis, executive reporting |
| 11 | **Notification Engine** | Rule-based dispatch, escalation logic, multi-channel |
| 12 | **RCM** | Reliability-Centered Maintenance decision logic |
| 13 | **Corrosion & Integrity** | Damage mechanisms, fitness-for-service |
| 14 | **PSM / MOC** | Process Safety Management, Management of Change |
| 15 | **Predictive Intelligence** | AI-driven RUL prediction, anomaly detection |
| 16 | **Defect Elimination** | Automated bad actor Pareto, DE task generation |

---

## 🤖 Relantern AI

Integrated AI advisor powered by Google Gemini:
- **Reliability Specialist** — RCA drafting, FMEA suggestions, maintenance optimization
- **Predictive Intelligence** — Remaining Useful Life (RUL), anomaly detection
- **Human-In-The-Loop** — AI advises, humans authorize

> The AI cannot authorize shutdowns or purchase orders without human validation.

---

## 🔒 Security & Governance

- **Granular RBAC** — Permissions scoped by function AND data (site/department)
- **Gatekeeper Protocol** — Criticality A asset WR cancellation requires reason + digital sign-off
- **Full Audit Trail** — Non-erasable WHO / WHAT / WHEN / WHERE for every change
- **Canonical Record Locking** — Codes locked on first use; changes require MoC workflow
- **NIST / IEC 62443** compliant auditing

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Python 3.11+
- Supabase account (or self-hosted)

### Frontend
```bash
cd src/frontend
cp .env.example .env.local   # Fill in your Supabase credentials
npm install
npm run dev
```

### Backend
```bash
pip install -r requirements.txt
cp .env.example .env          # Fill in your credentials
python src/main.py
```

### Docker (Full Stack)
```bash
cd infrastructure/docker
cp .env.example .env          # Fill in your credentials
docker-compose up
```

---

## 📁 Project Structure

```
ERS/
├── src/
│   ├── frontend/          # React + TypeScript + Vite
│   ├── layer1-data-fabric/  # Connectors, Knowledge Graph, Quality
│   ├── layer2-modules/      # EAM modules, AI, Reliability
│   ├── layer3-agents/       # Autonomous AI agents
│   ├── layer4-integration/  # External connectors
│   ├── shared/              # Cross-layer utilities
│   └── main.py              # FastAPI entry point
├── infrastructure/
│   ├── docker/            # Docker Compose configs
│   ├── helm/              # Kubernetes Helm charts
│   ├── terraform/         # Cloud infrastructure as code
│   └── airgapped/         # Offline deployment support
├── supabase/              # Database migrations
├── tests/                 # Unit & integration tests
├── docs/                  # Documentation
└── .github/workflows/     # CI/CD pipelines
```

---

## 📜 Standards & Compliance

| Standard | Application |
|----------|------------|
| ISO 55000:2024 | Asset Management System framework |
| ISO 14224 | Equipment taxonomy & failure data |
| ISO 31000 | Risk management & prioritization |
| OREDA 6th Ed | Offshore reliability data reference |
| NIST / IEC 62443 | Cyber-security & audit compliance |

---

## 📄 License

Proprietary — All rights reserved.

---

*Built with ❤️ for reliability engineers, by reliability engineers.*
