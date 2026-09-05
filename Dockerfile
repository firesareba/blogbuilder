FROM node:22-alpine

RUN apk add --no-cache git

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

ENV NODE_ENV=production
ENV PORT=4321
ENV BLOG_REPO_PATH=/data/site

# The repo BlogBuilder edits lives in a volume so it survives container
# restarts/rebuilds. Seed it from the bundled example-site on first boot.
RUN mkdir -p /data
COPY example-site /app/example-site-seed

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

EXPOSE 4321
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server/index.js"]
