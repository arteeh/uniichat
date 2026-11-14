#!/bin/bash
set -eu
R=/rig
B=http://127.0.0.1:8788
HOSTS="api.anthropic.com claude.com platform.claude.com console.anthropic.com claude.ai api.openai.com auth.openai.com chatgpt.com"
mkdir -p $R/logs
up() { for _ in $(seq 300); do grep -q "$2" "$R/logs/$1" 2> /dev/null && return; sleep 0.2; done; echo "$1: no \"$2\" in 60 s"; tail -20 "$R/logs/$1"; exit 1; }

cmp -s /src/bun.lock /deps/bun.lock || { echo "bun.lock changed since the image was built: build it again"; exit 1; }
rm -rf /app && mkdir /app
tar -C /src --exclude=./node_modules --exclude=./.git -cf - . | tar -C /app -xf -
ln -s /deps/node_modules /app/node_modules
(cd /app && bun run web > $R/logs/web.log 2>&1)

if [ ! -f $R/certs/server.pem ]; then
  mkdir -p $R/certs && cd $R/certs
  openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem -days 365 -subj "/CN=Ki test rig" 2> /dev/null
  openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=fake" 2> /dev/null
  echo "subjectAltName=DNS:${HOSTS// /,DNS:}" > san.ext
  openssl x509 -req -in server.csr -CA ca.pem -CAkey ca.key -CAcreateserial -days 365 -extfile san.ext -out server.pem 2> /dev/null
  cd /
fi
grep -q "api.anthropic.com" /etc/hosts || echo "127.0.0.1 $HOSTS" >> /etc/hosts

setsid bun /app/testing/fake/server.ts $R/certs > $R/logs/fake.log 2>&1 &
up fake.log "fake up"

if [ ! -f ~/.ki/config.json ]; then
  mkdir -p ~/.ki/claude-sub
  echo '{ "owner": "tester@example.com", "vendors": "claude-sub,claude-api,openai-sub,openai-api", "pick": "claude-sub:sonnet-5.5:low:slow", "compactor": "claude-sub:haiku-5.5:low:slow", "agents": "claude-sub:sonnet-5.5:low:slow" }' > ~/.ki/config.json
  echo '{ "anthropic": "sk-ant-api03-rig-fake-key", "openai": "sk-proj-rig-fake-key" }' > ~/.ki/keys.json
  echo '{"claudeAiOauth":{"accessToken":"sk-ant-oat01-rig-fake","refreshToken":"sk-ant-ort01-rig-fake","expiresAt":4102444800000,"scopes":["user:inference","user:profile","user:sessions:claude_code"],"subscriptionType":"max"}}' > ~/.ki/claude-sub/.credentials.json
  ki serve chatgpt login > $R/logs/chatgpt-login.log
fi

setsid ki serve 8788 > $R/logs/serve.log 2>&1 &
up serve.log "^ki: serving"

mkdir -p $R/box/.config/ki $R/box/work
[ -f $R/box/.config/ki/device.json ] || echo '{ "name": "box", "work": "/rig/box/work" }' > $R/box/.config/ki/device.json
HOME=$R/box KI_DIR=$R/box/.ki setsid ki device $B > $R/logs/device.log 2>&1 &
up device.log "type this code\|^ki device"
if grep -q "type this code" $R/logs/device.log; then
  code=$(ki serve login | grep -o '[0-9]\{6\}' | head -1)
  curl -s -o /dev/null -c $R/jar --data-urlencode "code=$code" $B/auth
  dt=$(grep -o 'auth?t=[^ ]*' $R/logs/device.log | cut -d= -f2)
  code=$(grep -o 'type this code: [0-9]*' $R/logs/device.log | grep -o '[0-9]*$')
  curl -s -o /dev/null -b $R/jar --data-urlencode "t=$dt" --data-urlencode "code=$code" $B/auth
  up device.log "^ki device"
fi

echo "rig up: server $B, device box, fake models; logs in $R/logs"
trap "exit 0" TERM
sleep infinity & wait
