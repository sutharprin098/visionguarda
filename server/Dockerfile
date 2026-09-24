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

# Install PyTorch CPU-only version first
RUN pip install --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cpu

# Install ONNX Runtime (CPU + GPU providers — GPU will be auto-selected when CUDA available)
RUN pip install --no-cache-dir onnxruntime

# Copy python dependencies
COPY server-requirements.txt .

# Install python dependencies
RUN pip install --no-cache-dir -r server-requirements.txt

# Copy application files and models
COPY app/ app/
COPY models/ models/
COPY yolox_tiny.onnx ./
COPY yolox_s.onnx ./
COPY run_cloud_node.py .

# Expose the AWS Cloud Node port and main engine port
EXPOSE 8099
EXPOSE 8000

# Set environment variables (override at runtime via docker run -e / docker-compose env_file)
ENV PYTHONUNBUFFERED=1
ENV CAMAI_ENV=production
ENV CAMAI_MODEL_NAME=yolox_tiny
ENV CAMAI_PORT=8099
ENV CAMAI_HOST=0.0.0.0

# Health check probe for the real-time cloud node
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:8099/health || exit 1

# Start the AWS Real-Time Cloud Inference Node
CMD ["python", "run_cloud_node.py", "--port", "8099", "--host", "0.0.0.0"]
