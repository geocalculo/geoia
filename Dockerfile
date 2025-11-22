# Imagen base con Nginx
FROM nginx:alpine

# Copiar el sitio web completo dentro de la carpeta pública
COPY . /usr/share/nginx/html

# Ajustar Nginx para escuchar en el puerto $PORT (Cloud Run usa 8080)
RUN sed -i 's/listen       80;/listen       8080;/' /etc/nginx/conf.d/default.conf

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
