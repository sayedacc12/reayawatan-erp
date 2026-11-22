FROM node:26-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production
# متصفح Chromium لتصدير التقارير بصيغة PDF (الخط العربي مضمّن داخل التقرير نفسه)
RUN apk add --no-cache chromium font-noto-arabic
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# شعار الشركة الافتراضي (يُحفظ في هوية الشركة عند أول تشغيل)
COPY --from=build /app/assets ./assets
COPY package.json ./
# مستندات المستفيدين المرفوعة (مجلد دائم في docker-compose)
RUN mkdir -p /app/uploads && chown node:node /app/uploads
ENV UPLOAD_DIR=/app/uploads
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
