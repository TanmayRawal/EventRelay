# EventRelay Deployment Guide

This guide covers deploying EventRelay across cloud platforms, from AWS EC2 multi-container setups to platform-as-a-service blueprints.

---

## Method 1: AWS EC2 Multi-Container Deployment

EventRelay is containerized as a 5-service Docker Compose cluster (`postgres`, `redis`, `backend`, `frontend`, `mock-receiver`).

### Step 1: Launch an EC2 Instance
1. Open the [AWS EC2 Console](https://console.aws.amazon.com/ec2).
2. Click **Launch instance**.
3. **AMI:** Ubuntu Server 24.04 LTS or 22.04 LTS (64-bit x86, Free tier eligible).
4. **Instance Type:** `t2.micro` or `t3.micro`.
5. **Key Pair:** Select your key pair or generate a new `.pem` key.
6. **Storage:** 20 GiB `gp3` root volume.

### Step 2: Security Group Configuration (Least Privilege vs Demo)

Configure your inbound network firewall based on your deployment tier:

#### A. Production Hardening (Recommended)
In a hardened production deployment, services should follow the principle of least privilege:
- **Port 80 / 443 (HTTP/HTTPS):** Public (`0.0.0.0/0`) via Reverse Proxy (Nginx / Cloudflare / AWS ALB) terminating SSL and routing `/` to the frontend and `/api` to the backend.
- **Port 22 (SSH):** Restricted strictly to the operator's IP address (`<YOUR_IP>/32`).
- **Internal Ports (4000, 5432, 6379, 9000):** Not exposed publicly. PostgreSQL, Redis, and internal workers communicate solely over the isolated Docker bridge network (`eventrelay_default`).

| Type | Port Range | Source | Environment | Description |
| :--- | :--- | :--- | :--- | :--- |
| **SSH** | `22` | `<YOUR_IP>/32` | Production / Demo | Operator terminal access |
| **HTTP** | `80` | `0.0.0.0/0` | Production | Public web traffic |
| **HTTPS** | `443` | `0.0.0.0/0` | Production | Secure SSL web traffic |

#### B. Quick Evaluation / Live Demo Mode
If you are evaluating EventRelay without a dedicated reverse proxy or domain, you can temporarily expose the frontend dashboard and API ports directly:

| Type | Port Range | Source | Description |
| :--- | :--- | :--- | :--- |
| **SSH** | `22` | `<YOUR_IP>/32` | Operator terminal access |
| **Custom TCP** | `3000` | `0.0.0.0/0` | React / Nginx Dashboard |
| **Custom TCP** | `4000` | `0.0.0.0/0` | Gateway API & Prometheus /metrics |

---

### Step 3: Run Automated Deployment Script

Connect to your EC2 instance via SSH or AWS EC2 Instance Connect, then execute:

```bash
curl -sSL https://raw.githubusercontent.com/TanmayRawal/EventRelay/main/scripts/deploy-aws.sh | bash
```

#### What this script performs:
1. Provisions a **2GB swap partition** to prevent OOM errors on memory-constrained `t2.micro`/`t3.micro` instances during image compilation.
2. Installs Docker Engine and Docker Compose V2.
3. Clones the EventRelay repository from GitHub.
4. Executes `docker compose up -d --build`, spinning up all containers.
5. Runs the live health check and displays connection details.

---

### Step 4: Verification

Test reachability from any machine:

```bash
# Gateway Healthcheck
curl http://<EC2_PUBLIC_IP>:4000/health

# Prometheus Metrics Scrape
curl http://<EC2_PUBLIC_IP>:4000/metrics

# Ingest a Test Webhook Event
curl -X POST http://<EC2_PUBLIC_IP>:4000/api/events \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-manual-001" \
  -d '{
    "eventType": "payment.success",
    "payload": { "id": "tx_101", "amount": 99.50 },
    "orderingKey": "account_101"
  }'
```

---

## Method 2: Render (1-Click Blueprint)

1. Push your repository to GitHub (`TanmayRawal/EventRelay`).
2. Navigate to [dashboard.render.com](https://dashboard.render.com) and log in.
3. Click **New +** -> **Blueprint**.
4. Connect the `EventRelay` repository.
5. Render reads `render.yaml` from the root directory and provisions:
   - PostgreSQL Database (`eventrelay-db`)
   - Redis Instance (`eventrelay-redis`)
   - Backend Gateway Web Service (`eventrelay-api`)
6. Click **Apply**. Render will generate public endpoints:
   - Gateway API: `https://<service-name>.onrender.com`
   - Healthcheck: `https://<service-name>.onrender.com/health`
   - Metrics: `https://<service-name>.onrender.com/metrics`

---

## Method 3: Railway / Container PaaS

1. Navigate to [railway.app](https://railway.app).
2. Click **New Project** -> **Deploy from GitHub repo**.
3. Provision a **PostgreSQL** database and a **Redis** instance from the Railway marketplace.
4. Set environment variables:
   - `DATABASE_URL`: Linked from PostgreSQL service.
   - `REDIS_URL`: Linked from Redis service.
   - `PORT`: `4000`
5. Deploy the backend service.
