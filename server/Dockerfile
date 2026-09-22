FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies for OpenCV and FFmpeg
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    ffmpeg \
    curl \
    git \
    && rm -rf /var/lib/apt/lists/*

# Install PyTorch CPU-only version first to avoid downloading 3.5GB+ CUDA dependencies
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Copy python dependencies
COPY server-requirements.txt .

# Install python dependencies
RUN pip install --no-cache-dir -r server-requirements.txt

# Copy application files and models
COPY app/ app/
COPY models/ models/
COPY yolox_* ./
COPY run_engine.py .

# Expose HTTP API and WebSocket engine port
EXPOSE 8000

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV CAMAI_ENV=production

# Health check probe
HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:8000/api/health || exit 1

# Start FastAPI / engine process
CMD ["python", "run_engine.py", "--port", "8000", "--host", "0.0.0.0"]
