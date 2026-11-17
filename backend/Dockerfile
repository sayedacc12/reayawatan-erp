FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# متصفح Chromium لتصدير التقارير بصيغة PDF (الخط العربي مضمّن داخل التقرير نفسه)
RUN apk add --no-cache chromium font-noto-arabic
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
# مستندات المستفيدين المرفوعة (مجلد دائم في docker-compose)
RUN mkdir -p /app/uploads && chown node:node /app/uploads
ENV UPLOAD_DIR=/app/uploads
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
