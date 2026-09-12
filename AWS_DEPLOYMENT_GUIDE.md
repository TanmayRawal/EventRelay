# Deploying EventRelay to AWS EC2 (Step-by-Step Guide)

This guide takes you through launching a free-tier **Ubuntu EC2 instance** on AWS and running EventRelay as a multi-container Docker cluster in under 5 minutes.

---

## Step 1: Launch an EC2 Instance (AWS Console)

1. Open the [AWS EC2 Console](https://console.aws.amazon.com/ec2).
2. Click the orange **"Launch instance"** button.
3. **Name and tags:** Set Name to `eventrelay-server`.
4. **Application and OS Images (Amazon Machine Image):**
   * Select **Ubuntu** (Ubuntu Server 24.04 LTS or 22.04 LTS, 64-bit x86, **Free tier eligible**).
5. **Instance type:**
   * Select **t2.micro** or **t3.micro** (Free tier eligible).
6. **Key pair (login):**
   * Select an existing key pair, or click **"Create new key pair"** (Name: `eventrelay-key`, format: `.pem`), and download the file.
7. **Network settings (Firewall / Security group):**
   Click **Edit** and ensure the following inbound rules are added:
   | Type | Port range | Source | Description |
   | :--- | :--- | :--- | :--- |
   | **SSH** | `22` | Anywhere (`0.0.0.0/0`) | For terminal access |
   | **Custom TCP** | `3000` | Anywhere (`0.0.0.0/0`) | **EventRelay React Dashboard** |
   | **Custom TCP** | `4000` | Anywhere (`0.0.0.0/0`) | **EventRelay Ingestion API & /metrics** |
   | **Custom TCP** | `9000` | Anywhere (`0.0.0.0/0`) | Mock Webhook Receiver |
   | **HTTP** | `80` | Anywhere (`0.0.0.0/0`) | Standard web traffic |
8. **Configure storage:**
   * Set root volume to **20 GiB** `gp3` (Free tier allows up to 30 GiB).
9. Click **"Launch instance"**.

---

## Step 2: Connect to Your Instance

Once the instance state is **Running**:
1. Select your instance and click **"Connect"** at the top.
2. Choose **"EC2 Instance Connect"** and click **"Connect"** (opens a live terminal right in your browser!).
   *(Or connect from PowerShell using SSH: `ssh -i "path/to/eventrelay-key.pem" ubuntu@<PUBLIC_IP>`)*

---

## Step 3: Run the 1-Command Automated Deployer

In your EC2 terminal, paste and run this single command:

```bash
curl -sSL https://raw.githubusercontent.com/TanmayRawal/EventRelay/main/scripts/deploy-aws.sh | bash
```

### What this script does automatically:
1. Allocates **2GB swap space** so your t2.micro/t3.micro never experiences memory exhaustion during Docker builds.
2. Installs **Docker & Docker Compose**.
3. Clones `https://github.com/TanmayRawal/EventRelay.git`.
4. Runs `docker compose up -d --build`, spinning up:
   * `eventrelay-postgres` (PostgreSQL 16)
   * `eventrelay-redis` (Redis 7)
   * `eventrelay-backend` (Node.js API + Stream Worker)
   * `eventrelay-frontend` (React Nginx Dashboard)
   * `eventrelay-mock-receiver` (Webhook Simulation Server)
5. Prints your public live URLs!

---

## Step 4: Access Your Live Deployment

Open your browser and visit:
* **React Dashboard:** `http://<YOUR_EC2_PUBLIC_IP>:3000`
* **Prometheus Metrics:** `http://<YOUR_EC2_PUBLIC_IP>:4000/metrics`
* **Healthcheck:** `http://<YOUR_EC2_PUBLIC_IP>:4000/health`

### Dispatch a Live Test Webhook from your PC:
```bash
curl -X POST http://<YOUR_EC2_PUBLIC_IP>:4000/api/events \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: test-aws-001" \
  -d '{"eventType": "order.completed", "payload": {"id": 101, "amount": 99.50}}'
```

---

## Adding Your Live Link to Your Resume

Once deployed, add this link directly under EventRelay on your resume:
> **EventRelay — Distributed Webhook Gateway & Fault-Tolerant Delivery Engine**  
> *Live AWS Deployment: `http://<YOUR_EC2_IP>:3000` | GitHub: `github.com/TanmayRawal/EventRelay`*
