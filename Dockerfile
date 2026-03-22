FROM node:20-slim

WORKDIR /app

# Install deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy built output and public assets
COPY build/ ./build/
COPY public/ ./public/

# Create data directories
RUN mkdir -p /app/data /app/data/vaults

EXPOSE 3000

CMD ["node", "build/index.js"]
