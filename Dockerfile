FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ARG TARGETARCH
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && case "${TARGETARCH:-amd64}" in \
      amd64) ARCH=x86_64; SHA=b7a7812f1dc2266d43837028892d6dd1ae38d1b777d8796bb097e1f86da0a3a4 ;; \
      arm64) ARCH=arm64; SHA=72a8e99ae43d14fea4ecc0650155f94072c4287b469fc318c835f8dd781b426f ;; \
      *) exit 1 ;; esac \
    && curl -fsSL --retry 3 "https://github.com/kovetskiy/mark/releases/download/v16.22.0/mark_Linux_${ARCH}.tar.gz" -o /tmp/mark.tar.gz \
    && echo "$SHA  /tmp/mark.tar.gz" | sha256sum -c - \
    && mkdir /tmp/mark-extract \
    && tar -xzf /tmp/mark.tar.gz -C /tmp/mark-extract \
    && install -m 755 /tmp/mark-extract/mark /usr/local/bin/mark \
    && mkdir -p /usr/share/licenses/mark \
    && cp /tmp/mark-extract/LICENSE* /usr/share/licenses/mark/ \
    && rm -rf /var/lib/apt/lists/* /tmp/mark* \
    && apt-get purge -y --auto-remove curl
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server ./server
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4318
EXPOSE 4318
CMD ["node","server/index.js"]
