#!/bin/bash
set -e

echo "=================================================="
echo "  Deploying EventRelay on AWS EC2 (Dockerized)"
echo "=================================================="

# 1. Setup 2GB swap space (crucial for free-tier t2.micro/t3.micro stability)
if [ ! -f /swapfile ]; then
  echo "[1/6] Allocating 2GB swap space for memory stability..."
  sudo fallocate -l 2G /swapfile || sudo dd if=/dev/zero of=/swapfile bs=1M count=2048
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
fi

# 2. Install Docker & Docker Compose
echo "[2/6] Installing Docker & Docker Compose..."
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg git

if ! command -v docker &> /dev/null; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
  sudo apt-get update -y
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker $USER
fi

# 3. Clone or Pull Latest EventRelay Repository
echo "[3/6] Setting up EventRelay codebase..."
cd ~
if [ -d "EventRelay" ]; then
  cd EventRelay
  git pull origin main
else
  git clone https://github.com/TanmayRawal/EventRelay.git
  cd EventRelay
fi

# 4. Spin up all multi-container services with Docker Compose
echo "[4/6] Building and launching containers (PostgreSQL, Redis, Backend, Frontend, Mock Receiver)..."
sudo docker compose down || true
sudo docker compose up -d --build

# 5. Wait for healthchecks
echo "[5/6] Waiting for services to initialize..."
sleep 12

# 6. Fetch Public IP
PUBLIC_IP=$(curl -s http://checkip.amazonaws.com || curl -s https://api.ipify.org || echo "YOUR_EC2_PUBLIC_IP")

echo "=================================================="
echo "  🎉 EventRelay Successfully Deployed on AWS EC2!"
echo "=================================================="
echo "  • React Dashboard:       http://${PUBLIC_IP}:3000"
echo "  • Event Ingestion API:   http://${PUBLIC_IP}:4000/api/events"
echo "  • Healthcheck:           http://${PUBLIC_IP}:4000/health"
echo "  • Prometheus Metrics:    http://${PUBLIC_IP}:4000/metrics"
echo "  • Mock Webhook Receiver: http://${PUBLIC_IP}:9000/webhook/success"
echo "=================================================="
