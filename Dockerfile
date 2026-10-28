# Stage 1: Build the static web assets
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# Stage 2: Serve static assets + local SQLite REST API via Node 22
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=80
ENV DATA_DIR=/app/data

COPY --from=builder /app/dist ./dist
COPY package.json server.js ./
RUN mkdir -p /app/data

VOLUME ["/app/data"]
EXPOSE 80
CMD ["node", "server.js"]