FROM mcr.microsoft.com/playwright:v1.49.0-noble
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
CMD ["node", "src/start.js"]
