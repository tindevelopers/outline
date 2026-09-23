# Relays Outline webhook deliveries into Mattermost. Zero npm dependencies -
# built-in http/crypto/fetch only - so the image is just the Node runtime.
FROM node:22-alpine
COPY server.js /app/server.js
EXPOSE 8787
CMD ["node", "/app/server.js"]
