# Builds apps/connector for deployment. Root-context on purpose: it depends on the @decomp/*
# workspace packages via `workspace:*`, which only resolve when `bun install` sees the whole
# monorepo (see railway.toml's comment on the same point).
FROM oven/bun:1

WORKDIR /app

# The whole repo, then install — simpler and more robust than hand-listing every workspace
# package.json for cache-friendly layering, and this repo isn't big enough to need that.
COPY . .
RUN bun install --frozen-lockfile

ENV NODE_ENV=production
EXPOSE 3000
CMD ["bun", "run", "apps/connector/src/index.ts"]
