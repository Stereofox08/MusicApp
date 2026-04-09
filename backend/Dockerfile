FROM node:20-slim
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg
RUN pip3 install youtube-search-python yt-dlp --break-system-packages
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", "index.js"]
