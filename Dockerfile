# Étape 1 : Compilation de l'application React
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Base path à la racine pour hébergement autonome
ENV VITE_BASE=/
RUN npm run build

# Étape 2 : Serveur Node.js léger avec API de sauvegarde persistante
FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY server.js ./

RUN mkdir -p /app/data /app/data/backups

ENV PORT=80
EXPOSE 80
VOLUME ["/app/data"]

CMD ["node", "server.js"]
