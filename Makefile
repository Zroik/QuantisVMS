.PHONY: all verify verify-gpu test lint typecheck dev down

all: verify

verify:
	pnpm verify
	uv run --directory services/ai-vision-worker --with pytest,ruff pytest
	uv run --directory services/ai-vision-worker --with pytest,ruff ruff check .

verify-gpu:
	nvidia-smi
	ffmpeg -hide_banner -encoders | grep nvenc
	pnpm verify-gpu

test:
	pnpm test
	uv run --directory services/ai-vision-worker --with pytest pytest

lint:
	pnpm lint
	uv run --directory services/ai-vision-worker --with ruff ruff check .

typecheck:
	pnpm typecheck

dev:
	docker compose up -d

down:
	docker compose down

