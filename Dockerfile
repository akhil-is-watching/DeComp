# Builds any of this monorepo's deployable Bun apps (currently apps/connector and apps/bridge).
# Root-context on purpose: they depend on the @decomp/* workspace packages via `workspace:*`,
# which only resolve when `bun install` sees the whole monorepo (see railway.toml's comment on
# the same point).
#
# One image serves every service on Railway — which app actually starts is picked at runtime by
# START_APP (defaults to "connector"), rather than needing a distinct Dockerfile/config-as-code
# path per service, which Railway doesn't reliably let a second service in the same repo opt into
# without dashboard access.
FROM oven/bun:1

WORKDIR /app

# The whole repo, then install — simpler and more robust than hand-listing every workspace
# package.json for cache-friendly layering, and this repo isn't big enough to need that.
COPY . .
RUN bun install --frozen-lockfile

ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "bun run apps/${START_APP:-connector}/src/index.ts"]
