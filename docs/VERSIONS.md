# Verified Dependency Versions

All versions verified against official registries (npm, PyPI, GitHub releases, Docker manifests) on 2026-10-28 per Spec §4.

## Frontend Stack
| Package | Verified Version | Verification Command | Notes |
|---|---|---|---|
| `vue` | `3.5.44` | `npm view vue version` | Core reactive UI |
| `vite` | `8.3.5` | `npm view vite version` | Build tool & dev server |
| `pinia` | `4.1.0` | `npm view pinia version` | State management |
| `tailwindcss` | `4.3.3` | `npm view tailwindcss version` | Utility-first CSS v4 |
| `reka-ui` | `2.11.0` | `npm view reka-ui version` | Headless primitive UI |
| `lucide-vue-next` | `1.0.0` | `npm view lucide-vue-next version` | Icon set |
| `hls.js` | `1.6.2` | `npm view hls.js version` | Fallback video streaming |

## Backend Stack
| Package | Verified Version | Verification Command | Notes |
|---|---|---|---|
| `node` | `24.15.0` | `node -v` | Host runtime |
| `pnpm` | `12.15.0` | `pnpm -v` | Monorepo package manager |
| `express` | `5.3.0` | `npm view express version` | HTTP REST API |
| `socket.io` | `4.8.4` | `npm view socket.io version` | Real-time WebSocket gateway |
| `bullmq` | `6.5.0` | `npm view bullmq version` | Redis-backed job queue |
| `ioredis` | `6.0.0` | `npm view ioredis version` | Redis client |
| `mysql2` | `3.24.6` | `npm view mysql2 version` | MySQL parameterized client |
| `zod` | `4.6.7` | `npm view zod version` | Schema validation |
| `pino` | `10.4.0` | `npm view pino version` | Structured JSON logging |
| `argon2` | `0.45.1` | `npm view argon2 version` | Password hashing |
| `jsonwebtoken` | `9.0.3` | `npm view jsonwebtoken version` | JWT authentication |

## AI Vision Worker Stack
| Package | Verified Version | Verification Command | Notes |
|---|---|---|---|
| `python` | `3.12.9` / `3.14.4` (host) | `python --version` / `uv python list` | Python 3.12 pinned for worker (E4) |
| `uv` | `0.12.12` | `uv --version` | Python packaging & venv manager |
| `ultralytics` | `8.4.191` | `python -m pip index versions ultralytics` | YOLO26n inference & engine export |
| `av` (PyAV) | `19.0.2` | `python -m pip index versions av` | FFmpeg video frame decoding |
| `redis` | `8.1.0` | `python -m pip index versions redis` | Python Redis client |
| `pymysql` | `1.2.3` | `python -m pip index versions pymysql` | MySQL connector |
| `pynvml` | `13.0.1` | `python -m pip index versions pynvml` | NVIDIA GPU metrics |
| `pytest` | `9.2.0` | `python -m pip index versions pytest` | Testing framework |
| `ruff` | `0.17.3` | `python -m pip index versions ruff` | Python linter & formatter |

## Infrastructure & Media Engine
| Component | Verified Version | Verification Command | Notes |
|---|---|---|---|
| `MediaMTX` | `v1.21.3` | GitHub Releases API | RTSP pull & WebRTC/HLS fanout |
| `MySQL` | `8.4.8` | Docker Hub / official release | MySQL 8.4 LTS InnoDB |
| `Redis` | `7.4-alpine` | Docker Hub / official release | Cache, pubsub & queues |
| `FFmpeg` (Host) | `8.1.1` (Gyan full build) | `ffmpeg -version` | NVENC (AV1, HEVC, H.264), cuvid, libvmaf |
| `FFmpeg CUDA` (Container) | `ghcr.io/feldjaeger/ffmpeg-vmaf-cuda:latest` | GHCR tags query | FFmpeg with libvmaf_cuda + NVENC |

