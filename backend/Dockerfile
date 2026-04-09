FROM node:20-slim

# Установка системных зависимостей
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Установка python-зависимостей
RUN pip3 install youtube-search-python yt-dlp --break-system-packages

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3001

CMD ["node", "index.js"]
