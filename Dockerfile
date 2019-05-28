FROM node:10-stretch
WORKDIR /ladex
RUN npm i -g truffle ganache-cli
COPY package.json ./
RUN npm i
COPY contracts ./contracts
COPY migrations ./migrations
COPY test ./test
COPY truffle-config.js ./truffle-config.js
COPY test.sh ./test.sh
CMD sh test.sh
