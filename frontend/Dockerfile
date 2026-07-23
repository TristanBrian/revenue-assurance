# frontend/Dockerfile
FROM node:20-slim

WORKDIR /app

# Copy package manifests first (for better caching)
COPY package.json package-lock.json ./
RUN npm ci

# Copy the entire project
COPY . .

EXPOSE 3000

# Dev server (mirrors backend/Dockerfile's dev-oriented setup — hot reload,
# no production build step)
CMD ["npm", "run", "dev"]
