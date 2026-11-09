# Railway 등에서 쓰는 실행 이미지. 외부 패키지가 없어 npm install 단계가 필요 없다.
FROM node:24-slim
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
ENV NODE_ENV=production
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
