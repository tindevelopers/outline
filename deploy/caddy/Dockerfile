# Caddy with the Cloudflare DNS plugin.
#
# The stock caddy image ships no DNS provider modules, and issuing a wildcard
# certificate requires the DNS-01 challenge. Building in its own directory keeps
# this image's build context to a few kilobytes instead of the whole repository.
FROM caddy:2-builder AS build
RUN xcaddy build --with github.com/caddy-dns/cloudflare

FROM caddy:2
COPY --from=build /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile /etc/caddy/Caddyfile
