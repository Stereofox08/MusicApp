FROM node:20-slim

# Установка системных зависимостей
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Установка python-зависимостей — NO cache, всегда свежая версия yt-dlp
RUN pip3 install --no-cache-dir youtube-search-python yt-dlp --break-system-packages

# Принудительно обновляем yt-dlp до последней версии
RUN yt-dlp -U || true

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3001

CMD ["node", "index.js"]
