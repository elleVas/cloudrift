.PHONY: help install build test lint typecheck format format-check verify-aws e2e-localstack e2e-localstack-mcp reset

help:
	@echo "Common targets:"
	@echo "  make install             pnpm install"
	@echo "  make build               nx run-many -t build"
	@echo "  make test                nx run-many -t test"
	@echo "  make lint                nx run-many -t lint"
	@echo "  make typecheck           nx run-many -t typecheck"
	@echo "  make format              nx format:write"
	@echo "  make format-check        nx format:check"
	@echo "  make verify-aws          node scripts/verify-against-aws.mjs"
	@echo "  make e2e-localstack      nx run cli:e2e-localstack"
	@echo "  make e2e-localstack-mcp  nx run cli:e2e-localstack-mcp"
	@echo "  make reset               nx reset (clears the local Nx cache)"

install:
	pnpm install

build:
	pnpm run build

test:
	pnpm run test

lint:
	pnpm run lint

typecheck:
	pnpm run typecheck

format:
	pnpm exec nx format:write

format-check:
	pnpm exec nx format:check

verify-aws:
	pnpm run verify:aws

e2e-localstack:
	pnpm run e2e:localstack

e2e-localstack-mcp:
	pnpm run e2e:localstack:mcp

reset:
	pnpm exec nx reset
