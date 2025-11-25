# Imagen base ligera de Node
FROM node:18-alpine

# Directorio de trabajo dentro del contenedor
WORKDIR /usr/src/app

# Copiamos todo el sitio (index.html, info.html, capas, etc.)
COPY . .

# Instalamos http-server para servir contenido estático
RUN npm install -g http-server

# Cloud Run expone el puerto en la variable de entorno PORT
ENV PORT=8080

# Comando de arranque: servidor estático en el puerto $PORT
CMD ["sh", "-c", "http-server -p $PORT ."]
