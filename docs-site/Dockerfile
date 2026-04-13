FROM node:22-alpine AS build
WORKDIR /app
COPY fleet/package.json fleet/package-lock.json ./
RUN npm ci
COPY fleet/ .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker-nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080
