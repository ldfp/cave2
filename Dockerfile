# Étape 1 : Compilation de l'application
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Base path à la racine pour hébergement autonome
ENV VITE_BASE=/
RUN npm run build

# Étape 2 : Serveur Nginx ultra-léger et sécurisé
FROM nginx:alpine

# Configuration personnalisée avec gestion SPA (Single Page Application)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copie des fichiers compilés
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
