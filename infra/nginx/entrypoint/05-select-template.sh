#!/bin/sh
set -eu

mkdir -p /etc/nginx/templates
rm -f /etc/nginx/templates/*.template

if [ "${ENABLE_TLS:-false}" = "true" ]; then
  cp /opt/nginx/templates/default.https.conf.template /etc/nginx/templates/default.conf.template
else
  cp /opt/nginx/templates/default.http.conf.template /etc/nginx/templates/default.conf.template
fi
