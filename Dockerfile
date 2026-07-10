FROM node:20-alpine

WORKDIR /app

# Install deps first for better layer caching
COPY package*.json ./
RUN npm install --production

# Copy rest of the source
COPY . .

EXPOSE 8000

CMD ["npm", "start"]
