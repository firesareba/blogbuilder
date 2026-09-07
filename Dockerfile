FROM node:22-alpine

RUN apk add --no-cache git unzip su-exec github-cli

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production
ENV PORT=4321
ENV BLOG_REPO_PATH=/data/site
ENV HOME=/data
ENV GH_CONFIG_DIR=/data/gh
ENV AUTH_ENV=/data/auth.env
ENV GIT_CONFIG_GLOBAL=/data/.gitconfig

# The repo BlogBuilder edits lives in a volume so it survives container
# restarts/rebuilds. Seed it from the bundled example-site on first boot.
RUN mkdir -p /data /app/uploads && chown -R node:node /app /data
COPY --chown=node:node example-site /app/example-site-seed

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 4321
# NOTE: stays root on purpose - entrypoint fixes volume perms then
# drops to node via su-exec. See docker-entrypoint.sh.
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
