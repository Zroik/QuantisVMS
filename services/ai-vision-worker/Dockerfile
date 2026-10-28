FROM python:3.12-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libgl1 \
    libglib2.0-0 \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock* ./
RUN uv pip install --no-cache --system torch torchvision --index-url https://download.pytorch.org/whl/cu124
RUN uv pip install --no-cache --system ultralytics av redis pymysql pynvml

COPY src/ ./src/
COPY yolov8n.pt ./yolov8n.pt

CMD ["python", "-m", "src.main"]

