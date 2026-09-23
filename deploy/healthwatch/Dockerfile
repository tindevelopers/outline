# Watches container health and site uptime, alerting Mattermost on change.
# Zero npm dependencies - built-in http/https only.
FROM node:22-alpine
COPY monitor.js /app/monitor.js
CMD ["node", "/app/monitor.js"]
