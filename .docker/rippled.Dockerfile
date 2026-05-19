FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg \
 && rm -rf /var/lib/apt/lists/*

# Modern apt keyring pattern (signed-by). The legacy `apt-key add` was
# deprecated in Bullseye and is gone in Bookworm+.
RUN curl -fsSL https://repos.ripple.com/repos/api/gpg/key/public \
      | gpg --dearmor -o /usr/share/keyrings/rippled.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/rippled.gpg] https://repos.ripple.com/repos/rippled-deb bookworm stable" \
      > /etc/apt/sources.list.d/rippled.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends rippled \
 && rm -rf /var/lib/apt/lists/*

# Bake in the test-only rippled config
RUN rm /etc/opt/ripple/rippled.cfg
COPY ./.docker/rippled.cfg /etc/opt/ripple/rippled.cfg

ENTRYPOINT ["rippled", "-a", "--start", "--conf=/etc/opt/ripple/rippled.cfg"]
EXPOSE 5004 5005 6005 6006 51235
