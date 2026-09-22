FROM node:alpine AS builder
WORKDIR /build-stage
COPY package*.json ./
RUN apk add --no-cache --virtual .gyp python3 py-setuptools make g++ \
    && npm install \
    && apk del .gyp

FROM node:alpine AS app
EXPOSE 3000
RUN apk update && apk add sqlite
ADD [ ".", "/home/node/app"]
WORKDIR /home/node/app
COPY --from=builder /build-stage .
VOLUME ["/home/node/app/data"]
CMD ["npm", "run-script", "start"]
